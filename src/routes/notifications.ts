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

export default notifications
