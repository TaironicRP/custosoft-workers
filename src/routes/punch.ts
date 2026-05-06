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
//
// Body: { clockIn?, clockOut?, pauseSeconds?, note? } — alle vier optional.
//
// Berechtigungen:
//   - Solo-User (nicht in einer Org): darf seine EIGENEN Records frei
//     bearbeiten. Fremde Records sieht er gar nicht.
//   - In einer Org:
//     · Owner / Admin / can_manage_employee_profiles dürfen ALLE Records
//       (eigene + fremde) bearbeiten — Voraussetzung: das Target ist im
//       gleichen Org-Slot.
//     · Org-Mitglied OHNE eine dieser Permissions darf NICHTS bearbeiten,
//       auch nicht die eigenen Records — Lohn-relevante Daten sind tabu.
punch.put('/records/:id', async (c) => {
  try {
    const user = c.get('user')
    const db = c.env.DB
    const id = c.req.param('id')

    const body = await c.req.json<{
      clockIn?:      string
      clockOut?:     string | null
      pauseSeconds?: number
      note?:         string | null
    }>().catch(() => ({}))

    // Record holen ohne user_id-Filter — den Permission-Check machen wir gleich.
    const record = await db
      .prepare(`SELECT * FROM punch_entries WHERE id = ?`)
      .bind(id).first<any>()
    if (!record) return c.json({ error: 'Record nicht gefunden.' }, 404)

    // Permission-Check
    const myMembership = await db.prepare(
      `SELECT org_id, role, can_manage_employee_profiles
       FROM org_members WHERE user_id = ? AND is_active = 1 LIMIT 1`
    ).bind(user.id).first<{ org_id: number; role: string; can_manage_employee_profiles: number }>()

    const isOwn = record.user_id === user.id
    let allowed = false

    if (!myMembership) {
      // Solo-User: darf nur eigene Records (fremde sieht er nicht)
      allowed = isOwn
    } else {
      const hasManagerPermission =
        myMembership.role === 'Owner' ||
        myMembership.role === 'Admin' ||
        myMembership.can_manage_employee_profiles === 1

      if (!hasManagerPermission) {
        // Mitglied ohne Edit-Recht — keine Bearbeitung, auch nicht eigene
        allowed = false
      } else {
        // Manager: prüfen dass Target in derselben Org ist
        const targetMember = await db.prepare(
          `SELECT 1 FROM org_members WHERE user_id = ? AND org_id = ? AND is_active = 1`
        ).bind(record.user_id, myMembership.org_id).first()
        // Auch wenn der Target seine Org schon verlassen hat: wenn er Records aus
        // genau dieser Org hat, soll der Manager noch nachträglich korrigieren
        // dürfen (Lohnabschluss). Daher zusätzlich: gleiche org_id im record.
        const sameOrg = !!targetMember || record.org_id === myMembership.org_id
        allowed = sameOrg
      }
    }

    if (!allowed) {
      return c.json({
        error: 'Keine Berechtigung. Stempelzeiten in einer Organisation können nur Owner, Admins oder Mitglieder mit „Mitarbeiterprofile verwalten"-Recht bearbeiten.'
      }, 403)
    }

    // ── Updates zusammenbauen ─────────────────────────────────────────────
    const sets: string[] = []
    const binds: any[] = []

    if (body.clockIn !== undefined) {
      // Format-Check: ISO 8601, sonst lehnen wir ab
      if (!isValidIso(body.clockIn)) return c.json({ error: 'clockIn muss ISO-8601 sein.' }, 400)
      sets.push('clock_in = ?'); binds.push(body.clockIn)
    }
    if (body.clockOut !== undefined) {
      if (body.clockOut !== null && !isValidIso(body.clockOut)) {
        return c.json({ error: 'clockOut muss ISO-8601 sein.' }, 400)
      }
      sets.push('clock_out = ?'); binds.push(body.clockOut)
    }
    if (body.pauseSeconds !== undefined) {
      const ps = Number(body.pauseSeconds)
      if (!Number.isFinite(ps) || ps < 0) return c.json({ error: 'pauseSeconds muss ≥ 0 sein.' }, 400)
      sets.push('pause_seconds = ?'); binds.push(Math.floor(ps))
    }
    if (body.note !== undefined) {
      sets.push('note = ?'); binds.push(body.note ?? null)
    }
    // is_manual = 1 markieren wenn ein Manager-Edit (anderer User) ODER Zeit-Felder
    // angefasst wurden — damit die Lohnabrechnung diese Records markieren kann.
    const touchedTime = body.clockIn !== undefined || body.clockOut !== undefined || body.pauseSeconds !== undefined
    const isManagerEdit = !isOwn
    if (touchedTime || isManagerEdit) {
      sets.push('is_manual = 1')
    }

    if (sets.length === 0) {
      // Nichts zu tun — return aktuellen Stand
      return c.json(buildPunchRecord(record))
    }

    binds.push(id)
    await db.prepare(`UPDATE punch_entries SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run()

    // Konsistenz-Check: clockOut muss > clockIn sein wenn beide gesetzt
    const updated = await db.prepare(`SELECT * FROM punch_entries WHERE id = ?`).bind(id).first<any>()
    if (updated?.clock_out && updated.clock_in && new Date(updated.clock_out) < new Date(updated.clock_in)) {
      return c.json({ error: 'clockOut darf nicht vor clockIn liegen.' }, 400)
    }

    // ── Audit-Log: pro tatsächlich geändertem Feld eine Zeile ─────────────
    try {
      const editorRow = await db.prepare(
        `SELECT first_name, last_name, email FROM users WHERE id = ?`
      ).bind(user.id).first<{ first_name: string | null; last_name: string | null; email: string }>()
      const editorName = (`${editorRow?.first_name ?? ''} ${editorRow?.last_name ?? ''}`.trim()) || editorRow?.email || null

      const targetRow = isOwn ? editorRow : await db.prepare(
        `SELECT first_name, last_name, email FROM users WHERE id = ?`
      ).bind(record.user_id).first<{ first_name: string | null; last_name: string | null; email: string }>()
      const targetName = (`${targetRow?.first_name ?? ''} ${targetRow?.last_name ?? ''}`.trim()) || targetRow?.email || null

      const auditRows: Array<[string, string | null, string | null]> = []
      const cmp = (field: string, oldV: any, newV: any) => {
        const o = oldV == null ? null : String(oldV)
        const n = newV == null ? null : String(newV)
        if (o !== n) auditRows.push([field, o, n])
      }
      if (body.clockIn !== undefined)      cmp('clock_in',      record.clock_in,      updated?.clock_in)
      if (body.clockOut !== undefined)     cmp('clock_out',     record.clock_out,     updated?.clock_out)
      if (body.pauseSeconds !== undefined) cmp('pause_seconds', record.pause_seconds, updated?.pause_seconds)
      if (body.note !== undefined)         cmp('note',          record.note,          updated?.note)

      if (auditRows.length > 0) {
        const stmt = db.prepare(
          `INSERT INTO punch_record_audit
             (record_id, editor_user_id, editor_name, target_user_id, target_name, org_id, field, old_value, new_value)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        const batch = auditRows.map(([field, oldV, newV]) =>
          stmt.bind(Number(id), user.id, editorName, record.user_id, targetName, record.org_id ?? null, field, oldV, newV)
        )
        await db.batch(batch)
      }
    } catch (e: any) {
      // Audit-Fehler darf den Update nicht blockieren — nur loggen
      console.warn('[PUT /punch/records/:id] audit write failed:', e?.message ?? e)
    }

    return c.json(buildPunchRecord(updated))
  } catch (e: any) {
    console.error('[PUT /punch/records/:id]', e?.message ?? e, e?.stack)
    return c.json({ error: `Update fehlgeschlagen: ${e?.message ?? 'unbekannt'}` }, 500)
  }
})

function isValidIso(s: string): boolean {
  if (typeof s !== 'string') return false
  const d = new Date(s)
  return !isNaN(d.getTime())
}

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

// ════════════════════════════════════════════════════════════════════════════
//  ARCHIV — Stempelzeiten zurücksetzen + ältere Stände durchsehen
// ════════════════════════════════════════════════════════════════════════════

/// Archiviert alle aktuellen punch_entries des Users und liefert die archive_id
/// + Aggregate zurück. Wird sowohl aus dem User-Reset-Endpoint als auch aus
/// den Org-Hooks (leave/remove/delete) benutzt.
export async function archiveUserPunchEntries(
  db:     D1Database,
  userId: string,
  reason: 'user_reset' | 'org_leave' | 'org_remove' | 'org_delete',
  opts?:  { orgIdFilter?: number | null }
): Promise<{ archiveId: number | null; total: number }> {
  // User-Snapshot (Name/Email)
  const u = await db.prepare(
    `SELECT id, email, first_name, last_name FROM users WHERE id = ?`
  ).bind(userId).first<{ id: string; email: string; first_name: string | null; last_name: string | null }>()

  // Welche Records archivieren?
  //  - user_reset: ALLE Records des Users (er hat keine aktive Org)
  //  - org_*:      nur Records der org_id wenn opts.orgIdFilter gesetzt ist
  let recordsQ =
    `SELECT id, user_id, org_id, clock_in, clock_out, pause_seconds, note, is_manual
     FROM punch_entries
     WHERE user_id = ?`
  const binds: any[] = [userId]
  if (opts?.orgIdFilter != null) {
    recordsQ += ' AND org_id = ?'
    binds.push(opts.orgIdFilter)
  }
  recordsQ += ' ORDER BY clock_in ASC'

  const rows = await db.prepare(recordsQ).bind(...binds).all<any>()
  const records = rows.results ?? []
  if (records.length === 0) return { archiveId: null, total: 0 }

  // Org-Snapshot (Name) wenn org_id gesetzt
  let orgId: number | null = null
  let orgName: string | null = null
  const orgIds = new Set<number>(records.map(r => r.org_id).filter((x: any) => x != null))
  if (orgIds.size === 1) {
    orgId = Array.from(orgIds)[0] as number
    const o = await db.prepare(`SELECT name FROM organisations WHERE id = ?`).bind(orgId).first<{ name: string }>()
    orgName = o?.name ?? null
  } else if (opts?.orgIdFilter != null) {
    orgId = opts.orgIdFilter
    const o = await db.prepare(`SELECT name FROM organisations WHERE id = ?`).bind(orgId).first<{ name: string }>()
    orgName = o?.name ?? null
  }

  // Aggregate berechnen
  let totalSeconds  = 0
  let totalPauseSec = 0
  let firstIn:  string | null = null
  let lastOut: string | null = null
  for (const r of records) {
    if (r.clock_out) {
      const sec = Math.max(0, Math.floor(
        (new Date(r.clock_out).getTime() - new Date(r.clock_in).getTime()) / 1000
      ) - (r.pause_seconds ?? 0))
      totalSeconds += sec
    }
    totalPauseSec += r.pause_seconds ?? 0
    if (!firstIn || r.clock_in < firstIn) firstIn = r.clock_in
    const finalOut = r.clock_out ?? r.clock_in
    if (!lastOut || finalOut > lastOut) lastOut = finalOut
  }

  const displayName = (`${u?.first_name ?? ''} ${u?.last_name ?? ''}`.trim()) || u?.email || null

  // Archiv-Header anlegen
  const ins = await db.prepare(
    `INSERT INTO punch_archives
       (user_id, user_display_name, user_email, org_id, org_name, reason,
        total_entries, total_seconds, total_pause_sec, range_from, range_to)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    userId, displayName, u?.email ?? null, orgId, orgName, reason,
    records.length, totalSeconds, totalPauseSec, firstIn, lastOut,
  ).run()
  const archiveId = Number(ins.meta.last_row_id)

  // Einträge kopieren — batch
  const stmt = db.prepare(
    `INSERT INTO punch_archive_entries
       (archive_id, user_id, org_id, clock_in, clock_out, pause_seconds, note, is_manual)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const batch = records.map(r => stmt.bind(
    archiveId, r.user_id, r.org_id, r.clock_in, r.clock_out,
    r.pause_seconds ?? 0, r.note, r.is_manual ?? 0,
  ))
  await db.batch(batch)

  // Originale + zugehörige Pausen löschen
  const ids = records.map(r => r.id)
  const placeholders = ids.map(() => '?').join(',')
  await db.prepare(`DELETE FROM pause_entries WHERE punch_entry_id IN (${placeholders})`).bind(...ids).run()
  await db.prepare(`DELETE FROM punch_entries     WHERE id IN (${placeholders})`).bind(...ids).run()

  return { archiveId, total: records.length }
}

// POST /punch/reset — User-initiierter Reset (nur ohne aktive Org möglich)
punch.post('/reset', async (c) => {
  try {
    const user = c.get('user')
    const db = c.env.DB

    // Hard-Gate: in Org → Reset verboten. Nur über Org-Verlassen.
    const member = await db
      .prepare('SELECT org_id FROM org_members WHERE user_id = ? AND is_active = 1 LIMIT 1')
      .bind(user.id).first<{ org_id: number }>()
    if (member) {
      return c.json({
        error: 'In einer Organisation kannst du deine Stempeluhr nicht zurücksetzen. Verlasse erst die Organisation — deine Zeiten werden dann automatisch archiviert.',
      }, 403)
    }

    // Falls noch eingestempelt: erst beenden
    const open = await db.prepare(
      `SELECT id FROM punch_entries WHERE user_id = ? AND clock_out IS NULL LIMIT 1`
    ).bind(user.id).first<{ id: number }>()
    if (open) {
      await db.prepare(
        `UPDATE punch_entries SET clock_out = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`
      ).bind(open.id).run()
    }

    const result = await archiveUserPunchEntries(db, user.id, 'user_reset')
    return c.json({
      ok: true,
      archiveId:    result.archiveId,
      archivedCount: result.total,
    })
  } catch (e: any) {
    console.error('[POST /punch/reset]', e?.message ?? e, e?.stack)
    return c.json({ error: `Reset fehlgeschlagen: ${e?.message ?? 'unbekannt'}` }, 500)
  }
})

// GET /punch/archives — eigene Archive-Liste
punch.get('/archives', async (c) => {
  const user = c.get('user')
  const rows = await c.env.DB.prepare(
    `SELECT * FROM punch_archives WHERE user_id = ? ORDER BY created_at DESC`
  ).bind(user.id).all<any>()
  return c.json({
    items: (rows.results ?? []).map(buildArchiveDto),
  })
})

// GET /punch/archives/:id — Detail (Header + Einträge)
punch.get('/archives/:id', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')

  const archive = await c.env.DB.prepare(
    `SELECT * FROM punch_archives WHERE id = ? AND user_id = ?`
  ).bind(id, user.id).first<any>()
  if (!archive) return c.json({ error: 'Archiv nicht gefunden.' }, 404)

  const entries = await c.env.DB.prepare(
    `SELECT * FROM punch_archive_entries WHERE archive_id = ? ORDER BY clock_in ASC`
  ).bind(id).all<any>()

  return c.json({
    ...buildArchiveDto(archive),
    entries: (entries.results ?? []).map(buildArchiveEntryDto),
  })
})

// ── Org-side: Owner sieht alle Archive seiner (auch ehemaligen) Mitglieder ─

// GET /punch/team/archives — Listing aller Org-bezogenen Archive
punch.get('/team/archives', async (c) => {
  const user = c.get('user')
  const me = await c.env.DB.prepare(
    `SELECT org_id, role, can_view_salaries FROM org_members
     WHERE user_id = ? AND is_active = 1 LIMIT 1`
  ).bind(user.id).first<{ org_id: number; role: string; can_view_salaries: number }>()
  if (!me) return c.json({ error: 'Nicht in einer Organisation.' }, 403)

  const allowed = me.role === 'Owner' || me.role === 'Admin' || me.can_view_salaries === 1
  if (!allowed) return c.json({ error: 'Keine Berechtigung.' }, 403)

  const rows = await c.env.DB.prepare(
    `SELECT * FROM punch_archives WHERE org_id = ? ORDER BY created_at DESC`
  ).bind(me.org_id).all<any>()
  return c.json({
    items: (rows.results ?? []).map(buildArchiveDto),
  })
})

// GET /punch/team/archives/:id — Detail (für Org)
punch.get('/team/archives/:id', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')

  const me = await c.env.DB.prepare(
    `SELECT org_id, role, can_view_salaries FROM org_members
     WHERE user_id = ? AND is_active = 1 LIMIT 1`
  ).bind(user.id).first<{ org_id: number; role: string; can_view_salaries: number }>()
  if (!me) return c.json({ error: 'Nicht in einer Organisation.' }, 403)

  const allowed = me.role === 'Owner' || me.role === 'Admin' || me.can_view_salaries === 1
  if (!allowed) return c.json({ error: 'Keine Berechtigung.' }, 403)

  const archive = await c.env.DB.prepare(
    `SELECT * FROM punch_archives WHERE id = ? AND org_id = ?`
  ).bind(id, me.org_id).first<any>()
  if (!archive) return c.json({ error: 'Archiv nicht gefunden.' }, 404)

  const entries = await c.env.DB.prepare(
    `SELECT * FROM punch_archive_entries WHERE archive_id = ? ORDER BY clock_in ASC`
  ).bind(id).all<any>()

  return c.json({
    ...buildArchiveDto(archive),
    entries: (entries.results ?? []).map(buildArchiveEntryDto),
  })
})

// ════════════════════════════════════════════════════════════════════════════
//  AUDIT-LOG — Zeitanpassungen nachvollziehen (wer, bei wem, was, wann)
// ════════════════════════════════════════════════════════════════════════════

// GET /punch/records/:id/audit — Audit-Log eines bestimmten Records
//   Sichtbar wenn:
//   - Record dem User gehört, ODER
//   - User ist Owner/Admin/can_view_salaries der Org des Records
punch.get('/records/:id/audit', async (c) => {
  const user = c.get('user')
  const recordId = c.req.param('id')

  const record = await c.env.DB.prepare(
    `SELECT user_id, org_id FROM punch_entries WHERE id = ?`
  ).bind(recordId).first<{ user_id: string; org_id: number | null }>()
  if (!record) {
    // Record kann inzwischen weg sein — vielleicht in Archiv. Wir prüfen
    // ob's einen archive_entry mit gleicher id gibt — wenn ja: Audit
    // sollte trotzdem zugänglich sein.
    const fromArchive = await c.env.DB.prepare(
      `SELECT user_id, org_id FROM punch_archive_entries WHERE id = ?`
    ).bind(recordId).first<{ user_id: string; org_id: number | null }>()
    if (!fromArchive) return c.json({ error: 'Record nicht gefunden.' }, 404)
  }
  const ownerUserId = record?.user_id
  const recordOrgId = record?.org_id

  let allowed = ownerUserId === user.id
  if (!allowed && recordOrgId != null) {
    const me = await c.env.DB.prepare(
      `SELECT role, can_view_salaries, can_manage_employee_profiles
       FROM org_members WHERE user_id = ? AND org_id = ? AND is_active = 1`
    ).bind(user.id, recordOrgId).first<any>()
    allowed = !!me && (
      me.role === 'Owner' || me.role === 'Admin' ||
      me.can_view_salaries === 1 || me.can_manage_employee_profiles === 1
    )
  }
  if (!allowed) return c.json({ error: 'Keine Berechtigung.' }, 403)

  const rows = await c.env.DB.prepare(
    `SELECT * FROM punch_record_audit WHERE record_id = ? ORDER BY changed_at DESC`
  ).bind(recordId).all<any>()
  return c.json({ items: (rows.results ?? []).map(buildAuditDto) })
})

// GET /punch/team/audit — alle Audit-Einträge der Org (Manager)
punch.get('/team/audit', async (c) => {
  const user = c.get('user')
  const me = await c.env.DB.prepare(
    `SELECT org_id, role, can_view_salaries FROM org_members
     WHERE user_id = ? AND is_active = 1 LIMIT 1`
  ).bind(user.id).first<{ org_id: number; role: string; can_view_salaries: number }>()
  if (!me) return c.json({ error: 'Nicht in einer Org.' }, 403)
  const allowed = me.role === 'Owner' || me.role === 'Admin' || me.can_view_salaries === 1
  if (!allowed) return c.json({ error: 'Keine Berechtigung.' }, 403)

  const limit = Math.min(500, parseInt(c.req.query('limit') ?? '100'))
  const rows = await c.env.DB.prepare(
    `SELECT * FROM punch_record_audit WHERE org_id = ? ORDER BY changed_at DESC LIMIT ?`
  ).bind(me.org_id, limit).all<any>()
  return c.json({ items: (rows.results ?? []).map(buildAuditDto) })
})

function buildAuditDto(row: any) {
  return {
    id:           row.id,
    recordId:     row.record_id,
    editorUserId: row.editor_user_id,
    editorName:   row.editor_name,
    targetUserId: row.target_user_id,
    targetName:   row.target_name,
    orgId:        row.org_id,
    field:        row.field,
    oldValue:     row.old_value,
    newValue:     row.new_value,
    changedAt:    row.changed_at,
  }
}

function buildArchiveDto(row: any) {
  return {
    id:              row.id,
    userId:          row.user_id,
    userDisplayName: row.user_display_name,
    userEmail:       row.user_email,
    orgId:           row.org_id,
    orgName:         row.org_name,
    reason:          row.reason,
    totalEntries:    row.total_entries,
    totalSeconds:    row.total_seconds,
    totalPauseSec:   row.total_pause_sec,
    rangeFrom:       row.range_from,
    rangeTo:         row.range_to,
    createdAt:       row.created_at,
  }
}
function buildArchiveEntryDto(row: any) {
  return {
    id:           row.id,
    clockIn:      row.clock_in,
    clockOut:     row.clock_out,
    pauseSeconds: row.pause_seconds ?? 0,
    note:         row.note,
    isManual:     row.is_manual === 1,
  }
}

export default punch
