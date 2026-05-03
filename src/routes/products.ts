// ── Products / IAP — /api/v1/products ─────────────────────────────────────────
import { Hono }        from 'hono'
import type { Env, AppEnv } from '../types'
import { requireAuth } from '../middleware/auth'
import { sendEmail, purchaseConfirmationHtml, purchaseConfirmationText } from '../utils/email'

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

/** Decode JWS payload without verifying signature (simplified). */
function decodeJwsPayload(jws: string): Record<string, any> | null {
  try {
    const parts = jws.split('.')
    if (parts.length < 2) return null
    const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(atob(padded))
  } catch {
    return null
  }
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

// POST /products/purchase — Apple IAP receipt verification
products.post('/purchase', requireAuth, async (c) => {
  const userId = c.get('userId') as string
  const body   = await c.req.json<{
    appleTransactionJws: string
    productId?: number        // iOS schickt auch productId + slotCount, aber wir lesen aus JWS
    slotCount?: number
    appleOriginalTransactionId?: string
  }>()

  if (!body.appleTransactionJws) {
    return c.json({ error: 'appleTransactionJws is required' }, 400)
  }

  const payload = decodeJwsPayload(body.appleTransactionJws)
  if (!payload) {
    return c.json({ error: 'Invalid transaction JWS' }, 400)
  }

  const appleProductId: string | undefined = payload.productId ?? payload.product_id
  if (!appleProductId) {
    return c.json({ error: 'Could not extract productId from transaction' }, 400)
  }

  const transactionId: string | undefined =
    payload.transactionId ?? payload.transaction_id ?? payload.originalTransactionId
  const expiresDateMs: number | undefined = payload.expiresDate

  // Find matching product
  const product = await c.env.DB
    .prepare(`SELECT * FROM products WHERE apple_product_id = ? AND is_active = 1`)
    .bind(appleProductId)
    .first<any>()

  if (!product) {
    return c.json({ error: `No active product found for ${appleProductId}` }, 404)
  }

  // Duplicate guard — allow re-processing but skip if exact transaction already activated
  if (transactionId) {
    const dup = await c.env.DB
      .prepare(`SELECT id FROM user_extensions WHERE apple_transaction_id = ?`)
      .bind(transactionId).first<{ id: number }>()
    if (dup) return c.json({ ok: true, orderId: dup.id, status: 'Active', activated: true, message: 'Already processed' })
  }

  const expiresAt = expiresDateMs ? new Date(expiresDateMs).toISOString() : null

  // Upsert user_extension (using slug as product reference, matching schema)
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

  // Order log
  await c.env.DB.prepare(
    `INSERT INTO orders (user_id, product_name, price_paid, status) VALUES (?, ?, ?, 'Active')`
  ).bind(userId, product.name, product.price_formatted).run()

  // Confirmation email (don't fail the purchase if email fails)
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

  // Fetch created/updated extension id for response
  const ext = await c.env.DB
    .prepare(`SELECT id FROM user_extensions WHERE user_id = ? AND product = ?`)
    .bind(userId, product.slug).first<{ id: number }>()

  return c.json({
    ok:        true,
    orderId:   ext?.id ?? 0,
    status:    'Active',
    activated: true,
  })
})

export default products
