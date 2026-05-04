// ── Products / IAP — /api/v1/products ─────────────────────────────────────────
import { Hono }        from 'hono'
import type { Env, AppEnv } from '../types'
import { requireAuth } from '../middleware/auth'
import { sendEmail, purchaseConfirmationHtml, purchaseConfirmationText } from '../utils/email'
import { verifyAppleJws, isActiveSubscription } from '../utils/apple-iap'

const products = new Hono<AppEnv>()

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build Product DTO matching iOS Product model exactly */
function buildProductDto(row: any) {
  return {
    id:                row.id,
    slug:              row.slug,
    name:              row.name,
    description:       row.description ?? '',
    priceFormatted:    row.price_formatted ?? '',
    isActive:          (row.is_active ?? 0) === 1,
    isSubscription:    (row.is_subscription ?? 0) === 1,
    trialDays:         row.trial_days ?? 0,
    billingPeriodDays: row.billing_period_days,
    isSlotBased:       (row.is_slot_based ?? 0) === 1,
    basePrice:         row.base_price,
    perSlotPrice:      row.per_slot_price,
    startingSlots:     row.starting_slots,
    maxSlots:          row.max_slots,
    appleProductId:    row.apple_product_id,
  }
}

/** Build UserExtensionRecord DTO matching iOS model */
function buildExtensionDto(row: any) {
  return {
    id:          row.id,
    product:     row.product,         // slug enum value
    grantedVia:  row.granted_via,     // 'Purchase' | 'OrgMembership'
    isActive:    (row.is_active ?? 0) === 1,
    purchasedAt: row.purchased_at,
    expiresAt:   row.expires_at,
  }
}

/** Erwartete Bundle-ID. Aus Env (APPLE_CLIENT_ID) oder Fallback. */
function expectedBundleId(env: Env): string {
  return env.APPLE_CLIENT_ID || 'com.taironic.custosoft'
}

// ─── Routes ──────────────────────────────────────────────────────────────────

// GET /products — list of all active products (public, no auth needed for browsing)
products.get('/', async (c) => {
  const rows = await c.env.DB
    .prepare(`SELECT * FROM products WHERE is_active = 1 ORDER BY id ASC`)
    .all<any>()

  return c.json((rows.results ?? []).map(buildProductDto))
})

// GET /products/my — user's active extensions
products.get('/my', requireAuth, async (c) => {
  const userId = c.get('userId') as string

  const rows = await c.env.DB
    .prepare(
      `SELECT * FROM user_extensions
       WHERE user_id = ?
         AND is_active = 1
         AND (expires_at IS NULL OR expires_at > strftime('%Y-%m-%dT%H:%M:%SZ','now'))
       ORDER BY purchased_at DESC`
    )
    .bind(userId)
    .all<any>()

  return c.json((rows.results ?? []).map(buildExtensionDto))
})

// POST /products/purchase — Apple IAP mit Signatur-Verifikation
products.post('/purchase', requireAuth, async (c) => {
  const userId = c.get('userId') as string
  const body   = await c.req.json<{
    appleTransactionJws: string
    productId?: number        // iOS schickt auch productId, wir lesen aber aus JWS
    slotCount?: number
    appleOriginalTransactionId?: string
  }>()

  if (!body.appleTransactionJws) {
    return c.json({ error: 'appleTransactionJws is required' }, 400)
  }

  // ── 1. JWS verifizieren (Apple-Signatur prüfen) ───────────────────────────
  const verify = await verifyAppleJws(body.appleTransactionJws, expectedBundleId(c.env))
  if (!verify.ok) {
    console.error('[purchase] JWS-Verifikation fehlgeschlagen:', verify.error, verify.hint)
    return c.json({ error: verify.error, hint: verify.hint }, 400)
  }

  const payload = verify.payload
  const appleProductId  = payload.productId
  const transactionId   = payload.transactionId ?? payload.originalTransactionId
  const expiresDateMs   = payload.expiresDate
  const environment     = verify.environment    // "Sandbox" | "Production"

  if (!appleProductId) {
    return c.json({ error: 'productId fehlt im verifizierten JWS-Payload' }, 400)
  }

  // ── 2. Produkt aus DB matchen ─────────────────────────────────────────────
  const product = await c.env.DB
    .prepare(`SELECT * FROM products WHERE apple_product_id = ? AND is_active = 1`)
    .bind(appleProductId)
    .first<any>()

  if (!product) {
    return c.json({ error: `No active product found for ${appleProductId}` }, 404)
  }

  // ── 3. Duplicate Guard ────────────────────────────────────────────────────
  if (transactionId) {
    const dup = await c.env.DB
      .prepare(`SELECT id FROM user_extensions WHERE apple_transaction_id = ?`)
      .bind(transactionId).first<{ id: number }>()
    if (dup) return c.json({
      ok: true, orderId: dup.id, status: 'Active', activated: true,
      message: 'Already processed', environment
    })
  }

  // ── 4. Subscription noch aktiv? (bei abgelaufenen Renewals nicht aktivieren) ─
  if (!isActiveSubscription(payload)) {
    return c.json({
      error: `Transaction expired (expiresDate=${expiresDateMs ? new Date(expiresDateMs).toISOString() : 'unknown'})`
    }, 400)
  }

  const expiresAt = expiresDateMs ? new Date(expiresDateMs).toISOString() : null

  // ── 5. Upsert user_extension ──────────────────────────────────────────────
  const existing = await c.env.DB
    .prepare(`SELECT id FROM user_extensions WHERE user_id = ? AND product = ?`)
    .bind(userId, product.slug).first<any>()

  if (existing) {
    await c.env.DB
      .prepare(
        `UPDATE user_extensions
         SET is_active = 1, granted_via = 'Purchase',
             apple_transaction_id = COALESCE(?, apple_transaction_id),
             purchased_at = strftime('%Y-%m-%dT%H:%M:%SZ','now'),
             expires_at = ?
         WHERE id = ?`
      )
      .bind(transactionId ?? null, expiresAt, existing.id).run()
  } else {
    await c.env.DB
      .prepare(
        `INSERT INTO user_extensions (user_id, product, granted_via, is_active, apple_transaction_id, expires_at)
         VALUES (?, ?, 'Purchase', 1, ?, ?)`
      )
      .bind(userId, product.slug, transactionId ?? null, expiresAt).run()
  }

  // ── 6. Order log ──────────────────────────────────────────────────────────
  await c.env.DB.prepare(
    `INSERT INTO orders (user_id, product_name, price_paid, status) VALUES (?, ?, ?, 'Active')`
  ).bind(userId, product.name, product.price_formatted).run()

  // ── 7. Confirmation email (Fail soft) ────────────────────────────────────
  try {
    const u = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first<any>()
    if (u) {
      const name = `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim() || u.email
      await sendEmail({
        to: u.email, toName: name,
        subject: `Bestätigung deines Kaufs: ${product.name}`,
        text: purchaseConfirmationText(name, product.name, product.price_formatted, product.is_subscription === 1),
        html: purchaseConfirmationHtml(name, product.name, product.price_formatted, product.is_subscription === 1),
        from: c.env.FROM_EMAIL, fromName: c.env.FROM_NAME,
        apiKey: c.env.RESEND_API_KEY,
      })
    }
  } catch (e: any) {
    console.error('[purchase] confirmation email failed:', e?.message)
  }

  const ext = await c.env.DB
    .prepare(`SELECT id FROM user_extensions WHERE user_id = ? AND product = ?`)
    .bind(userId, product.slug).first<{ id: number }>()

  return c.json({
    ok:          true,
    orderId:     ext?.id ?? 0,
    status:      'Active',
    activated:   true,
    environment,
    expiresAt
  })
})

export default products
