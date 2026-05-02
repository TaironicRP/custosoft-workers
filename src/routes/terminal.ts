import { Hono } from 'hono'
import { requireAuth } from '../middleware/auth'
import type { Env, AppEnv } from '../types'
import { hashPassword, verifyPassword } from '../utils/crypto'

const terminal = new Hono<AppEnv>()

terminal.use('*', requireAuth)

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getInitials(displayName: string): string {
  return displayName
    .split(/\s+/)
    .slice(0, 2)
    .map((n) => n.charAt(0).toUpperCase())
    .join('')
}

async function getOrgId(db: any, userId: string): Promise<string | null> {
  const row = await db
    .prepare(`SELECT org_id FROM org_members WHERE user_id = ? LIMIT 1`)
    .bind(userId)
    .first<{ org_id: string }>()
  return row?.org_id ?? null
}

async function resolveUserByPin(
  db: any,
  orgId: string,
  userId: string,
  pin: string
): Promise<{ id: string; displayName: string } | null> {
  const row = await db
    .prepare(
      `SELECT u.id, u.display_name, up.pin_hash
       FROM users u
       INNER JOIN org_members om ON om.user_id = u.id AND om.org_id = ?
       LEFT JOIN user_pins up ON up.user_id = u.id
       WHERE u.id = ?`
    )
    .bind(orgId, userId)
    .first<{ id: string; display_name: string; pin_hash: string | null }>()

  if (!row || !row.pin_hash) return null

  const valid = await verifyPassword(pin, row.pin_hash)
  if (!valid) return null

  return { id: row.id, displayName: row.display_name }
}

// ─── PIN management ───────────────────────────────────────────────────────────

// GET /terminal/me/pin
terminal.get('/me/pin', async (c) => {
  const user = c.get('user')
  const db = c.env.DB

  const row = await db
    .prepare(`SELECT 1 FROM user_pins WHERE user_id = ?`)
    .bind(user.id)
    .first()

  return c.json({ hasPin: !!row })
})

// PUT /terminal/me/pin
terminal.put('/me/pin', async (c) => {
  const user = c.get('user')
  const db = c.env.DB
  const body = await c.req.json<{ pin: string }>()

  if (!body.pin || typeof body.pin !== 'string') {
    return c.json({ error: 'pin is required' }, 400)
  }

  if (body.pin.length < 4 || body.pin.length > 8) {
    return c.json({ error: 'PIN must be 4–8 characters' }, 400)
  }

  const hashed = await hashPassword(body.pin)

  await db
    .prepare(
      `INSERT INTO user_pins (user_id, pin_hash, updated_at)
       VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))
       ON CONFLICT(user_id) DO UPDATE SET pin_hash = excluded.pin_hash, updated_at = excluded.updated_at`
    )
    .bind(user.id, hashed)
    .run()

  return c.json({ ok: true })
})

// DELETE /terminal/me/pin
terminal.delete('/me/pin', async (c) => {
  const user = c.get('user')
  const db = c.env.DB

  await db.prepare(`DELETE FROM user_pins WHERE user_id = ?`).bind(user.id).run()

  return c.json({ ok: true })
})

// ─── Kiosk member list ────────────────────────────────────────────────────────

// GET /terminal/members
terminal.get('/members', async (c) => {
  const user = c.get('user')
  const db = c.env.DB

  const orgId = await getOrgId(db, user.id)
  if (!orgId) {
    return c.json({ error: 'Not in an organisation' }, 403)
  }

  const rows = await db
    .prepare(
      `SELECT
        u.id AS userId,
        u.display_name AS displayName,
        u.position_title AS positionTitle,
        (up.pin_hash IS NOT NULL) AS hasPin,
        (
          SELECT COUNT(*) FROM punch_records pr
          WHERE pr.user_id = u.id AND pr.clock_out IS NULL
        ) > 0 AS isClockedIn,
        (
          SELECT COUNT(*) FROM punch_records pr
          INNER JOIN punch_pauses pp ON pp.punch_record_id = pr.id AND pp.resumed_at IS NULL
          WHERE pr.user_id = u.id AND pr.clock_out IS NULL
        ) > 0 AS isPaused
      FROM org_members om
      INNER JOIN users u ON u.id = om.user_id
      LEFT JOIN user_pins up ON up.user_id = u.id
      WHERE om.org_id = ?
      ORDER BY u.display_name`
    )
    .bind(orgId)
    .all()

  const result = (rows.results ?? []).map((m: any) => ({
    userId: m.userId,
    displayName: m.displayName,
    initials: getInitials(m.displayName ?? ''),
    positionTitle: m.positionTitle ?? null,
    hasPin: m.hasPin === 1,
    isClockedIn: m.isClockedIn === 1,
    isPaused: m.isPaused === 1,
  }))

  return c.json(result)
})

// ─── Terminal punch actions ───────────────────────────────────────────────────

// POST /terminal/punch/in
terminal.post('/punch/in', async (c) => {
  const user = c.get('user')
  const db = c.env.DB
  const body = await c.req.json<{ pin: string; userId: string }>()

  if (!body.pin || !body.userId) {
    return c.json({ error: 'pin and userId are required' }, 400)
  }

  const orgId = await getOrgId(db, user.id)
  if (!orgId) {
    return c.json({ error: 'Not in an organisation' }, 403)
  }

  const target = await resolveUserByPin(db, orgId, body.userId, body.pin)
  if (!target) {
    return c.json({ error: 'Invalid PIN or user not found' }, 401)
  }

  // Check not already clocked in
  const existing = await db
    .prepare(`SELECT id FROM punch_records WHERE user_id = ? AND clock_out IS NULL LIMIT 1`)
    .bind(target.id)
    .first()

  if (existing) {
    return c.json({ error: 'Already clocked in' }, 409)
  }

  const id = crypto.randomUUID()
  await db
    .prepare(
      `INSERT INTO punch_records (id, user_id, org_id, clock_in, clock_out, pause_seconds, note, is_manual)
       VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'), NULL, 0, NULL, 0)`
    )
    .bind(id, target.id, orgId)
    .run()

  return c.json({
    ok: true,
    action: 'clockIn',
    displayName: target.displayName,
    time: new Date().toISOString(),
    note: null,
  })
})

// POST /terminal/punch/out
terminal.post('/punch/out', async (c) => {
  const user = c.get('user')
  const db = c.env.DB
  const body = await c.req.json<{ pin: string; userId: string }>()

  if (!body.pin || !body.userId) {
    return c.json({ error: 'pin and userId are required' }, 400)
  }

  const orgId = await getOrgId(db, user.id)
  if (!orgId) {
    return c.json({ error: 'Not in an organisation' }, 403)
  }

  const target = await resolveUserByPin(db, orgId, body.userId, body.pin)
  if (!target) {
    return c.json({ error: 'Invalid PIN or user not found' }, 401)
  }

  const record = await db
    .prepare(`SELECT * FROM punch_records WHERE user_id = ? AND clock_out IS NULL ORDER BY clock_in DESC LIMIT 1`)
    .bind(target.id)
    .first<any>()

  if (!record) {
    return c.json({ error: 'Not clocked in' }, 409)
  }

  // Close any open pause
  const openPause = await db
    .prepare(
      `SELECT * FROM punch_pauses WHERE punch_record_id = ? AND resumed_at IS NULL ORDER BY paused_at DESC LIMIT 1`
    )
    .bind(record.id)
    .first<any>()

  if (openPause) {
    const elapsed = Math.floor(
      (Date.now() - new Date(openPause.paused_at).getTime()) / 1000
    )
    await db
      .prepare(`UPDATE punch_pauses SET resumed_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`)
      .bind(openPause.id)
      .run()
    await db
      .prepare(`UPDATE punch_records SET pause_seconds = pause_seconds + ? WHERE id = ?`)
      .bind(elapsed, record.id)
      .run()
  }

  await db
    .prepare(`UPDATE punch_records SET clock_out = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`)
    .bind(record.id)
    .run()

  return c.json({
    ok: true,
    action: 'clockOut',
    displayName: target.displayName,
    time: new Date().toISOString(),
    note: null,
  })
})

// POST /terminal/punch/pause
terminal.post('/punch/pause', async (c) => {
  const user = c.get('user')
  const db = c.env.DB
  const body = await c.req.json<{ pin: string; userId: string }>()

  if (!body.pin || !body.userId) {
    return c.json({ error: 'pin and userId are required' }, 400)
  }

  const orgId = await getOrgId(db, user.id)
  if (!orgId) {
    return c.json({ error: 'Not in an organisation' }, 403)
  }

  const target = await resolveUserByPin(db, orgId, body.userId, body.pin)
  if (!target) {
    return c.json({ error: 'Invalid PIN or user not found' }, 401)
  }

  const record = await db
    .prepare(`SELECT * FROM punch_records WHERE user_id = ? AND clock_out IS NULL ORDER BY clock_in DESC LIMIT 1`)
    .bind(target.id)
    .first<any>()

  if (!record) {
    return c.json({ error: 'Not clocked in' }, 409)
  }

  const openPause = await db
    .prepare(`SELECT id FROM punch_pauses WHERE punch_record_id = ? AND resumed_at IS NULL LIMIT 1`)
    .bind(record.id)
    .first()

  if (openPause) {
    return c.json({ error: 'Already paused' }, 409)
  }

  const pauseId = crypto.randomUUID()
  await db
    .prepare(
      `INSERT INTO punch_pauses (id, punch_record_id, paused_at, resumed_at)
       VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'), NULL)`
    )
    .bind(pauseId, record.id)
    .run()

  return c.json({
    ok: true,
    action: 'pause',
    displayName: target.displayName,
    time: new Date().toISOString(),
    note: null,
  })
})

// POST /terminal/punch/resume
terminal.post('/punch/resume', async (c) => {
  const user = c.get('user')
  const db = c.env.DB
  const body = await c.req.json<{ pin: string; userId: string }>()

  if (!body.pin || !body.userId) {
    return c.json({ error: 'pin and userId are required' }, 400)
  }

  const orgId = await getOrgId(db, user.id)
  if (!orgId) {
    return c.json({ error: 'Not in an organisation' }, 403)
  }

  const target = await resolveUserByPin(db, orgId, body.userId, body.pin)
  if (!target) {
    return c.json({ error: 'Invalid PIN or user not found' }, 401)
  }

  const record = await db
    .prepare(`SELECT * FROM punch_records WHERE user_id = ? AND clock_out IS NULL ORDER BY clock_in DESC LIMIT 1`)
    .bind(target.id)
    .first<any>()

  if (!record) {
    return c.json({ error: 'Not clocked in' }, 409)
  }

  const openPause = await db
    .prepare(
      `SELECT * FROM punch_pauses WHERE punch_record_id = ? AND resumed_at IS NULL ORDER BY paused_at DESC LIMIT 1`
    )
    .bind(record.id)
    .first<any>()

  if (!openPause) {
    return c.json({ error: 'Not paused' }, 409)
  }

  const elapsed = Math.floor(
    (Date.now() - new Date(openPause.paused_at).getTime()) / 1000
  )

  await db
    .prepare(`UPDATE punch_pauses SET resumed_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`)
    .bind(openPause.id)
    .run()

  await db
    .prepare(`UPDATE punch_records SET pause_seconds = pause_seconds + ? WHERE id = ?`)
    .bind(elapsed, record.id)
    .run()

  return c.json({
    ok: true,
    action: 'resume',
    displayName: target.displayName,
    time: new Date().toISOString(),
    note: null,
  })
})

export default terminal
