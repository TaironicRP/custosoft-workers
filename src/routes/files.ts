import { Hono } from 'hono'
import { requireAuth } from '../middleware/auth'
import type { Env, AppEnv } from '../types'
import { uploadToR2, parseFileUpload } from '../utils/r2'

const files = new Hono<AppEnv>()

files.use('*', requireAuth)

// ─── Visibility constants ────────────────────────────────────────────────────
const VISIBILITY_RESTRICTED = 0 // owner + subject user only
const VISIBILITY_MANAGERS = 1   // owner + canManageFiles users
const VISIBILITY_EVERYONE = 2   // all org members

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildFileDto(row: any) {
  return {
    id: row.id,
    subjectUserId: row.subject_user_id ?? row.subjectUserId,
    subjectDisplayName: row.subject_display_name ?? row.subjectDisplayName ?? null,
    orgId: row.org_id ?? row.orgId,
    title: row.title,
    type: row.type,
    fileUrl: row.file_url ?? row.fileUrl ?? null,
    note: row.note ?? null,
    linkedPunchId: row.linked_punch_id ?? row.linkedPunchId ?? null,
    linkedMessageId: row.linked_message_id ?? row.linkedMessageId ?? null,
    createdByUserId: row.created_by_user_id ?? row.createdByUserId,
    createdAt: row.created_at ?? row.createdAt,
    visibility: row.visibility,
    isArchived: (row.is_archived ?? row.isArchived) === 1,
    archivedAt: row.archived_at ?? row.archivedAt ?? null,
  }
}

async function canViewFile(db: any, userId: string, fileRow: any): Promise<boolean> {
  const visibility = fileRow.visibility

  if (visibility === VISIBILITY_EVERYONE) {
    // Must be in same org
    const orgMember = await db
      .prepare(`SELECT 1 FROM org_members WHERE user_id = ? AND org_id = ?`)
      .bind(userId, fileRow.org_id)
      .first()
    return !!orgMember
  }

  if (visibility === VISIBILITY_MANAGERS) {
    if (userId === fileRow.created_by_user_id || userId === fileRow.subject_user_id) return true
    const manager = await db
      .prepare(
        `SELECT can_manage_files FROM org_members WHERE user_id = ? AND org_id = ?`
      )
      .bind(userId, fileRow.org_id)
      .first<{ can_manage_files: number }>()
    return !!(manager?.can_manage_files)
  }

  // VISIBILITY_RESTRICTED
  return userId === fileRow.created_by_user_id || userId === fileRow.subject_user_id
}

// ─── Routes ──────────────────────────────────────────────────────────────────

// GET /files?userId=
files.get('/', async (c) => {
  const user = c.get('user')
  const db = c.env.DB
  const targetUserId = c.req.query('userId')

  if (!targetUserId) {
    return c.json({ error: 'userId query parameter is required' }, 400)
  }

  // Determine requester's org membership
  const orgMember = await db
    .prepare(`SELECT org_id, org_role, can_manage_files FROM org_members WHERE user_id = ? LIMIT 1`)
    .bind(user.id)
    .first<{ org_id: string; org_role: string; can_manage_files: number }>()

  const canManageFiles =
    !!(orgMember?.can_manage_files) ||
    ['Owner', 'Admin'].includes(orgMember?.org_role ?? '')

  const rows = await db
    .prepare(
      `SELECT ef.*, u.display_name AS subject_display_name
       FROM employee_files ef
       LEFT JOIN users u ON u.id = ef.subject_user_id
       WHERE ef.subject_user_id = ?
       ORDER BY ef.created_at DESC`
    )
    .bind(targetUserId)
    .all()

  const accessible: any[] = []
  for (const row of rows.results ?? []) {
    const visible = await canViewFile(db, user.id, row)
    if (visible) {
      accessible.push(buildFileDto(row))
    }
  }

  return c.json(accessible)
})

// POST /files
files.post('/', async (c) => {
  const user = c.get('user')
  const db = c.env.DB
  const body = await c.req.json<{
    subjectUserId: string
    title: string
    type: string
    note?: string
    visibility: number
    linkedPunchId?: string
  }>()

  if (!body.subjectUserId || !body.title || !body.type) {
    return c.json({ error: 'subjectUserId, title, and type are required' }, 400)
  }

  if (![VISIBILITY_RESTRICTED, VISIBILITY_MANAGERS, VISIBILITY_EVERYONE].includes(body.visibility)) {
    return c.json({ error: 'Invalid visibility value (0, 1, or 2)' }, 400)
  }

  const orgMember = await db
    .prepare(`SELECT org_id, can_manage_files, org_role FROM org_members WHERE user_id = ? LIMIT 1`)
    .bind(user.id)
    .first<{ org_id: string; can_manage_files: number; org_role: string }>()

  if (!orgMember) {
    return c.json({ error: 'Not in an organisation' }, 403)
  }

  const canCreate =
    user.id === body.subjectUserId ||
    orgMember.can_manage_files === 1 ||
    ['Owner', 'Admin', 'Manager'].includes(orgMember.org_role)

  if (!canCreate) {
    return c.json({ error: 'Insufficient permissions to create file for this user' }, 403)
  }

  const id = crypto.randomUUID()

  await db
    .prepare(
      `INSERT INTO employee_files
         (id, subject_user_id, org_id, title, type, file_url, note, linked_punch_id, created_by_user_id, created_at, visibility, is_archived)
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'), ?, 0)`
    )
    .bind(
      id,
      body.subjectUserId,
      orgMember.org_id,
      body.title.trim(),
      body.type,
      body.note ?? null,
      body.linkedPunchId ?? null,
      user.id,
      body.visibility
    )
    .run()

  const row = await db
    .prepare(
      `SELECT ef.*, u.display_name AS subject_display_name
       FROM employee_files ef
       LEFT JOIN users u ON u.id = ef.subject_user_id
       WHERE ef.id = ?`
    )
    .bind(id)
    .first<any>()

  return c.json(buildFileDto(row), 201)
})

// GET /files/:id
files.get('/:id', async (c) => {
  const user = c.get('user')
  const db = c.env.DB
  const id = c.req.param('id')

  const row = await db
    .prepare(
      `SELECT ef.*, u.display_name AS subject_display_name
       FROM employee_files ef
       LEFT JOIN users u ON u.id = ef.subject_user_id
       WHERE ef.id = ?`
    )
    .bind(id)
    .first<any>()

  if (!row) {
    return c.json({ error: 'File not found' }, 404)
  }

  const visible = await canViewFile(db, user.id, row)
  if (!visible) {
    return c.json({ error: 'Access denied' }, 403)
  }

  return c.json(buildFileDto(row))
})

// PUT /files/:id
files.put('/:id', async (c) => {
  const user = c.get('user')
  const db = c.env.DB
  const id = c.req.param('id')

  const row = await db
    .prepare(`SELECT * FROM employee_files WHERE id = ?`)
    .bind(id)
    .first<any>()

  if (!row) {
    return c.json({ error: 'File not found' }, 404)
  }

  const canEdit = await canViewFile(db, user.id, row)
  if (!canEdit || (row.created_by_user_id !== user.id)) {
    const orgMember = await db
      .prepare(`SELECT can_manage_files, org_role FROM org_members WHERE user_id = ? AND org_id = ?`)
      .bind(user.id, row.org_id)
      .first<{ can_manage_files: number; org_role: string }>()
    const elevated =
      orgMember?.can_manage_files === 1 || ['Owner', 'Admin'].includes(orgMember?.org_role ?? '')
    if (!elevated) {
      return c.json({ error: 'Access denied' }, 403)
    }
  }

  const body = await c.req.json<{
    title?: string
    type?: string
    note?: string
    visibility?: number
    linkedPunchId?: string
  }>()

  await db
    .prepare(
      `UPDATE employee_files
       SET title = COALESCE(?, title),
           type = COALESCE(?, type),
           note = COALESCE(?, note),
           visibility = COALESCE(?, visibility),
           linked_punch_id = COALESCE(?, linked_punch_id)
       WHERE id = ?`
    )
    .bind(
      body.title ?? null,
      body.type ?? null,
      body.note ?? null,
      body.visibility ?? null,
      body.linkedPunchId ?? null,
      id
    )
    .run()

  const updated = await db
    .prepare(
      `SELECT ef.*, u.display_name AS subject_display_name
       FROM employee_files ef
       LEFT JOIN users u ON u.id = ef.subject_user_id
       WHERE ef.id = ?`
    )
    .bind(id)
    .first<any>()

  return c.json(buildFileDto(updated))
})

// DELETE /files/:id
files.delete('/:id', async (c) => {
  const user = c.get('user')
  const db = c.env.DB
  const id = c.req.param('id')

  const row = await db
    .prepare(`SELECT * FROM employee_files WHERE id = ?`)
    .bind(id)
    .first<any>()

  if (!row) {
    return c.json({ error: 'File not found' }, 404)
  }

  if (!row.is_archived) {
    return c.json({ error: 'File must be archived before it can be deleted' }, 409)
  }

  const canDelete =
    row.created_by_user_id === user.id ||
    !!(await db
      .prepare(`SELECT can_manage_files FROM org_members WHERE user_id = ? AND org_id = ?`)
      .bind(user.id, row.org_id)
      .first<{ can_manage_files: number }>()
      .then((r) => r?.can_manage_files)) ||
    !!(await db
      .prepare(`SELECT org_role FROM org_members WHERE user_id = ? AND org_id = ?`)
      .bind(user.id, row.org_id)
      .first<{ org_role: string }>()
      .then((r) => ['Owner', 'Admin'].includes(r?.org_role ?? '')))

  if (!canDelete) {
    return c.json({ error: 'Access denied' }, 403)
  }

  await db.prepare(`DELETE FROM employee_files WHERE id = ?`).bind(id).run()

  return c.json({ ok: true })
})

// POST /files/:id/upload
files.post('/:id/upload', async (c) => {
  const user = c.get('user')
  const db = c.env.DB
  const id = c.req.param('id')

  const row = await db
    .prepare(`SELECT * FROM employee_files WHERE id = ?`)
    .bind(id)
    .first<any>()

  if (!row) {
    return c.json({ error: 'File not found' }, 404)
  }

  const canEdit =
    row.created_by_user_id === user.id ||
    !!(await db
      .prepare(`SELECT can_manage_files FROM org_members WHERE user_id = ? AND org_id = ?`)
      .bind(user.id, row.org_id)
      .first<{ can_manage_files: number }>()
      .then((r) => r?.can_manage_files))

  if (!canEdit) {
    return c.json({ error: 'Access denied' }, 403)
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
      `files/${row.org_id}/${id}`
    )
    fileUrl = uploaded.url
  } catch {
    return c.json({ error: 'File upload failed' }, 500)
  }

  await db
    .prepare(`UPDATE employee_files SET file_url = ? WHERE id = ?`)
    .bind(fileUrl, id)
    .run()

  const updated = await db
    .prepare(
      `SELECT ef.*, u.display_name AS subject_display_name
       FROM employee_files ef
       LEFT JOIN users u ON u.id = ef.subject_user_id
       WHERE ef.id = ?`
    )
    .bind(id)
    .first<any>()

  return c.json(buildFileDto(updated))
})

// PATCH /files/:id (archive/unarchive)
files.patch('/:id', async (c) => {
  const user = c.get('user')
  const db = c.env.DB
  const id = c.req.param('id')
  const body = await c.req.json<{ isArchived: boolean }>()

  if (typeof body.isArchived !== 'boolean') {
    return c.json({ error: 'isArchived (boolean) is required' }, 400)
  }

  const row = await db
    .prepare(`SELECT * FROM employee_files WHERE id = ?`)
    .bind(id)
    .first<any>()

  if (!row) {
    return c.json({ error: 'File not found' }, 404)
  }

  const canArchive =
    row.created_by_user_id === user.id ||
    !!(await db
      .prepare(`SELECT can_manage_files, org_role FROM org_members WHERE user_id = ? AND org_id = ?`)
      .bind(user.id, row.org_id)
      .first<{ can_manage_files: number; org_role: string }>()
      .then((r) => r?.can_manage_files === 1 || ['Owner', 'Admin'].includes(r?.org_role ?? '')))

  if (!canArchive) {
    return c.json({ error: 'Access denied' }, 403)
  }

  if (body.isArchived) {
    await db
      .prepare(
        `UPDATE employee_files
         SET is_archived = 1, archived_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
         WHERE id = ?`
      )
      .bind(id)
      .run()
  } else {
    await db
      .prepare(`UPDATE employee_files SET is_archived = 0, archived_at = NULL WHERE id = ?`)
      .bind(id)
      .run()
  }

  const updated = await db
    .prepare(
      `SELECT ef.*, u.display_name AS subject_display_name
       FROM employee_files ef
       LEFT JOIN users u ON u.id = ef.subject_user_id
       WHERE ef.id = ?`
    )
    .bind(id)
    .first<any>()

  return c.json(buildFileDto(updated))
})

export default files
