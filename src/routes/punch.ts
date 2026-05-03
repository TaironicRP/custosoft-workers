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
      `SELECT * FROM punch_entries
       WHERE user_id = ? AND clock_out IS NULL
       ORDER BY clock_in DESC LIMIT 1`
    )
    .bind(userId)
    .first<any>()
}

async function getCurrentPause(db: any, recordId: string) {
  return db
    .prepare(
      `SELECT * FROM pause_entries
       WHERE punch_entry_id = ? AND resumed_at IS NULL
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
      `SELECT * FROM punch_entries
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
  const pausesDetail: any[] = []

  for (const row of rows) {
    const clockIn = new Date(row.clock_in)
    const clockOut = new Date(row.clock_out)
    const gross = Math.floor((clockOut.getTime() - clockIn.getTime()) / 1000)
    const pauseSec = row.pause_seconds ?? 0
    const net = Math.max(0, gross - pauseSec)

    totalSeconds += net
    totalPauseSeconds += pauseSec

    // Detail-Pausen pro Punch-Eintrag laden für die Historie in der Akte
    const ps = await db
      .prepare(`SELECT id, paused_at, resumed_at FROM pause_entries WHERE punch_entry_id = ? ORDER BY paused_at ASC`)
      .bind(row.id)
      .all<{ id: number; paused_at: string; resumed_at: string | null }>()
    for (const p of ps.results ?? []) {
      pauseCount += 1
      if (p.resumed_at) {
        const dur = Math.floor((new Date(p.resumed_at).getTime() - new Date(p.paused_at).getTime()) / 1000)
        pausesDetail.push({
          id:              p.id,
          punchEntryId:    row.id,
          startedAt:       p.paused_at,
          endedAt:         p.resumed_at,
          durationSeconds: Math.max(0, dur),
          date:            String(p.paused_at).substring(0, 10),
        })
      }
    }

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
    pauses: pausesDetail,
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
        punchRecordId: pause.punch_entry_id,
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

  const result = await db
    .prepare(
      `INSERT INTO punch_entries (user_id, org_id, clock_in, clock_out, pause_seconds, note, is_manual)
       VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'), NULL, 0, ?, 0)`
    )
    .bind(user.id, orgMember?.org_id ?? null, body.note ?? null)
    .run()

  const newId = result.meta.last_row_id
  const record = await db.prepare(`SELECT * FROM punch_entries WHERE id = ?`).bind(newId).first<any>()

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
        `UPDATE pause_entries SET resumed_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
         WHERE id = ?`
      )
      .bind(openPause.id)
      .run()
    await db
      .prepare(
        `UPDATE punch_entries SET pause_seconds = pause_seconds + ? WHERE id = ?`
      )
      .bind(extraPause, record.id)
      .run()
  }

  await db
    .prepare(
      `UPDATE punch_entries
       SET clock_out = strftime('%Y-%m-%dT%H:%M:%SZ','now'),
           note = COALESCE(?, note)
       WHERE id = ?`
    )
    .bind(body.note ?? null, record.id)
    .run()

  const updated = await db.prepare(`SELECT * FROM punch_entries WHERE id = ?`).bind(record.id).first<any>()

  return c.json(buildPunchRecord(updated))
})

// POST /punch/pause — Rückgabe: PauseRecord (iOS erwartet { id, punchRecordId, pausedAt, resumedAt })
punch.post('/pause', async (c) => {
  try {
    const user = c.get('user')
    const db = c.env.DB

    const record = await getCurrentRecord(db, user.id)
    if (!record) {
      return c.json({ error: 'Nicht eingestempelt.' }, 409)
    }

    const openPause = await getCurrentPause(db, record.id)
    if (openPause) {
      return c.json({ error: 'Bereits in Pause.' }, 409)
    }

    const result = await db
      .prepare(
        `INSERT INTO pause_entries (punch_entry_id, paused_at, resumed_at)
         VALUES (?, strftime('%Y-%m-%dT%H:%M:%SZ','now'), NULL)`
      )
      .bind(record.id)
      .run()
    const pauseId = result.meta.last_row_id

    const pause = await db.prepare(`SELECT * FROM pause_entries WHERE id = ?`).bind(pauseId).first<any>()
    if (!pause) return c.json({ error: 'Pause nicht gefunden nach Erstellung.' }, 500)

    return c.json({
      id:            pause.id,
      punchRecordId: pause.punch_entry_id,
      pausedAt:      pause.paused_at,
      resumedAt:     null,
    }, 201)
  } catch (e: any) {
    console.error('[POST /punch/pause]', e?.message ?? e, e?.stack)
    return c.json({ error: `Pause fehlgeschlagen: ${e?.message ?? 'unbekannt'}` }, 500)
  }
})

// POST /punch/resume — Rückgabe: geschlossener PauseRecord
punch.post('/resume', async (c) => {
  try {
    const user = c.get('user')
    const db = c.env.DB

    const record = await getCurrentRecord(db, user.id)
    if (!record) {
      return c.json({ error: 'Nicht eingestempelt.' }, 409)
    }

    const openPause = await getCurrentPause(db, record.id)
    if (!openPause) {
      return c.json({ error: 'Aktuell nicht in Pause.' }, 409)
    }

    const pausedAt = new Date(openPause.paused_at)
    const now = new Date()
    const elapsed = Math.floor((now.getTime() - pausedAt.getTime()) / 1000)

    await db
      .prepare(`UPDATE pause_entries SET resumed_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`)
      .bind(openPause.id)
      .run()

    await db
      .prepare(`UPDATE punch_entries SET pause_seconds = pause_seconds + ? WHERE id = ?`)
      .bind(elapsed, record.id)
      .run()

    const closed = await db.prepare(`SELECT * FROM pause_entries WHERE id = ?`).bind(openPause.id).first<any>()

    return c.json({
      id:            closed?.id ?? openPause.id,
      punchRecordId: closed?.punch_entry_id ?? record.id,
      pausedAt:      closed?.paused_at ?? openPause.paused_at,
      resumedAt:     closed?.resumed_at ?? new Date().toISOString(),
    })
  } catch (e: any) {
    console.error('[POST /punch/resume]', e?.message ?? e, e?.stack)
    return c.json({ error: `Fortsetzen fehlgeschlagen: ${e?.message ?? 'unbekannt'}` }, 500)
  }
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

  let query = `SELECT * FROM punch_entries WHERE user_id = ?`
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

  // PaginatedResponse-Shape (iOS erwartet: items, totalCount, page, pageSize)
  let totalQuery = `SELECT COUNT(*) AS n FROM punch_entries WHERE user_id = ?`
  const totalBinds: any[] = [user.id]
  if (from) { totalQuery += ` AND date(clock_in) >= ?`; totalBinds.push(from) }
  if (to)   { totalQuery += ` AND date(clock_in) <= ?`; totalBinds.push(to) }
  const totalRow = await db.prepare(totalQuery).bind(...totalBinds).first<{ n: number }>()

  return c.json({
    items:      (records.results ?? []).map(buildPunchRecord),
    totalCount: totalRow?.n ?? 0,
    page,
    pageSize,
  })
})

// PUT /punch/records/:id
punch.put('/records/:id', async (c) => {
  const user = c.get('user')
  const db = c.env.DB
  const id = c.req.param('id')
  const body = await c.req.json<{ note?: string }>()

  const record = await db
    .prepare(`SELECT * FROM punch_entries WHERE id = ? AND user_id = ?`)
    .bind(id, user.id)
    .first<any>()

  if (!record) {
    return c.json({ error: 'Record not found' }, 404)
  }

  await db
    .prepare(`UPDATE punch_entries SET note = ? WHERE id = ?`)
    .bind(body.note ?? null, id)
    .run()

  const updated = await db.prepare(`SELECT * FROM punch_entries WHERE id = ?`).bind(id).first<any>()

  return c.json(buildPunchRecord(updated))
})

// DELETE /punch/records/:id
punch.delete('/records/:id', async (c) => {
  const user = c.get('user')
  const db = c.env.DB
  const id = c.req.param('id')

  const record = await db
    .prepare(`SELECT * FROM punch_entries WHERE id = ? AND user_id = ?`)
    .bind(id, user.id)
    .first()

  if (!record) {
    return c.json({ error: 'Record not found' }, 404)
  }

  await db.prepare(`DELETE FROM pause_entries WHERE punch_entry_id = ?`).bind(id).run()
  await db.prepare(`DELETE FROM punch_entries WHERE id = ?`).bind(id).run()

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
    .prepare(`SELECT role, can_view_salaries FROM org_members
              WHERE user_id = ? AND is_active = 1 LIMIT 1`)
    .bind(user.id)
    .first<{ role: string; can_view_salaries: number }>()

  const canView =
    orgMember?.role === 'Owner' ||
    orgMember?.role === 'Admin' ||
    orgMember?.can_view_salaries === 1

  if (!canView) {
    return c.json({ error: 'Insufficient permissions' }, 403)
  }

  const stats = await computeStats(db, targetUserId, period)
  return c.json(stats)
})

// ─── GET /punch/team/stats — Org-weite Lohnbuchhaltungs-Auswertung ──────────
//     Aggregiert Arbeitszeit + Pausen pro Mitarbeiter im gewählten Zeitraum.
//     Zugriff: Owner, Admin oder can_view_salaries.
punch.get('/team/stats', async (c) => {
  try {
    const user = c.get('user')
    const db = c.env.DB
    const period = c.req.query('period') ?? 'month'

    const me = await db
      .prepare(`SELECT org_id, role, can_view_salaries
                FROM org_members
                WHERE user_id = ? AND is_active = 1 LIMIT 1`)
      .bind(user.id)
      .first<{ org_id: number; role: string; can_view_salaries: number }>()
    if (!me) return c.json({ error: 'Nicht in einer Organisation.' }, 403)

    const allowed = me.role === 'Owner' || me.role === 'Admin' || me.can_view_salaries === 1
    if (!allowed) {
      return c.json({ error: 'Keine Berechtigung — nur Owner/Admin oder mit „Gehälter sehen"-Berechtigung.' }, 403)
    }

    const { from, to } = getPeriodDates(period)

    // Alle aktiven Mitarbeiter der Org laden
    const members = await db
      .prepare(
        `SELECT u.id, u.first_name, u.last_name, u.email, u.avatar_url
         FROM org_members om
         INNER JOIN users u ON u.id = om.user_id
         WHERE om.org_id = ? AND om.is_active = 1
         ORDER BY u.first_name, u.last_name`
      )
      .bind(me.org_id)
      .all<any>()

    let orgTotalSeconds = 0
    let orgTotalPauseSeconds = 0
    let orgPauseCount = 0
    let orgWorkDays = 0

    const perMember: any[] = []
    for (const m of members.results ?? []) {
      const records = await db
        .prepare(
          `SELECT * FROM punch_entries
           WHERE user_id = ?
             AND date(clock_in) >= ?
             AND date(clock_in) <= ?
             AND clock_out IS NOT NULL
           ORDER BY clock_in ASC`
        )
        .bind(m.id, from, to)
        .all<any>()

      let totalSeconds = 0
      let pauseSec    = 0
      let pauseCnt    = 0
      const dayKeys   = new Set<string>()

      for (const r of records.results ?? []) {
        const inT  = new Date(r.clock_in).getTime()
        const outT = new Date(r.clock_out).getTime()
        const gross = Math.floor((outT - inT) / 1000)
        const ps    = r.pause_seconds ?? 0
        totalSeconds += Math.max(0, gross - ps)
        pauseSec     += ps
        dayKeys.add(String(r.clock_in).substring(0, 10))

        const cnt = await db
          .prepare(`SELECT COUNT(*) AS n FROM pause_entries WHERE punch_entry_id = ?`)
          .bind(r.id)
          .first<{ n: number }>()
        pauseCnt += cnt?.n ?? 0
      }

      // Aktuell offene Schicht (clock_out IS NULL) → "Live arbeitend"
      const open = await db
        .prepare(`SELECT 1 FROM punch_entries WHERE user_id = ? AND clock_out IS NULL LIMIT 1`)
        .bind(m.id)
        .first()

      const displayName = (`${m.first_name ?? ''} ${m.last_name ?? ''}`.trim()) || m.email

      orgTotalSeconds      += totalSeconds
      orgTotalPauseSeconds += pauseSec
      orgPauseCount        += pauseCnt
      orgWorkDays          += dayKeys.size

      perMember.push({
        userId:            m.id,
        displayName,
        email:             m.email,
        avatarUrl:         m.avatar_url,
        totalSeconds,
        pauseSeconds:      pauseSec,
        pauseCount:        pauseCnt,
        daysWorked:        dayKeys.size,
        isClockedInNow:    !!open,
      })
    }

    return c.json({
      period,
      from,
      to,
      employees:           perMember.length,
      orgTotalSeconds,
      orgTotalPauseSeconds,
      orgPauseCount,
      orgWorkDays,
      orgAverageSecondsPerEmployee:
        perMember.length > 0 ? Math.floor(orgTotalSeconds / perMember.length) : 0,
      perMember,
    })
  } catch (e: any) {
    console.error('[GET /punch/team/stats]', e?.message ?? e, e?.stack)
    return c.json({ error: `Stats konnten nicht geladen werden: ${e?.message ?? 'unbekannt'}` }, 500)
  }
})

// GET /punch/team
punch.get('/team', async (c) => {
  const user = c.get('user')
  const db = c.env.DB

  const orgMember = await db
    .prepare(`SELECT org_id FROM org_members WHERE user_id = ? AND is_active = 1 LIMIT 1`)
    .bind(user.id)
    .first<{ org_id: number }>()

  if (!orgMember) {
    return c.json({ error: 'Not in an organisation' }, 403)
  }

  // Schema: users hat first_name + last_name (kein display_name), kein position_title
  const members = await db
    .prepare(
      `SELECT
        u.id          AS userId,
        u.first_name  AS firstName,
        u.last_name   AS lastName,
        u.email       AS email,
        u.avatar_url  AS avatarUrl,
        (
          SELECT json_object(
            'id', pr.id,
            'clockIn', pr.clock_in,
            'clockOut', pr.clock_out,
            'pauseSeconds', pr.pause_seconds,
            'note', pr.note
          )
          FROM punch_entries pr
          WHERE pr.user_id = u.id AND pr.clock_out IS NULL
          ORDER BY pr.clock_in DESC LIMIT 1
        ) AS currentRecordJson
      FROM org_members om
      INNER JOIN users u ON u.id = om.user_id
      WHERE om.org_id = ? AND om.is_active = 1
      ORDER BY u.first_name, u.last_name`
    )
    .bind(orgMember.org_id)
    .all()

  const result = (members.results ?? []).map((m: any) => {
    const cr = m.currentRecordJson ? JSON.parse(m.currentRecordJson) : null
    const display = (`${m.firstName ?? ''} ${m.lastName ?? ''}`.trim()) || m.email
    return {
      userId:        m.userId,
      displayName:   display,
      avatarUrl:     m.avatarUrl,
      positionTitle: null,
      isClockedIn:   !!cr,
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
    .prepare(`SELECT org_id, role FROM org_members
              WHERE user_id = ? AND is_active = 1 LIMIT 1`)
    .bind(user.id)
    .first<{ org_id: number; role: string }>()

  if (!orgMember) {
    return c.json({ error: 'Not in an organisation' }, 403)
  }

  const canView = ['Owner', 'Admin'].includes(orgMember.role)
  if (!canView) {
    return c.json({ error: 'Insufficient permissions' }, 403)
  }

  let query = `SELECT * FROM punch_entries WHERE user_id = ?`
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
