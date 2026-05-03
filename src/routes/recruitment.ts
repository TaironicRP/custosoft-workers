import { Hono } from 'hono'
import { requireAuth } from '../middleware/auth'
import type { Env, AppEnv } from '../types'
import { uploadToR2, parseFileUpload } from '../utils/r2'

const recruitment = new Hono<AppEnv>()

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildLinkDto(row: any): Record<string, any> {
  const code: string = row.code
  return {
    id: row.id,
    orgId: row.org_id ?? row.orgId,
    orgName: row.org_name ?? row.orgName ?? null,
    code,
    title: row.title,
    description: row.description ?? null,
    positionId: row.position_id ?? row.positionId ?? null,
    positionTitle: row.position_title ?? row.positionTitle ?? null,
    createdByUserId: row.created_by_user_id ?? row.createdByUserId,
    createdByName: row.created_by_name ?? row.createdByName ?? null,
    createdAt: row.created_at ?? row.createdAt,
    expiresAt: row.expires_at ?? row.expiresAt ?? null,
    isActive: (row.is_active ?? row.isActive) === 1,
    usedCount: row.used_count ?? row.usedCount ?? 0,
    publicUrl: `https://custosoft.de/apply/${code}`,
  }
}

function buildApplicationDto(row: any) {
  return {
    id: row.id,
    linkId: row.link_id ?? row.linkId,
    orgId: row.org_id ?? row.orgId,
    firstName: row.first_name ?? row.firstName,
    lastName: row.last_name ?? row.lastName,
    email: row.email,
    phone: row.phone ?? null,
    coverLetter: row.cover_letter ?? row.coverLetter ?? null,
    status: row.status,
    internalNotes: row.internal_notes ?? row.internalNotes ?? null,
    assignedToUserId: row.assigned_to_user_id ?? row.assignedToUserId ?? null,
    attachmentUrl: row.attachment_url ?? row.attachmentUrl ?? null,
    submittedAt: row.submitted_at ?? row.submittedAt,
    updatedAt: row.last_updated_at ?? row.updated_at ?? row.updatedAt ?? null,
  }
}

// ─── Protected routes (requireAuth direkt an jeder Route, glob-pattern unzuverlässig) ──

// GET /recruitment/links
recruitment.get('/links', requireAuth, async (c) => {
  const userId = c.get('userId') as string
  const db = c.env.DB

  const orgMember = await db
    .prepare(`SELECT org_id FROM org_members WHERE user_id = ? AND is_active = 1 LIMIT 1`)
    .bind(userId).first<{ org_id: number }>()

  if (!orgMember) return c.json([])

  const rows = await db
    .prepare(
      `SELECT jl.*, o.name AS org_name, op.title AS position_title,
              (SELECT COUNT(*) FROM job_applications ja WHERE ja.link_id = jl.id) AS used_count
       FROM job_links jl
       INNER JOIN organisations o ON o.id = jl.org_id
       LEFT JOIN org_positions op ON op.id = jl.position_id
       WHERE jl.org_id = ?
       ORDER BY jl.created_at DESC`
    )
    .bind(orgMember.org_id)
    .all<any>()

  return c.json((rows.results ?? []).map(buildLinkDto))
})

// POST /recruitment/links
recruitment.post('/links', requireAuth, async (c) => {
  const userId = c.get('userId') as string
  const userRow = c.get('userRow') as any
  const db = c.env.DB

  const orgMember = await db
    .prepare(`SELECT org_id, role, can_manage_recruitment FROM org_members
              WHERE user_id = ? AND is_active = 1 LIMIT 1`)
    .bind(userId)
    .first<{ org_id: number; role: string; can_manage_recruitment: number }>()

  if (!orgMember) {
    return c.json({ error: 'Du bist in keiner Organisation.' }, 403)
  }

  const canManage = orgMember.role === 'Owner' || orgMember.role === 'Admin' || orgMember.can_manage_recruitment === 1
  if (!canManage) {
    return c.json({ error: 'Keine Berechtigung um Bewerbungslinks zu erstellen.' }, 403)
  }

  const body = await c.req.json<{
    title: string
    description?: string
    positionId?: number
    expiresAt?: string
  }>()

  if (!body.title?.trim()) {
    return c.json({ error: 'Titel ist Pflicht.' }, 400)
  }

  // 8-char URL-friendly Code generieren (kein I/O/0/1 für Lesbarkeit)
  const codeChars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const codeBytes = crypto.getRandomValues(new Uint8Array(8))
  const code = Array.from(codeBytes).map(b => codeChars[b % codeChars.length]).join('')

  // Strikt definierte Bindings (D1 lehnt undefined ab — alles muss string|number|null sein)
  const orgId      = orgMember.org_id ?? null
  const titleSafe  = body.title.trim()
  const descSafe   = (body.description && body.description.trim()) ? body.description.trim() : null
  const positionId = (body.positionId !== undefined && body.positionId !== null) ? body.positionId : null
  const expiresAt  = (typeof body.expiresAt === 'string' && body.expiresAt.length > 0) ? body.expiresAt : null
  const createdByName: string =
    (`${userRow.first_name ?? ''} ${userRow.last_name ?? ''}`).trim() ||
    (userRow.email ?? '') ||
    'Admin'

  console.log('[recruitment.links.create] binds:', {
    orgId: typeof orgId, code: typeof code, titleSafe: typeof titleSafe,
    descSafe: typeof descSafe, positionId: typeof positionId,
    userId: typeof userId, createdByName: typeof createdByName,
    expiresAt: typeof expiresAt,
    orgIdVal: orgId, userIdVal: userId
  })

  // Schema: id AUTOINCREMENT (nicht setzen), created_by_name ist Pflicht
  const result = await db
    .prepare(
      `INSERT INTO job_links (org_id, code, title, description, position_id,
                              created_by_user_id, created_by_name, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(orgId, code, titleSafe, descSafe, positionId, userId, createdByName, expiresAt)
    .run()

  const newId = result.meta.last_row_id

  // Vollständige Row mit Joins zurückgeben
  const row = await db
    .prepare(
      `SELECT jl.*, o.name AS org_name, op.title AS position_title
       FROM job_links jl
       INNER JOIN organisations o ON o.id = jl.org_id
       LEFT JOIN org_positions op ON op.id = jl.position_id
       WHERE jl.id = ?`
    )
    .bind(newId)
    .first<any>()

  if (!row) return c.json({ error: 'Link erstellt aber Daten konnten nicht geladen werden.' }, 500)

  return c.json(buildLinkDto(row), 201)
})

// PUT /recruitment/links/:id
recruitment.put('/links/:id', requireAuth, async (c) => {
  const user = c.get('user')
  const db = c.env.DB
  const id = c.req.param('id')

  const orgMember = await db
    .prepare(`SELECT org_id, role FROM org_members WHERE user_id = ? LIMIT 1`)
    .bind(user.id)
    .first<{ org_id: string; role: string }>()

  if (!orgMember) {
    return c.json({ error: 'Not in an organisation' }, 403)
  }

  const link = await db
    .prepare(`SELECT * FROM job_links WHERE id = ? AND org_id = ?`)
    .bind(id, orgMember.org_id)
    .first<any>()

  if (!link) {
    return c.json({ error: 'Link not found' }, 404)
  }

  const canManage =
    ['Owner', 'Admin', 'Manager'].includes(orgMember.role) ||
    link.created_by_user_id === user.id
  if (!canManage) {
    return c.json({ error: 'Insufficient permissions' }, 403)
  }

  const body = await c.req.json<{
    title?: string
    description?: string
    positionId?: string
    expiresAt?: string
    isActive?: boolean
  }>()

  await db
    .prepare(
      `UPDATE job_links
       SET title = COALESCE(?, title),
           description = COALESCE(?, description),
           position_id = COALESCE(?, position_id),
           expires_at = COALESCE(?, expires_at),
           is_active = COALESCE(?, is_active)
       WHERE id = ?`
    )
    .bind(
      body.title ?? null,
      body.description ?? null,
      body.positionId ?? null,
      body.expiresAt ?? null,
      body.isActive !== undefined ? (body.isActive ? 1 : 0) : null,
      id
    )
    .run()

  const updated = await db
    .prepare(
      `SELECT jl.*, o.name AS org_name, (u.first_name || " " || u.last_name) AS created_by_name,
              p.title AS position_title,
              (SELECT COUNT(*) FROM job_applications ja WHERE ja.link_id = jl.id) AS used_count
       FROM job_links jl
       LEFT JOIN organisations o ON o.id = jl.org_id
       LEFT JOIN users u ON u.id = jl.created_by_user_id
       LEFT JOIN org_positions p ON p.id = jl.position_id
       WHERE jl.id = ?`
    )
    .bind(id)
    .first<any>()

  return c.json(buildLinkDto(updated))
})

// DELETE /recruitment/links/:id
recruitment.delete('/links/:id', requireAuth, async (c) => {
  const user = c.get('user')
  const db = c.env.DB
  const id = c.req.param('id')

  const orgMember = await db
    .prepare(`SELECT org_id, role FROM org_members WHERE user_id = ? LIMIT 1`)
    .bind(user.id)
    .first<{ org_id: string; role: string }>()

  if (!orgMember) {
    return c.json({ error: 'Not in an organisation' }, 403)
  }

  const link = await db
    .prepare(`SELECT * FROM job_links WHERE id = ? AND org_id = ?`)
    .bind(id, orgMember.org_id)
    .first<any>()

  if (!link) {
    return c.json({ error: 'Link not found' }, 404)
  }

  const canDelete =
    ['Owner', 'Admin'].includes(orgMember.role) || link.created_by_user_id === user.id
  if (!canDelete) {
    return c.json({ error: 'Insufficient permissions' }, 403)
  }

  await db.prepare(`DELETE FROM job_links WHERE id = ?`).bind(id).run()

  return c.json({ ok: true })
})

// GET /recruitment/applications
recruitment.get('/applications', requireAuth, async (c) => {
  const user = c.get('user')
  const db = c.env.DB
  const linkId = c.req.query('linkId')
  const status = c.req.query('status')

  const orgMember = await db
    .prepare(`SELECT org_id FROM org_members WHERE user_id = ? LIMIT 1`)
    .bind(user.id)
    .first<{ org_id: string }>()

  if (!orgMember) {
    return c.json({ error: 'Not in an organisation' }, 403)
  }

  let query = `SELECT ja.* FROM job_applications ja
               INNER JOIN job_links jl ON jl.id = ja.link_id
               WHERE jl.org_id = ?`
  const bindings: any[] = [orgMember.org_id]

  if (linkId) {
    query += ` AND ja.link_id = ?`
    bindings.push(linkId)
  }
  if (status) {
    query += ` AND ja.status = ?`
    bindings.push(status)
  }

  query += ` ORDER BY ja.submitted_at DESC LIMIT 200`

  const rows = await db
    .prepare(query)
    .bind(...bindings)
    .all()

  return c.json((rows.results ?? []).map(buildApplicationDto))
})

// GET /recruitment/applications/:id
recruitment.get('/applications/:id', requireAuth, async (c) => {
  const user = c.get('user')
  const db = c.env.DB
  const id = c.req.param('id')

  const orgMember = await db
    .prepare(`SELECT org_id FROM org_members WHERE user_id = ? LIMIT 1`)
    .bind(user.id)
    .first<{ org_id: string }>()

  if (!orgMember) {
    return c.json({ error: 'Not in an organisation' }, 403)
  }

  const row = await db
    .prepare(
      `SELECT ja.* FROM job_applications ja
       INNER JOIN job_links jl ON jl.id = ja.link_id
       WHERE ja.id = ? AND jl.org_id = ?`
    )
    .bind(id, orgMember.org_id)
    .first<any>()

  if (!row) {
    return c.json({ error: 'Application not found' }, 404)
  }

  return c.json(buildApplicationDto(row))
})

// PUT /recruitment/applications/:id
recruitment.put('/applications/:id', requireAuth, async (c) => {
  const user = c.get('user')
  const db = c.env.DB
  const id = c.req.param('id')

  const orgMember = await db
    .prepare(`SELECT org_id, role FROM org_members WHERE user_id = ? LIMIT 1`)
    .bind(user.id)
    .first<{ org_id: string; role: string }>()

  if (!orgMember) {
    return c.json({ error: 'Not in an organisation' }, 403)
  }

  const row = await db
    .prepare(
      `SELECT ja.* FROM job_applications ja
       INNER JOIN job_links jl ON jl.id = ja.link_id
       WHERE ja.id = ? AND jl.org_id = ?`
    )
    .bind(id, orgMember.org_id)
    .first<any>()

  if (!row) {
    return c.json({ error: 'Application not found' }, 404)
  }

  const body = await c.req.json<{
    status?: string
    internalNotes?: string
    assignedToUserId?: string
  }>()

  await db
    .prepare(
      `UPDATE job_applications
       SET status = COALESCE(?, status),
           internal_notes = COALESCE(?, internal_notes),
           assigned_to_user_id = COALESCE(?, assigned_to_user_id),
           last_updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
       WHERE id = ?`
    )
    .bind(body.status ?? null, body.internalNotes ?? null, body.assignedToUserId ?? null, id)
    .run()

  const updated = await db
    .prepare(`SELECT * FROM job_applications WHERE id = ?`)
    .bind(id)
    .first<any>()

  return c.json(buildApplicationDto(updated))
})

// ─── Public routes ────────────────────────────────────────────────────────────

// GET /recruitment/public/:code
recruitment.get('/public/:code', async (c) => {
  const db = c.env.DB
  const code = c.req.param('code')

  const row = await db
    .prepare(
      `SELECT jl.*, o.name AS org_name, (u.first_name || " " || u.last_name) AS created_by_name,
              p.title AS position_title,
              (SELECT COUNT(*) FROM job_applications ja WHERE ja.link_id = jl.id) AS used_count
       FROM job_links jl
       LEFT JOIN organisations o ON o.id = jl.org_id
       LEFT JOIN users u ON u.id = jl.created_by_user_id
       LEFT JOIN org_positions p ON p.id = jl.position_id
       WHERE jl.code = ? AND jl.is_active = 1`
    )
    .bind(code)
    .first<any>()

  if (!row) {
    return c.json({ error: 'Job link not found or inactive' }, 404)
  }

  // Check expiry
  if (row.expires_at && new Date(row.expires_at) < new Date()) {
    return c.json({ error: 'This job link has expired' }, 410)
  }

  return c.json(buildLinkDto(row))
})

// POST /recruitment/public/submit — public, kein Auth nötig
recruitment.post('/public/submit', async (c) => {
  try {
    const db = c.env.DB
    const body = await c.req.json<{
      firstName?: string
      lastName?: string
      email?: string
      phone?: string
      coverLetter?: string
      code?: string
    }>().catch(() => ({}))

    const firstName  = (body.firstName ?? '').trim()
    const lastName   = (body.lastName ?? '').trim()
    const email      = (body.email ?? '').trim().toLowerCase()
    const code       = (body.code ?? '').trim()
    const phone      = body.phone ?? null
    const coverLetter = body.coverLetter ?? null

    if (!firstName || !lastName || !email || !code) {
      return c.json({ error: 'Vorname, Nachname, Email und Bewerbungs-Code sind Pflicht.' }, 400)
    }

    const link = await db
      .prepare(`SELECT * FROM job_links WHERE code = ? AND is_active = 1`)
      .bind(code)
      .first<any>()

    if (!link) {
      return c.json({ error: 'Bewerbungs-Code unbekannt oder Stelle nicht mehr aktiv.' }, 404)
    }

    if (link.expires_at && new Date(link.expires_at) < new Date()) {
      return c.json({ error: 'Dieser Bewerbungs-Link ist abgelaufen.' }, 410)
    }

    // Schema: id ist INTEGER AUTOINCREMENT (KEIN UUID-String).
    // Schema-Spalten: link_title, status default 'New', submitted_at default now(),
    // last_updated_at (NICHT updated_at).
    const ins = await db
      .prepare(
        `INSERT INTO job_applications
           (link_id, org_id, link_title, first_name, last_name, email, phone, cover_letter, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'New')`
      )
      .bind(
        link.id,
        link.org_id,
        link.title ?? null,
        firstName,
        lastName,
        email,
        phone,
        coverLetter
      )
      .run()

    const newId = Number(ins.meta.last_row_id)

    // used_count auf dem Link hochzählen
    await db
      .prepare(`UPDATE job_links SET used_count = used_count + 1 WHERE id = ?`)
      .bind(link.id).run()

    // iOS erwartet { id, message } — sowohl alten als auch neuen Key liefern für Compat
    return c.json({
      id:            newId,
      applicationId: newId,
      ok:            true,
      message:       'Bewerbung erfolgreich gesendet.'
    }, 201)
  } catch (e: any) {
    console.error('[POST /recruitment/public/submit]', e?.message ?? e, e?.stack)
    return c.json({ error: `Bewerbung konnte nicht gespeichert werden: ${e?.message ?? 'unbekannt'}` }, 500)
  }
})

// POST /recruitment/public/:applicationId/upload
recruitment.post('/public/:applicationId/upload', async (c) => {
  const db = c.env.DB
  const applicationId = c.req.param('applicationId')

  const application = await db
    .prepare(`SELECT * FROM job_applications WHERE id = ?`)
    .bind(applicationId)
    .first<any>()

  if (!application) {
    return c.json({ error: 'Application not found' }, 404)
  }

  let fileUrl: string
  try {
    const parsed = await parseFileUpload(c.req.raw)
    if (!parsed) return c.json({ error: 'No file in form-data' }, 400)
    const uploaded = await uploadToR2(
      c.env.UPLOADS,
      parsed.file,
      parsed.filename,
      parsed.contentType,
      `recruitment/${application.org_id}/${applicationId}`
    )
    fileUrl = uploaded.url
  } catch {
    return c.json({ error: 'File upload failed' }, 500)
  }

  await db
    .prepare(`UPDATE job_applications SET attachment_url = ? WHERE id = ?`)
    .bind(fileUrl, applicationId)
    .run()

  return c.json({ ok: true, attachmentUrl: fileUrl })
})

export default recruitment
