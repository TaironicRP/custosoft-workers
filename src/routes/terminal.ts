// ── Terminal Routes — Wand-Stempeluhr ────────────────────────────────────────
//
// Workflow (V2 — Code-basiert):
//   1. Owner/Admin/User mit TerminalMode-Lizenz aktiviert auf einem Gerät den
//      Kiosk-Modus.
//   2. Kiosk-Gerät bleibt mit dem Owner-JWT eingeloggt.
//   3. Mitarbeiter geben am Kiosk ihren persönlichen 7-stelligen Code ein.
//   4. POST /terminal/punch-by-code verifiziert den Code und führt direkt die
//      passende Punch-Aktion aus (toggle in/out / pause / resume) oder gibt
//      Status zurück damit der User den nächsten Schritt wählen kann.
//
// Auth-Modell: Owner-JWT autorisiert die Anwesenheit am Kiosk. Die
// Mitarbeiter-Identität wird durch den 7-stelligen Code bestätigt.
// Punch-Daten landen in der GLEICHEN Tabelle (`punch_entries`) wie wenn der
// Mitarbeiter selbst aus seinem Account stempelt → Status & Stats sind synced.

import { Hono } from 'hono'
import { requireAuth } from '../middleware/auth'
import type { AppEnv } from '../types'

const terminal = new Hono<AppEnv>()
terminal.use('*', requireAuth)

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getOrgId(db: D1Database, userId: string): Promise<number | null> {
  const row = await db
    .prepare(`SELECT org_id FROM org_members WHERE user_id = ? AND is_active = 1 LIMIT 1`)
    .bind(userId)
    .first<{ org_id: number }>()
  return row?.org_id ?? null
}

function buildName(first: string | null | undefined, last: string | null | undefined, email: string): string {
  return (`${first ?? ''} ${last ?? ''}`.trim()) || email
}

/**
 * Owner/Admin oder TerminalMode-Lizenz erlaubt es das Gerät als Kiosk laufen zu lassen.
 */
async function deviceCanRunKiosk(db: D1Database, userId: string): Promise<boolean> {
  const role = await db
    .prepare(`SELECT role FROM org_members WHERE user_id = ? AND is_active = 1 LIMIT 1`)
    .bind(userId)
    .first<{ role: string }>()
  if (role && ['Owner', 'Admin'].includes(role.role)) return true

  const ext = await db
    .prepare(`SELECT 1 FROM user_extensions
              WHERE user_id = ? AND product = 'TerminalMode' AND is_active = 1
                AND (expires_at IS NULL OR expires_at > strftime('%Y-%m-%dT%H:%M:%SZ','now'))
              LIMIT 1`)
    .bind(userId)
    .first()
  return !!ext
}

/** Generiert einen 7-stelligen numerischen Code, garantiert kollisionsfrei. */
async function generateUniqueCode(db: D1Database): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const code = String(Math.floor(1_000_000 + Math.random() * 9_000_000))
    const existing = await db
      .prepare(`SELECT 1 FROM users WHERE terminal_code = ?`)
      .bind(code).first()
    if (!existing) return code
  }
  // Fallback: timestamp-basiert
  return String(1_000_000 + (Date.now() % 9_000_000))
}

async function ensureTerminalCode(db: D1Database, userId: string): Promise<string> {
  const row = await db
    .prepare(`SELECT terminal_code FROM users WHERE id = ?`)
    .bind(userId)
    .first<{ terminal_code: string | null }>()
  if (row?.terminal_code) return row.terminal_code
  const code = await generateUniqueCode(db)
  await db.prepare(`UPDATE users SET terminal_code = ? WHERE id = ?`).bind(code, userId).run()
  return code
}

async function currentStatus(db: D1Database, userId: string) {
  const open = await db
    .prepare(`SELECT id FROM punch_entries WHERE user_id = ? AND clock_out IS NULL ORDER BY clock_in DESC LIMIT 1`)
    .bind(userId)
    .first<{ id: number }>()
  let isPaused = false
  if (open) {
    const pause = await db
      .prepare(`SELECT 1 FROM pause_entries WHERE punch_entry_id = ? AND resumed_at IS NULL LIMIT 1`)
      .bind(open.id).first()
    isPaused = !!pause
  }
  return { isClockedIn: !!open, isPaused, openId: open?.id ?? null }
}

// ─── GET /terminal/me/code — eigenen 7-stelligen Code holen (lazy create) ──

terminal.get('/me/code', async (c) => {
  try {
    const userId = c.get('userId') as string
    const code = await ensureTerminalCode(c.env.DB, userId)
    return c.json({ code })
  } catch (e: any) {
    console.error('[GET /terminal/me/code]', e?.message ?? e)
    return c.json({ error: `Code konnte nicht geladen werden: ${e?.message ?? 'unbekannt'}` }, 500)
  }
})

// ─── POST /terminal/me/code/regenerate — neuen Code erzeugen ───────────────

terminal.post('/me/code/regenerate', async (c) => {
  try {
    const userId = c.get('userId') as string
    const code = await generateUniqueCode(c.env.DB)
    await c.env.DB.prepare(`UPDATE users SET terminal_code = ? WHERE id = ?`).bind(code, userId).run()
    return c.json({ code })
  } catch (e: any) {
    console.error('[POST /terminal/me/code/regenerate]', e?.message ?? e)
    return c.json({ error: `Code konnte nicht erneuert werden: ${e?.message ?? 'unbekannt'}` }, 500)
  }
})

// ─── GET /terminal/members — Liste aller Org-Mitarbeiter mit aktuellem Status

terminal.get('/members', async (c) => {
  try {
    const user = c.get('user')
    const db = c.env.DB

    const orgId = await getOrgId(db, user.id)
    if (!orgId) return c.json({ error: 'Nicht in einer Organisation.' }, 403)

    const rows = await db
      .prepare(
        `SELECT
          u.id              AS userId,
          u.first_name      AS firstName,
          u.last_name       AS lastName,
          u.email           AS email,
          u.avatar_url      AS avatarUrl,
          (SELECT COUNT(*) FROM punch_entries pe
             WHERE pe.user_id = u.id AND pe.clock_out IS NULL) > 0 AS isClockedIn,
          (SELECT COUNT(*) FROM punch_entries pe
             INNER JOIN pause_entries ps ON ps.punch_entry_id = pe.id AND ps.resumed_at IS NULL
             WHERE pe.user_id = u.id AND pe.clock_out IS NULL) > 0 AS isPaused
        FROM org_members om
        INNER JOIN users u ON u.id = om.user_id
        WHERE om.org_id = ? AND om.is_active = 1
        ORDER BY u.first_name, u.last_name`
      )
      .bind(orgId)
      .all<any>()

    const result = (rows.results ?? []).map((m: any) => {
      const displayName = buildName(m.firstName, m.lastName, m.email)
      return {
        userId:      m.userId,
        displayName,
        initials:    displayName.split(/\s+/).slice(0, 2).map((s: string) => s.charAt(0).toUpperCase()).join(''),
        avatarUrl:   m.avatarUrl,
        isClockedIn: m.isClockedIn === 1,
        isPaused:    m.isPaused === 1,
      }
    })

    return c.json(result)
  } catch (e: any) {
    console.error('[GET /terminal/members]', e?.message ?? e)
    return c.json({ error: `Mitarbeiter konnten nicht geladen werden: ${e?.message ?? 'unbekannt'}` }, 500)
  }
})

// ─── POST /terminal/punch-by-code ────────────────────────────────────────────
// Body: { code: "1234567", action?: 'auto' | 'in' | 'out' | 'pause' | 'resume' }
//   - 'auto' (Default): toggle basierend auf aktuellem Status
//                       (nicht eingestempelt → in, eingestempelt aktiv → pause,
//                        in pause → resume)
//   - explizit 'in'/'out'/'pause'/'resume' für direkte Aktion
//
// Auth: Owner-JWT (Kiosk-Gerät), Code identifiziert Mitarbeiter.
// Mitarbeiter MUSS in derselben Org sein wie der Kiosk-Owner.
//
// Punch-Daten landen in `punch_entries`/`pause_entries` — exakt die gleichen
// Tabellen die der Mitarbeiter selbst nutzt. Konto-Zeit ist synced.

terminal.post('/punch-by-code', async (c) => {
  try {
    const owner = c.get('user') as any
    const db = c.env.DB

    if (!(await deviceCanRunKiosk(db, owner.id))) {
      return c.json({ error: 'Dieses Gerät hat keine Wand-Stempeluhr-Berechtigung.' }, 403)
    }

    const orgId = await getOrgId(db, owner.id)
    if (!orgId) return c.json({ error: 'Nicht in einer Organisation.' }, 403)

    const body = await c.req.json<{ code?: string; action?: string }>().catch(() => ({}))
    const code = (body.code ?? '').trim()
    const action = (body.action ?? 'auto').toLowerCase()
    if (!code || code.length !== 7 || !/^\d{7}$/.test(code)) {
      return c.json({ error: 'Ungültiger Code (7 Ziffern erwartet).' }, 400)
    }

    // Code → User auflösen + Org-Match prüfen
    const target = await db
      .prepare(
        `SELECT u.id, u.first_name, u.last_name, u.email,
                (SELECT COUNT(*) FROM org_members om WHERE om.user_id = u.id AND om.org_id = ? AND om.is_active = 1) AS sameOrg
         FROM users u
         WHERE u.terminal_code = ?`
      )
      .bind(orgId, code)
      .first<any>()

    if (!target)            return c.json({ error: 'Code unbekannt.' }, 404)
    if (target.sameOrg !== 1) return c.json({ error: 'Mitarbeiter nicht in deiner Organisation.' }, 403)

    const status = await currentStatus(db, target.id)
    const displayName = buildName(target.first_name, target.last_name, target.email)

    // ── Aktion bestimmen
    let executed: 'in' | 'out' | 'pause' | 'resume' | 'noop' = 'noop'
    let message = ''
    const decideAuto = (): typeof executed => {
      if (!status.isClockedIn) return 'in'
      if (status.isPaused)     return 'resume'
      return 'pause'    // standardmäßig nicht direkt out — User soll bewusst out drücken
    }
    const finalAction: typeof executed = action === 'auto' ? decideAuto() :
      (['in', 'out', 'pause', 'resume'].includes(action) ? (action as any) : decideAuto())

    // ── Aktion ausführen
    if (finalAction === 'in') {
      if (status.isClockedIn) return c.json({ error: 'Bereits eingestempelt.', status, displayName }, 409)
      await db
        .prepare(`INSERT INTO punch_entries (user_id, org_id, clock_in, pause_seconds, is_manual)
                  VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'), 0, 0)`)
        .bind(target.id, orgId)
        .run()
      executed = 'in'
      message = `Eingestempelt — schönen Tag, ${displayName}!`
    } else if (finalAction === 'out') {
      if (!status.openId) return c.json({ error: 'Nicht eingestempelt.', status, displayName }, 409)
      // Falls offene Pause → schließen + pause_seconds aufaddieren
      const op = await db
        .prepare(`SELECT * FROM pause_entries WHERE punch_entry_id = ? AND resumed_at IS NULL LIMIT 1`)
        .bind(status.openId).first<any>()
      if (op) {
        const elapsed = Math.floor((Date.now() - new Date(op.paused_at).getTime()) / 1000)
        await db.prepare(`UPDATE pause_entries SET resumed_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`).bind(op.id).run()
        await db.prepare(`UPDATE punch_entries SET pause_seconds = pause_seconds + ? WHERE id = ?`).bind(elapsed, status.openId).run()
      }
      await db.prepare(`UPDATE punch_entries SET clock_out = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`).bind(status.openId).run()
      executed = 'out'
      message = `Ausgestempelt — bis bald, ${displayName}!`
    } else if (finalAction === 'pause') {
      if (!status.openId) return c.json({ error: 'Nicht eingestempelt.', status, displayName }, 409)
      const op = await db
        .prepare(`SELECT 1 FROM pause_entries WHERE punch_entry_id = ? AND resumed_at IS NULL LIMIT 1`)
        .bind(status.openId).first()
      if (op) return c.json({ error: 'Bereits in Pause.', status, displayName }, 409)
      await db
        .prepare(`INSERT INTO pause_entries (punch_entry_id, paused_at) VALUES (?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))`)
        .bind(status.openId).run()
      executed = 'pause'
      message = `Pause begonnen — gute Erholung, ${displayName}.`
    } else if (finalAction === 'resume') {
      if (!status.openId) return c.json({ error: 'Nicht eingestempelt.', status, displayName }, 409)
      const op = await db
        .prepare(`SELECT * FROM pause_entries WHERE punch_entry_id = ? AND resumed_at IS NULL ORDER BY paused_at DESC LIMIT 1`)
        .bind(status.openId).first<any>()
      if (!op) return c.json({ error: 'Aktuell nicht in Pause.', status, displayName }, 409)
      const elapsed = Math.floor((Date.now() - new Date(op.paused_at).getTime()) / 1000)
      await db.prepare(`UPDATE pause_entries SET resumed_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`).bind(op.id).run()
      await db.prepare(`UPDATE punch_entries SET pause_seconds = pause_seconds + ? WHERE id = ?`).bind(elapsed, status.openId).run()
      executed = 'resume'
      message = `Pause beendet — weiter geht's, ${displayName}!`
    }

    // Aktueller Status NACH der Aktion zurückgeben — iOS zeigt die nächsten Buttons an
    const after = await currentStatus(db, target.id)
    return c.json({
      ok:           true,
      action:       executed,
      message,
      userId:       target.id,
      displayName,
      isClockedIn:  after.isClockedIn,
      isPaused:     after.isPaused,
      time:         new Date().toISOString(),
    })
  } catch (e: any) {
    console.error('[POST /terminal/punch-by-code]', e?.message ?? e, e?.stack)
    return c.json({ error: `Stempelaktion fehlgeschlagen: ${e?.message ?? 'unbekannt'}` }, 500)
  }
})

// ─── Legacy-Routes (Email+Passwort-Workflow) — bleiben für Rückwärtskompat ──

terminal.post('/employee-login', async (c) => {
  return c.json({ error: 'Veralteter Endpoint. Bitte Code-basierten Workflow nutzen.' }, 410)
})

export default terminal
