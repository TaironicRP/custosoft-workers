// ── Notifications — /api/v1/notifications ────────────────────────────────────
import { Hono }        from 'hono'
import { requireAuth } from '../middleware/auth'
import type { Env, AppEnv } from '../types'

const notifications = new Hono<AppEnv>()
notifications.use('*', requireAuth)

function buildDto(row: any) {
  return {
    id:           row.id,
    userId:       row.user_id,
    title:        row.title,
    body:         row.body,
    message:      row.body,    // iOS-Compat: ServerNotification.message
    type:         row.type,
    kind:         row.type,    // iOS-Compat: ServerNotification.kind
    refId:        row.ref_id ?? null,
    isRead:       (row.is_read ?? 0) === 1,
    createdAt:    row.created_at,
  }
}

// GET /notifications — current user's notifications (unread first, max 50)
notifications.get('/', async (c) => {
  const userId = c.get('userId') as string

  const rows = await c.env.DB.prepare(
    `SELECT * FROM subscription_notifications
     WHERE user_id = ?
     ORDER BY is_read ASC, created_at DESC
     LIMIT 50`
  ).bind(userId).all<any>()

  return c.json((rows.results ?? []).map(buildDto))
})

// POST /notifications/:id/ack — mark as read
notifications.post('/:id/ack', async (c) => {
  const userId = c.get('userId') as string
  const id = c.req.param('id')

  const exists = await c.env.DB
    .prepare(`SELECT id FROM subscription_notifications WHERE id = ? AND user_id = ?`)
    .bind(id, userId).first()

  if (!exists) return c.json({ error: 'Benachrichtigung nicht gefunden.' }, 404)

  await c.env.DB
    .prepare(`UPDATE subscription_notifications SET is_read = 1 WHERE id = ?`)
    .bind(id).run()

  return c.json({ ok: true })
})

// ════════════════════════════════════════════════════════════════════════════
// Device-Token-Verwaltung für APNS-Push
// ════════════════════════════════════════════════════════════════════════════

// POST /notifications/devices — Token registrieren (idempotent: Upsert)
//   Body: { token, platform: 'ios'|'mac', appVersion?, bundleId?, environment? }
notifications.post('/devices', async (c) => {
  const userId = c.get('userId') as string
  const body   = await c.req.json<{
    token:        string
    platform:     'ios' | 'mac' | 'web'
    appVersion?:  string
    bundleId?:    string
    environment?: 'production' | 'sandbox'
  }>().catch(() => null)

  if (!body?.token || !body?.platform) {
    return c.json({ error: 'token und platform sind Pflicht.' }, 400)
  }
  if (!['ios', 'mac', 'web'].includes(body.platform)) {
    return c.json({ error: 'platform muss ios|mac|web sein.' }, 400)
  }

  // Token kann max 200 Zeichen lang sein — APNS = 64 hex, web push deutlich länger
  if (body.token.length > 500) {
    return c.json({ error: 'Token zu lang.' }, 400)
  }

  const env = body.environment ?? 'production'

  // Upsert: gleicher (user_id, token) → last_seen + meta updaten
  await c.env.DB.prepare(
    `INSERT INTO device_tokens (user_id, token, platform, app_version, bundle_id, environment, last_seen)
     VALUES (?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))
     ON CONFLICT(user_id, token) DO UPDATE SET
       platform    = excluded.platform,
       app_version = excluded.app_version,
       bundle_id   = excluded.bundle_id,
       environment = excluded.environment,
       last_seen   = strftime('%Y-%m-%dT%H:%M:%SZ','now')`
  ).bind(
    userId,
    body.token,
    body.platform,
    body.appVersion ?? null,
    body.bundleId ?? null,
    env,
  ).run()

  return c.json({ ok: true })
})

// DELETE /notifications/devices/:token — Token deregistrieren (Logout)
notifications.delete('/devices/:token', async (c) => {
  const userId = c.get('userId') as string
  const token  = c.req.param('token')

  await c.env.DB
    .prepare(`DELETE FROM device_tokens WHERE user_id = ? AND token = ?`)
    .bind(userId, token).run()

  return new Response(null, { status: 204 })
})

// GET /notifications/devices — Liste der eigenen Geräte (Debug + Profile)
notifications.get('/devices', async (c) => {
  const userId = c.get('userId') as string
  const rows = await c.env.DB
    .prepare(`SELECT id, platform, app_version, bundle_id, environment, last_seen, created_at
              FROM device_tokens WHERE user_id = ? ORDER BY last_seen DESC`)
    .bind(userId).all<any>()
  return c.json({ items: rows.results ?? [] })
})

export default notifications
