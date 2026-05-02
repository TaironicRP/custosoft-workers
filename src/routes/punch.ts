import { Hono } from 'hono'
import { requireAuth } from '../middleware/auth'
import type { Env, AppEnv } from '../types'

const punch = new Hono<AppEnv>()

punch.use('*', requireAuth)

// ─── Helpers ────────────────────────────────────────────────────────────────

function buildPunchRecord(row: any) {
  return {
    id: row.id,
    userId: row.user_id ?? row.userId,
    orgId: row.org_id ?? row.orgId,
    clockIn: row.clock_in ?? row.clockIn,
    clockOut: row.clock_out ?? row.clockOut,
    pauseSeconds: row.pause_seconds ?? row.pauseSeconds ?? 0,
    note: row.note ?? null,
    isManual: (row.is_manual ?? row.isManual) === 1,
  }
}

async function getCurrentRecord(db: any, userId: string) {
  return db
    .prepare(
      `SELECT * FROM punch_records
       WHERE user_id = ? AND clock_out IS NULL
       ORDER BY clock_in DESC LIMIT 1`
    )
    .bind(userId)
    .first<any>()
}

async function getCurrentPause(db: any, recordId: string) {
  return db
    .prepare(
      `SELECT * FROM punch_pauses
       WHERE punch_record_id = ? AND resumed_at IS NULL
       ORDER BY paused_at DESC LIMIT 1`
    )
    .bind(recordId)
    .first<any>()
}

function getPeriodDates(period: string): { from: string; to: string } {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const dateStr = (d: Date) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

  switch (period) {
    case 'today':
      return { from: dateStr(now), to: dateStr(now) }
    case 'week': {
      const day = now.getDay()
      const diffToMon = (day + 6) % 7
      const mon = new Date(now)
      mon.setDate(now.getDate() - diffToMon)
      return { from: dateStr(mon), to: dateStr(now) }
    }
    case 'twoWeeks': {
      const two = new Date(now)
      two.setDate(now.getDate() - 13)
      return { from: dateStr(two), to: dateStr(now) }
    }
    case 'month': {
      const m = new Date(now.getFullYear(), now.getMonth(), 1)
      return { from: dateStr(m), to: dateStr(now) }
    }
    case 'threeMonths': {
      const three = new Date(now)
      three.setMonth(now.getMonth() - 3)
      return { from: dateStr(three), to: dateStr(now) }
    }
    case 'year': {
      const y = new Date(now.getFullYear(), 0, 1)
      return { from: dateStr(y), to: dateStr(now) }
    }
    default:
      return { from: dateStr(now), to: dateStr(now) }
  }
}

async function computeStats(db: any, userId: string, period: string) {
  const { from, to } = getPeriodDates(period)

  const records = await db
    .prepare(
      `SELECT * FROM punch_records
       WHERE user_id = ?
         AND date(clock_in) >= ?
         AND date(clock_in) <= ?
         AND clock_out IS NOT NULL
       ORDER BY clock_in ASC`
    )
    .bind(userId, from, to)
    .all()

  const rows: any[] = records.results ?? []

  let totalSeconds = 0
  let totalPauseSeconds = 0
  let pauseCount = 0
  let longestDaySeconds = 0

  const dailyMap: Record<string, { workSeconds: number; pauseSeconds: number }> = {}

  for (const row of rows) {
    const clockIn = new Date(row.clock_in)
    const clockOut = new Date(row.clock_out)
    const gross = Math.floor((clockOut.getTime() - clockIn.getTime()) / 1000)
    const pauseSec = row.pause_seconds ?? 0
    const net = Math.max(0, gross - pauseSec)

    totalSeconds += net
    totalPauseSeconds += pauseSec

    const pauses = await db
      .prepare(`SELECT COUNT(*) as cnt FROM punch_pauses WHERE punch_record_id = ?`)
      .bind(row.id)
      .first<{ cnt: number }>()
    pauseCount += pauses?.cnt ?? 0

    const dateKey = row.clock_in.substring(0, 10)
    if (!dailyMap[dateKey]) {
      dailyMap[dateKey] = { workSeconds: 0, pauseSeconds: 0 }
    }
    dailyMap[dateKey].workSeconds += net
    dailyMap[dateKey].pauseSeconds += pauseSec
    if (dailyMap[dateKey].workSeconds > longestDaySeconds) {
      longestDaySeconds = dailyMap[dateKey].workSeconds
    }
  }

  const dailyBreakdown = Object.entries(dailyMap)
    .map(([date, v]) => ({ date, workSeconds: v.workSeconds, pauseSeconds: v.pauseSeconds }))
    .sort((a, b) => a.date.localeCompare(b.date))

  const totalDays = dailyBreakdown.length
  const averageSecondsPerDay = totalDays > 0 ? Math.floor(totalSeconds / totalDays) : 0

  return {
    period,
    totalSeconds,
    averageSecondsPerDay,
    totalDays,
    longestDaySeconds,
    dailyBreakdown,
    totalPauseSeconds,
    pauseCount,
  }
}

// ─── Routes ─────────────────────────────────────────────────────────────────

// GET /punch/status
punch.get('/status', async (c) => {
  const user = c.get('user')
  const db = c.env.DB

  const currentRecord = await getCurrentRecord(db, user.id)
  const isClockedIn = !!currentRecord
  let isPaused = false
  let currentPause = null

  if (currentRecord) {
    const pause = await getCurrentPause(db, currentRecord.id)
    isPaused = !!pause
    if (pause) {
      currentPause = {
        id: pause.id,
        punchRecordId: pause.punch_record_id,
        pausedAt: pause.paused_at,
        resumedAt: pause.resumed_at ?? null,
      }
    }
  }

  return c.json({
    isClockedIn,
    isPaused,
    currentRecord: currentRecord ? buildPunchRecord(currentRecord) : null,
    currentPause,
  })
})

// POST /punch/in
punch.post('/in', async (c) => {
  const user = c.get('user')
  const db = c.env.DB

  const existing = await getCurrentRecord(db, user.id)
  if (existing) {
    return c.json({ error: 'Already clocked in' }, 409)
  }

  const body = await c.req.json<{ note?: string }>().catch(() => ({}))

  const orgMember = await db
    .prepare(`SELECT org_id FROM org_members WHERE user_id = ? LIMIT 1`)
    .bind(user.id)
    .first<{ org_id: string }>()

  const id = crypto.randomUUID()
  await db
    .prepare(
      `INSERT INTO punch_records (id, user_id, org_id, clock_in, clock_out, pause_seconds, note, is_manual)
       VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'), NULL, 0, ?, 0)`
    )
    .bind(id, user.id, orgMember?.org_id ?? null, body.note ?? null)
    .run()

  const record = await db.prepare(`SELECT * FROM punch_records WHERE id = ?`).bind(id).first<any>()

  return c.json(buildPunchRecord(record), 201)
})

// POST /punch/out
punch.post('/out', async (c) => {
  const user = c.get('user')
  const db = c.env.DB

  const record = await getCurrentRecord(db, user.id)
  if (!record) {
    return c.json({ error: 'Not clocked in' }, 409)
  }

  const body = await c.req.json<{ note?: string }>().catch(() => ({}))

  // Close any open pause first
  const openPause = await getCurrentPause(db, record.id)
  if (openPause) {
    const pausedAt = new Date(openPause.paused_at)
    const now = new Date()
    const extraPause = Math.floor((now.getTime() - pausedAt.getTime()) / 1000)
    await db
      .prepare(
        `UPDATE punch_pauses SET resumed_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
         WHERE id = ?`
      )
      .bind(openPause.id)
      .run()
    await db
      .prepare(
        `UPDATE punch_records SET pause_seconds = pause_seconds + ? WHERE id = ?`
      )
      .bind(extraPause, record.id)
      .run()
  }

  await db
    .prepare(
      `UPDATE punch_records
       SET clock_out = strftime('%Y-%m-%dT%H:%M:%SZ','now'),
           note = COALESCE(?, note)
       WHERE id = ?`
    )
    .bind(body.note ?? null, record.id)
    .run()

  const updated = await db.prepare(`SELECT * FROM punch_records WHERE id = ?`).bind(record.id).first<any>()

  return c.json(buildPunchRecord(updated))
})

// POST /punch/pause
punch.post('/pause', async (c) => {
  const user = c.get('user')
  const db = c.env.DB

  const record = await getCurrentRecord(db, user.id)
  if (!record) {
    return c.json({ error: 'Not clocked in' }, 409)
  }

  const openPause = await getCurrentPause(db, record.id)
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

  const pause = await db.prepare(`SELECT * FROM punch_pauses WHERE id = ?`).bind(pauseId).first<any>()

  return c.json({
    isClockedIn: true,
    isPaused: true,
    currentRecord: buildPunchRecord(record),
    currentPause: {
      id: pause.id,
      punchRecordId: pause.punch_record_id,
      pausedAt: pause.paused_at,
      resumedAt: null,
    },
  })
})

// POST /punch/resume
punch.post('/resume', async (c) => {
  const user = c.get('user')
  const db = c.env.DB

  const record = await getCurrentRecord(db, user.id)
  if (!record) {
    return c.json({ error: 'Not clocked in' }, 409)
  }

  const openPause = await getCurrentPause(db, record.id)
  if (!openPause) {
    return c.json({ error: 'Not paused' }, 409)
  }

  const pausedAt = new Date(openPause.paused_at)
  const now = new Date()
  const elapsed = Math.floor((now.getTime() - pausedAt.getTime()) / 1000)

  await db
    .prepare(
      `UPDATE punch_pauses SET resumed_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`
    )
    .bind(openPause.id)
    .run()

  await db
    .prepare(`UPDATE punch_records SET pause_seconds = pause_seconds + ? WHERE id = ?`)
    .bind(elapsed, record.id)
    .run()

  const updatedRecord = await db.prepare(`SELECT * FROM punch_records WHERE id = ?`).bind(record.id).first<any>()

  return c.json({
    isClockedIn: true,
    isPaused: false,
    currentRecord: buildPunchRecord(updatedRecord),
    currentPause: null,
  })
})

// GET /punch/records
punch.get('/records', async (c) => {
  const user = c.get('user')
  const db = c.env.DB
  const from = c.req.query('from')
  const to = c.req.query('to')
  const page = Math.max(1, parseInt(c.req.query('page') ?? '1'))
  const pageSize = Math.min(200, parseInt(c.req.query('pageSize') ?? '50'))
  const offset = (page - 1) * pageSize

  let query = `SELECT * FROM punch_records WHERE user_id = ?`
  const bindings: any[] = [user.id]

  if (from) {
    query += ` AND date(clock_in) >= ?`
    bindings.push(from)
  }
  if (to) {
    query += ` AND date(clock_in) <= ?`
    bindings.push(to)
  }

  query += ` ORDER BY clock_in DESC LIMIT ? OFFSET ?`
  bindings.push(pageSize, offset)

  const records = await db
    .prepare(query)
    .bind(...bindings)
    .all()

  return c.json({
    page,
    pageSize,
    records: (records.results ?? []).map(buildPunchRecord),
  })
})

// PUT /punch/records/:id
punch.put('/records/:id', async (c) => {
  const user = c.get('user')
  const db = c.env.DB
  const id = c.req.param('id')
  const body = await c.req.json<{ note?: string }>()

  const record = await db
    .prepare(`SELECT * FROM punch_records WHERE id = ? AND user_id = ?`)
    .bind(id, user.id)
    .first<any>()

  if (!record) {
    return c.json({ error: 'Record not found' }, 404)
  }

  await db
    .prepare(`UPDATE punch_records SET note = ? WHERE id = ?`)
    .bind(body.note ?? null, id)
    .run()

  const updated = await db.prepare(`SELECT * FROM punch_records WHERE id = ?`).bind(id).first<any>()

  return c.json(buildPunchRecord(updated))
})

// DELETE /punch/records/:id
punch.delete('/records/:id', async (c) => {
  const user = c.get('user')
  const db = c.env.DB
  const id = c.req.param('id')

  const record = await db
    .prepare(`SELECT * FROM punch_records WHERE id = ? AND user_id = ?`)
    .bind(id, user.id)
    .first()

  if (!record) {
    return c.json({ error: 'Record not found' }, 404)
  }

  await db.prepare(`DELETE FROM punch_pauses WHERE punch_record_id = ?`).bind(id).run()
  await db.prepare(`DELETE FROM punch_records WHERE id = ?`).bind(id).run()

  return c.json({ ok: true })
})

// GET /punch/stats
punch.get('/stats', async (c) => {
  const user = c.get('user')
  const db = c.env.DB
  const period = c.req.query('period') ?? 'week'

  const stats = await computeStats(db, user.id, period)
  return c.json(stats)
})

// GET /punch/stats/:userId
punch.get('/stats/:userId', async (c) => {
  const user = c.get('user')
  const db = c.env.DB
  const targetUserId = c.req.param('userId')
  const period = c.req.query('period') ?? 'week'

  const orgMember = await db
    .prepare(`SELECT org_role FROM org_members WHERE user_id = ? LIMIT 1`)
    .bind(user.id)
    .first<{ org_role: string }>()

  const canView =
    orgMember?.org_role === 'Owner' ||
    orgMember?.org_role === 'Admin' ||
    (await db
      .prepare(`SELECT can_view_salaries FROM org_members WHERE user_id = ? LIMIT 1`)
      .bind(user.id)
      .first<{ can_view_salaries: number }>()
      .then((r) => r?.can_view_salaries === 1))

  if (!canView) {
    return c.json({ error: 'Insufficient permissions' }, 403)
  }

  const stats = await computeStats(db, targetUserId, period)
  return c.json(stats)
})

// GET /punch/team
punch.get('/team', async (c) => {
  const user = c.get('user')
  const db = c.env.DB

  const orgMember = await db
    .prepare(`SELECT org_id FROM org_members WHERE user_id = ? LIMIT 1`)
    .bind(user.id)
    .first<{ org_id: string }>()

  if (!orgMember) {
    return c.json({ error: 'Not in an organisation' }, 403)
  }

  const members = await db
    .prepare(
      `SELECT
        u.id AS userId,
        u.display_name AS displayName,
        u.avatar_url AS avatarUrl,
        u.position_title AS positionTitle,
        (
          SELECT json_object(
            'id', pr.id,
            'clockIn', pr.clock_in,
            'clockOut', pr.clock_out,
            'pauseSeconds', pr.pause_seconds,
            'note', pr.note
          )
          FROM punch_records pr
          WHERE pr.user_id = u.id AND pr.clock_out IS NULL
          ORDER BY pr.clock_in DESC LIMIT 1
        ) AS currentRecordJson
      FROM org_members om
      INNER JOIN users u ON u.id = om.user_id
      WHERE om.org_id = ?
      ORDER BY u.display_name`
    )
    .bind(orgMember.org_id)
    .all()

  const result = (members.results ?? []).map((m: any) => {
    const cr = m.currentRecordJson ? JSON.parse(m.currentRecordJson) : null
    return {
      userId: m.userId,
      displayName: m.displayName,
      avatarUrl: m.avatarUrl,
      positionTitle: m.positionTitle,
      isClockedIn: !!cr,
      currentRecord: cr,
    }
  })

  return c.json(result)
})

// GET /punch/team/:userId
punch.get('/team/:userId', async (c) => {
  const user = c.get('user')
  const db = c.env.DB
  const targetUserId = c.req.param('userId')
  const from = c.req.query('from')
  const to = c.req.query('to')

  const orgMember = await db
    .prepare(`SELECT org_id, org_role FROM org_members WHERE user_id = ? LIMIT 1`)
    .bind(user.id)
    .first<{ org_id: string; org_role: string }>()

  if (!orgMember) {
    return c.json({ error: 'Not in an organisation' }, 403)
  }

  const canView = ['Owner', 'Admin', 'Manager'].includes(orgMember.org_role)
  if (!canView) {
    return c.json({ error: 'Insufficient permissions' }, 403)
  }

  let query = `SELECT * FROM punch_records WHERE user_id = ?`
  const bindings: any[] = [targetUserId]

  if (from) {
    query += ` AND date(clock_in) >= ?`
    bindings.push(from)
  }
  if (to) {
    query += ` AND date(clock_in) <= ?`
    bindings.push(to)
  }

  query += ` ORDER BY clock_in DESC LIMIT 100`

  const records = await db
    .prepare(query)
    .bind(...bindings)
    .all()

  return c.json((records.results ?? []).map(buildPunchRecord))
})

export default punch
