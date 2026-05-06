// ────────────────────────────────────────────────────────────────────────────
//  bugs.ts — Bug-Reports + Roadmap + Patch-Notes
//
//  Public:
//    GET  /roadmap                 — Liste sichtbarer Roadmap-Einträge
//    GET  /patch-notes             — Liste publizierter Patch-Notes
//
//  User (auth):
//    POST /bugs                    — Bug-Report erstellen
//    POST /bugs/upload             — Datei (Screenshot/Video/Doc) hochladen → R2
//    GET  /bugs/mine               — eigene Reports listen
//
//  Admin: siehe routes/admin.ts (CRUD für alle drei)
// ────────────────────────────────────────────────────────────────────────────

import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { requireAuth } from '../middleware/auth'
import { uploadToR2, parseFileUpload } from '../utils/r2'
import { sendEmail } from '../utils/email'

const bugs = new Hono<AppEnv>()

// ── PUBLIC: Roadmap ─────────────────────────────────────────────────────────
bugs.get('/roadmap', async (c) => {
  try {
    const rows = await c.env.DB
      .prepare(`SELECT id, quarter, title, description, status, sort_order, updated_at
                FROM roadmap_items
                WHERE is_public = 1
                ORDER BY sort_order ASC`)
      .all<any>()
    return c.json({ items: rows.results ?? [] })
  } catch (e: any) {
    return c.json({ items: [], note: 'roadmap_items missing — run scripts/create_bug_roadmap_patchnotes.sql' })
  }
})

// ── PUBLIC: Patch-Notes ─────────────────────────────────────────────────────
bugs.get('/patch-notes', async (c) => {
  try {
    const platform = c.req.query('platform')   // optional: 'ios'|'mac'|'web'|'all'
    let q = `SELECT id, version, title, body_html, platform, released_at
             FROM patch_notes
             WHERE is_published = 1`
    const binds: any[] = []
    if (platform && platform !== 'all') {
      q += ` AND (platform = ? OR platform = 'all')`
      binds.push(platform)
    }
    q += ` ORDER BY released_at DESC, sort_order DESC`
    const rows = await c.env.DB.prepare(q).bind(...binds).all<any>()
    return c.json({ items: rows.results ?? [] })
  } catch (e: any) {
    return c.json({ items: [] })
  }
})

// ── USER: Datei-Upload für Bug-Anhänge → R2 ──────────────────────────────────
//   Multipart-Form mit Field 'file'. Returns { url, name, type, bytes }.
bugs.post('/bugs/upload', requireAuth, async (c) => {
  const userId = c.get('userId') as string
  const upload = await parseFileUpload(c.req.raw)
  if (!upload) return c.json({ error: 'Keine Datei.' }, 400)

  const MAX = 50 * 1024 * 1024  // 50 MB — erlaubt Screen-Recordings
  if (upload.file.byteLength > MAX) {
    return c.json({ error: 'Datei zu groß. Maximum 50 MB.' }, 413)
  }

  const result = await uploadToR2(
    c.env.UPLOADS, upload.file, upload.filename || 'attachment',
    upload.contentType, `bugs/${userId}`,
  )
  return c.json({
    url:   result.url,
    name:  result.name,
    type:  upload.contentType,
    bytes: result.bytes,
  })
})

// ── USER: Bug-Report erstellen ──────────────────────────────────────────────
bugs.post('/bugs', requireAuth, async (c) => {
  const userId  = c.get('userId') as string
  const userRow = c.get('userRow') as any
  const body = await c.req.json<{
    title:        string
    description?: string
    severity?:    'low' | 'medium' | 'high' | 'critical'
    platform?:    string
    appVersion?:  string
    attachments?: Array<{ url: string; name: string; type: string; bytes: number }>
  }>().catch(() => ({} as any))

  if (!body.title?.trim()) return c.json({ error: 'Titel ist Pflicht.' }, 400)

  const userName  = `${userRow?.first_name ?? ''} ${userRow?.last_name ?? ''}`.trim() || userRow?.email || ''
  const userEmail = userRow?.email ?? null
  const severity  = body.severity ?? 'medium'
  const attJson   = body.attachments?.length ? JSON.stringify(body.attachments) : null

  const ins = await c.env.DB.prepare(
    `INSERT INTO bug_reports
       (user_id, user_email, user_name, title, description,
        severity, status, platform, app_version, attachments)
     VALUES (?, ?, ?, ?, ?, ?, 'new', ?, ?, ?)`
  ).bind(
    userId, userEmail, userName,
    body.title.trim(), body.description ?? null,
    severity, body.platform ?? null, body.appVersion ?? null,
    attJson,
  ).run()

  const newId = Number(ins.meta.last_row_id)

  // ── Dev-Email-Notification ──────────────────────────────────────────────
  // Geht an den Admin-Postfach damit Bugs sofort eintrudeln statt erst beim
  // nächsten Dashboard-Refresh.
  const sevColor = severity === 'critical' ? '#FF3B30' :
                   severity === 'high'     ? '#FF9500' :
                   severity === 'medium'   ? '#FFCC00' : '#8E8E93'
  const sevLabel = severity.toUpperCase()

  const attHtml = (body.attachments ?? []).map((a: { url: string; name: string; type: string; bytes: number }) =>
    `<li style="margin:4px 0">
       <a href="${escapeHtml(a.url)}" style="color:#6abef8">${escapeHtml(a.name)}</a>
       <span style="color:rgba(255,255,255,0.45);font-size:11px"> · ${(a.bytes / 1024).toFixed(0)} KB · ${escapeHtml(a.type)}</span>
     </li>`).join('')

  await sendEmail({
    to:           c.env.FROM_EMAIL,           // an unsere eigene Postfach-Adresse
    toName:       'CustoSoft Dev',
    subject:      `🐛 [${sevLabel}] ${body.title.slice(0, 60)}`,
    text:         `Neuer Bug-Report\n\nVon: ${userName} (${userEmail})\nSeverity: ${severity}\nPlattform: ${body.platform ?? '—'}\nApp-Version: ${body.appVersion ?? '—'}\n\n${body.description ?? ''}\n\nAdmin-Link: https://custosoft-api.davidschroedinger.workers.dev/admin#bugs/${newId}`,
    html:         `<div style="font-family:-apple-system,sans-serif;background:#0a0a14;color:#fff;padding:32px;max-width:560px;margin:0 auto;border-radius:16px">
                     <div style="display:flex;align-items:center;gap:8px;margin-bottom:20px">
                       <span style="font-size:24px">🐛</span>
                       <span style="font-size:11px;font-weight:700;letter-spacing:1px;color:${sevColor};background:${sevColor}22;padding:4px 10px;border-radius:6px">${sevLabel}</span>
                     </div>
                     <h2 style="margin:0 0 8px;font-size:20px">${escapeHtml(body.title)}</h2>
                     <div style="font-size:13px;color:rgba(255,255,255,0.55);margin-bottom:16px">
                       von <strong style="color:#fff">${escapeHtml(userName)}</strong> &lt;${escapeHtml(userEmail ?? '')}&gt; · ${escapeHtml(body.platform ?? '—')}${body.appVersion ? ' · v' + escapeHtml(body.appVersion) : ''}
                     </div>
                     <div style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:16px;font-size:14px;line-height:1.6;color:rgba(255,255,255,0.85);white-space:pre-wrap">${escapeHtml(body.description ?? '')}</div>
                     ${attHtml ? `<div style="margin-top:16px"><div style="font-size:11px;font-weight:700;color:rgba(255,255,255,0.4);letter-spacing:1px;margin-bottom:6px">ANHÄNGE</div><ul style="margin:0;padding-left:16px;font-size:13px">${attHtml}</ul></div>` : ''}
                     <a href="https://custosoft-api.davidschroedinger.workers.dev/admin" style="display:inline-block;margin-top:24px;background:linear-gradient(135deg,#7733dd,#3355ff);color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-weight:600;font-size:14px">Im Admin öffnen →</a>
                   </div>`,
    from:         c.env.FROM_EMAIL,
    fromName:     c.env.FROM_NAME,
    apiKey:       c.env.RESEND_API_KEY,
    db:           c.env.DB,
    templateKey:  'bug_report',
    userId:       userId,
  })

  return c.json({ ok: true, id: newId })
})

// ── USER: eigene Bugs listen ────────────────────────────────────────────────
bugs.get('/bugs/mine', requireAuth, async (c) => {
  const userId = c.get('userId') as string
  const rows = await c.env.DB
    .prepare(`SELECT id, title, severity, status, platform, app_version,
                     attachments, created_at, updated_at
              FROM bug_reports
              WHERE user_id = ?
              ORDER BY created_at DESC
              LIMIT 50`)
    .bind(userId)
    .all<any>()
  return c.json({
    items: (rows.results ?? []).map((r: any) => ({
      ...r,
      attachments: r.attachments ? JSON.parse(r.attachments) : [],
    })),
  })
})

function escapeHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

export default bugs
