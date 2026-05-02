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
    updatedAt: row.updated_at ?? row.updatedAt,
  }
}

// ─── Protected routes ─────────────────────────────────────────────────────────

recruitment.use('/links*', requireAuth)
recruitment.use('/applications*', requireAuth)

// GET /recruitment/links
recruitment.get('/links', async (c) => {
  const user = c.get('user')
  const db = c.env.DB

  const orgMember = await db
    .prepare(`SELECT org_id FROM org_members WHERE user_id = ? LIMIT 1`)
    .bind(user.id)
    .first<{ org_id: string }>()

  if (!orgMember) {
    return c.json({ error: 'Not in an organisation' }, 403)
  }

  const rows = await db
    .prepare(
      `SELECT jl.*, o.name AS org_name, u.display_name AS created_by_name,
              p.title AS position_title,
              (SELECT COUNT(*) FROM job_applications ja WHERE ja.link_id = jl.id) AS used_count
       FROM job_links jl
       LEFT JOIN orgs o ON o.id = jl.org_id
       LEFT JOIN users u ON u.id = jl.created_by_user_id
       LEFT JOIN positions p ON p.id = jl.position_id
       WHERE jl.org_id = ?
       ORDER BY jl.created_at DESC`
    )
    .bind(orgMember.org_id)
    .all()

  return c.json((rows.results ?? []).map(buildLinkDto))
})

// POST /recruitment/links
recruitment.post('/links', async (c) => {
  const user = c.get('user')
  const db = c.env.DB

  const orgMember = await db
    .prepare(`SELECT org_id, org_role FROM org_members WHERE user_id = ? LIMIT 1`)
    .bind(user.id)
    .first<{ org_id: string; org_role: string }>()

  if (!orgMember) {
    return c.json({ error: 'Not in an organisation' }, 403)
  }

  const canManage = ['Owner', 'Admin', 'Manager'].includes(orgMember.org_role)
  if (!canManage) {
    return c.json({ error: 'Insufficient permissions' }, 403)
  }

  const body = await c.req.json<{
    title: string
    description?: string
    positionId?: string
    expiresAt?: string
  }>()

  if (!body.title) {
    return c.json({ error: 'title is required' }, 400)
  }

  // Generate unique code
  const code = crypto.randomUUID().replace(/-/g, '').substring(0, 12).toUpperCase()
  const id = crypto.randomUUID()

  await db
    .prepare(
      `INSERT INTO job_links (id, org_id, code, title, description, position_id, created_by_user_id, created_at, expires_at, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'), ?, 1)`
    )
    .bind(
      id,
      orgMember.org_id,
      code,
      body.title.trim(),
      body.description ?? null,
      body.positionId ?? null,
      user.id,
      body.expiresAt ?? null
    )
    .run()

  const row = await db
    .prepare(
      `SELECT jl.*, o.name AS org_name, u.display_name AS created_by_name,
              p.title AS position_title, 0 AS used_count
       FROM job_links jl
       LEFT JOIN orgs o ON o.id = jl.org_id
       LEFT JOIN users u ON u.id = jl.created_by_user_id
       LEFT JOIN positions p ON p.id = jl.position_id
       WHERE jl.id = ?`
    )
    .bind(id)
    .first<any>()

  return c.json(buildLinkDto(row), 201)
})

// PUT /recruitment/links/:id
recruitment.put('/links/:id', async (c) => {
  const user = c.get('user')
  const db = c.env.DB
  const id = c.req.param('id')

  const orgMember = await db
    .prepare(`SELECT org_id, org_role FROM org_members WHERE user_id = ? LIMIT 1`)
    .bind(user.id)
    .first<{ org_id: string; org_role: string }>()

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
    ['Owner', 'Admin', 'Manager'].includes(orgMember.org_role) ||
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
      `SELECT jl.*, o.name AS org_name, u.display_name AS created_by_name,
              p.title AS position_title,
              (SELECT COUNT(*) FROM job_applications ja WHERE ja.link_id = jl.id) AS used_count
       FROM job_links jl
       LEFT JOIN orgs o ON o.id = jl.org_id
       LEFT JOIN users u ON u.id = jl.created_by_user_id
       LEFT JOIN positions p ON p.id = jl.position_id
       WHERE jl.id = ?`
    )
    .bind(id)
    .first<any>()

  return c.json(buildLinkDto(updated))
})

// DELETE /recruitment/links/:id
recruitment.delete('/links/:id', async (c) => {
  const user = c.get('user')
  const db = c.env.DB
  const id = c.req.param('id')

  const orgMember = await db
    .prepare(`SELECT org_id, org_role FROM org_members WHERE user_id = ? LIMIT 1`)
    .bind(user.id)
    .first<{ org_id: string; org_role: string }>()

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
    ['Owner', 'Admin'].includes(orgMember.org_role) || link.created_by_user_id === user.id
  if (!canDelete) {
    return c.json({ error: 'Insufficient permissions' }, 403)
  }

  await db.prepare(`DELETE FROM job_links WHERE id = ?`).bind(id).run()

  return c.json({ ok: true })
})

// GET /recruitment/applications
recruitment.get('/applications', async (c) => {
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
recruitment.get('/applications/:id', async (c) => {
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
recruitment.put('/applications/:id', async (c) => {
  const user = c.get('user')
  const db = c.env.DB
  const id = c.req.param('id')

  const orgMember = await db
    .prepare(`SELECT org_id, org_role FROM org_members WHERE user_id = ? LIMIT 1`)
    .bind(user.id)
    .first<{ org_id: string; org_role: string }>()

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
           updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
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
      `SELECT jl.*, o.name AS org_name, u.display_name AS created_by_name,
              p.title AS position_title,
              (SELECT COUNT(*) FROM job_applications ja WHERE ja.link_id = jl.id) AS used_count
       FROM job_links jl
       LEFT JOIN orgs o ON o.id = jl.org_id
       LEFT JOIN users u ON u.id = jl.created_by_user_id
       LEFT JOIN positions p ON p.id = jl.position_id
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

// POST /recruitment/public/submit
recruitment.post('/public/submit', async (c) => {
  const db = c.env.DB
  const body = await c.req.json<{
    firstName: string
    lastName: string
    email: string
    phone?: string
    coverLetter?: string
    code: string
  }>()

  if (!body.firstName || !body.lastName || !body.email || !body.code) {
    return c.json({ error: 'firstName, lastName, email, and code are required' }, 400)
  }

  const link = await db
    .prepare(`SELECT * FROM job_links WHERE code = ? AND is_active = 1`)
    .bind(body.code)
    .first<any>()

  if (!link) {
    return c.json({ error: 'Invalid or inactive job link' }, 404)
  }

  if (link.expires_at && new Date(link.expires_at) < new Date()) {
    return c.json({ error: 'This job link has expired' }, 410)
  }

  const id = crypto.randomUUID()

  await db
    .prepare(
      `INSERT INTO job_applications
         (id, link_id, org_id, first_name, last_name, email, phone, cover_letter, status, submitted_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new', strftime('%Y-%m-%dT%H:%M:%SZ','now'), strftime('%Y-%m-%dT%H:%M:%SZ','now'))`
    )
    .bind(
      id,
      link.id,
      link.org_id,
      body.firstName.trim(),
      body.lastName.trim(),
      body.email.trim().toLowerCase(),
      body.phone ?? null,
      body.coverLetter ?? null
    )
    .run()

  return c.json({ ok: true, applicationId: id }, 201)
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
