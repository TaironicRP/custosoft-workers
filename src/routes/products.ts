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
  // Plattform ableiten:
  //   - apple_transaction_id != NULL  → via Apple (IAP)
  //   - environment = 'web' / 'stripe' → via Web (kommt später mit Stripe)
  //   - sonst (Owner-Direkt-Grant, manuell, …) → null = unbekannt → Frontend
  //     zeigt das als "Apple" weil unsere App-Käufe historisch alle aus iOS kamen.
  const apple = row.apple_transaction_id ? 'apple' : null
  const env   = String(row.environment ?? '').toLowerCase()
  const platform: 'apple' | 'web' | null =
    apple ? 'apple' :
    (env === 'web' || env === 'stripe') ? 'web' :
    null

  return {
    id:          row.id,
    product:     row.product,         // slug enum value
    grantedVia:  row.granted_via,     // 'Purchase' | 'OrgMembership' (kann von /my überschrieben werden)
    isActive:    (row.is_active ?? 0) === 1,
    purchasedAt: row.purchased_at,
    expiresAt:   row.expires_at,
    platform,                          // 'apple' | 'web' | null — neue API
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

// GET /products/my — user's active extensions (eigene + Org-geerbte)
products.get('/my', requireAuth, async (c) => {
  const userId = c.get('userId') as string

  // ── Eigene Extensions ─────────────────────────────────────────────────────
  const ownRows = await c.env.DB
    .prepare(
      `SELECT * FROM user_extensions
       WHERE user_id = ?
         AND is_active = 1
         AND (expires_at IS NULL OR expires_at > strftime('%Y-%m-%dT%H:%M:%SZ','now'))
       ORDER BY purchased_at DESC`
    )
    .bind(userId)
    .all<any>()

  const ownSlugs = new Set<string>(ownRows.results.map((r: any) => r.product))
  // Eigene Records: grantedVia immer "Purchase" — egal was in der DB steht.
  // Hintergrund: Org-Owner haben in alten DB-Records oft 'OrgMembership'
  // markiert, semantisch sind ihre eigenen Käufe aber Purchases — sie sehen
  // sonst „über Organisation" obwohl sie selbst gezahlt haben.
  const dtos = ownRows.results.map((r: any) => ({
    ...buildExtensionDto(r),
    grantedVia: 'Purchase' as const,
  }))

  // ── Org-geerbte Extensions (vom Inhaber) ──────────────────────────────────
  const membership = await c.env.DB
    .prepare(`SELECT om.org_id, o.owner_id
              FROM org_members om
              JOIN organisations o ON o.id = om.org_id
              WHERE om.user_id = ? AND om.is_active = 1 LIMIT 1`)
    .bind(userId)
    .first<{ org_id: number; owner_id: string }>()

  if (membership && membership.owner_id !== userId) {
    const ownerRows = await c.env.DB
      .prepare(
        `SELECT * FROM user_extensions
         WHERE user_id = ?
           AND is_active = 1
           AND (expires_at IS NULL OR expires_at > strftime('%Y-%m-%dT%H:%M:%SZ','now'))
         ORDER BY purchased_at DESC`
      )
      .bind(membership.owner_id)
      .all<any>()

    for (const row of ownerRows.results ?? []) {
      if (!ownSlugs.has(row.product)) {
        dtos.push({ ...buildExtensionDto(row), grantedVia: 'OrgMembership' })
      }
    }
  }

  return c.json(dtos)
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

  // ── Business-Tier-Familie: welche Slugs sind gleich-/niederrangig? ─────────
  // Basic-Familie: BusinessBasic, BusinessBasicYearly
  // L-Familie: BusinessL, BusinessLYearly
  // Upgrade Basic→L deaktiviert alle Basic-Slugs (und umgekehrt bei Downgrade, aber
  // Apple verhindert Downgrades — wir lassen es trotzdem sauber).
  const businessBasicSlugs = ['BusinessBasic', 'BusinessBasicYearly', 'Business']
  const businessLSlugs     = ['BusinessL', 'BusinessLYearly']

  /** Gibt zurück welche anderen Business-Slugs beim Kauf von `slug` deaktiviert werden sollen */
  function obsoletedBy(slug: string): string[] {
    if (businessLSlugs.includes(slug))     return businessBasicSlugs  // Upgrade Basic→L
    if (businessBasicSlugs.includes(slug)) return businessLSlugs      // Downgrade L→Basic (selten)
    return []
  }

  const slugsToDeactivate = obsoletedBy(product.slug)
  let upgradedFrom: string | null = null

  // ── 5. Upsert user_extension + Upgrade-Logik ──────────────────────────────
  // Wenn ein höherer/anderer Business-Tier gekauft wird: alten deaktivieren
  if (slugsToDeactivate.length > 0) {
    const placeholders = slugsToDeactivate.map(() => '?').join(',')
    const oldExt = await c.env.DB
      .prepare(`SELECT product FROM user_extensions WHERE user_id = ? AND product IN (${placeholders}) AND is_active = 1 LIMIT 1`)
      .bind(userId, ...slugsToDeactivate).first<{ product: string }>()
    if (oldExt) {
      upgradedFrom = oldExt.product
      await c.env.DB
        .prepare(`UPDATE user_extensions SET is_active = 0 WHERE user_id = ? AND product IN (${placeholders})`)
        .bind(userId, ...slugsToDeactivate).run()
    }
  }

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

  // ── 6. Order log (mit Upgrade-Info) ──────────────────────────────────────
  const upgradeNote = upgradedFrom
    ? `Upgrade von ${upgradedFrom} → ${product.slug}`
    : null
  await c.env.DB.prepare(
    `INSERT INTO orders (user_id, product_name, price_paid, status, notes, upgraded_from)
     VALUES (?, ?, ?, 'Active', ?, ?)`
  ).bind(userId, product.name, product.price_formatted, upgradeNote, upgradedFrom).run()

  // Upgrade-Notification eintragen
  if (upgradedFrom) {
    await c.env.DB.prepare(
      `INSERT INTO subscription_notifications (user_id, title, body, type, ref_id)
       VALUES (?, ?, ?, 'Upgraded', ?)`
    ).bind(
      userId,
      `Upgrade: ${upgradedFrom} → ${product.slug}`,
      `Dein Abo wurde von ${upgradedFrom} auf ${product.name} geupgraded.`,
      transactionId ?? '0'
    ).run()
  }

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
