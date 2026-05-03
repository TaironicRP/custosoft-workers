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
    // Must be active member of same org
    const orgMember = await db
      .prepare(`SELECT 1 FROM org_members WHERE user_id = ? AND org_id = ? AND is_active = 1`)
      .bind(userId, fileRow.org_id)
      .first()
    return !!orgMember
  }

  if (visibility === VISIBILITY_MANAGERS) {
    if (userId === fileRow.created_by_user_id || userId === fileRow.subject_user_id) return true
    const manager = await db
      .prepare(
        `SELECT can_manage_files, role FROM org_members
         WHERE user_id = ? AND org_id = ? AND is_active = 1`
      )
      .bind(userId, fileRow.org_id)
      .first<{ can_manage_files: number; role: string }>()
    return !!(manager?.can_manage_files) || ['Owner','Admin'].includes(manager?.role ?? '')
  }

  // VISIBILITY_RESTRICTED — owner/subject only, plus Owner role can always read their own org files
  if (userId === fileRow.created_by_user_id || userId === fileRow.subject_user_id) return true
  const elevated = await db
    .prepare(`SELECT role FROM org_members
              WHERE user_id = ? AND org_id = ? AND is_active = 1 AND role = 'Owner'`)
    .bind(userId, fileRow.org_id)
    .first()
  return !!elevated
}

// ─── Routes ──────────────────────────────────────────────────────────────────

// GET /files?userId=  ODER  GET /files?includeArchived=true|false (eigene Akten)
files.get('/', async (c) => {
  const user = c.get('user')
  const db = c.env.DB
  const targetUserId = c.req.query('userId')
  const includeArchived = c.req.query('includeArchived') === 'true'

  // Wenn kein targetUserId → alle Akten der eigenen Org laden, gefiltert per canViewFile
  let sql: string
  let bindings: any[]
  if (targetUserId) {
    sql = `SELECT ef.* FROM employee_files ef
           WHERE ef.subject_user_id = ?
             ${includeArchived ? '' : 'AND ef.is_archived = 0'}
           ORDER BY ef.created_at DESC`
    bindings = [targetUserId]
  } else {
    // Eigene Org bestimmen
    const me = await db
      .prepare(`SELECT org_id FROM org_members WHERE user_id = ? AND is_active = 1 LIMIT 1`)
      .bind(user.id)
      .first<{ org_id: number }>()
    if (!me) return c.json([])  // Kein Org → leere Liste
    sql = `SELECT ef.* FROM employee_files ef
           WHERE ef.org_id = ?
             ${includeArchived ? '' : 'AND ef.is_archived = 0'}
           ORDER BY ef.created_at DESC`
    bindings = [me.org_id]
  }

  const rows = await db.prepare(sql).bind(...bindings).all<any>()

  const accessible: any[] = []
  for (const row of rows.results ?? []) {
    const visible = await canViewFile(db, user.id, row)
    if (visible) accessible.push(buildFileDto(row))
  }

  return c.json(accessible)
})

// POST /files
files.post('/', async (c) => {
  try {
    const user = c.get('user')
    const db = c.env.DB
    const body = await c.req.json<{
      subjectUserId?: string | null
      title?: string
      type?: string
      note?: string
      visibility?: number | null
      linkedPunchId?: string | null
    }>()

    // subjectUserId default = self (eigene Akte)
    const subjectUserId = (body.subjectUserId ?? '').trim() || user.id
    const title = (body.title ?? '').trim()
    const type  = (body.type ?? '').trim()

    if (!title || !type) {
      return c.json({ error: 'title und type sind Pflichtfelder.' }, 400)
    }

    // Visibility default = MANAGERS wenn nicht gesetzt
    const visibility =
      typeof body.visibility === 'number' &&
      [VISIBILITY_RESTRICTED, VISIBILITY_MANAGERS, VISIBILITY_EVERYONE].includes(body.visibility)
        ? body.visibility
        : VISIBILITY_MANAGERS

    // Aktive Org-Mitgliedschaft des Erstellers (Schema-Spalte heißt 'role', nicht 'org_role')
    const orgMember = await db
      .prepare(`SELECT org_id, can_manage_files, role
                FROM org_members
                WHERE user_id = ? AND is_active = 1 LIMIT 1`)
      .bind(user.id)
      .first<{ org_id: number; can_manage_files: number; role: string }>()

    if (!orgMember) {
      return c.json({ error: 'Du musst in einer Organisation sein um Akten anzulegen.' }, 403)
    }

    const canCreate =
      user.id === subjectUserId ||
      orgMember.can_manage_files === 1 ||
      ['Owner', 'Admin'].includes(orgMember.role)

    if (!canCreate) {
      return c.json({ error: 'Keine Berechtigung Akten für diesen Nutzer anzulegen.' }, 403)
    }

    // subject_display_name aus users-Tabelle (NOT NULL Schema-Spalte)
    const subjectUser = await db
      .prepare(`SELECT first_name, last_name, email FROM users WHERE id = ?`)
      .bind(subjectUserId)
      .first<{ first_name: string | null; last_name: string | null; email: string }>()
    if (!subjectUser) {
      return c.json({ error: 'Subject-User nicht gefunden.' }, 404)
    }
    const subjectDisplayName =
      (`${subjectUser.first_name ?? ''} ${subjectUser.last_name ?? ''}`.trim()) || subjectUser.email

    // INSERT — id ist INTEGER AUTOINCREMENT (kein UUID)
    const ins = await db
      .prepare(
        `INSERT INTO employee_files
           (subject_user_id, subject_display_name, org_id, title, type, file_url, note, linked_punch_id, created_by_user_id, visibility, is_archived)
         VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, 0)`
      )
      .bind(
        subjectUserId,
        subjectDisplayName,
        orgMember.org_id,
        title,
        type,
        body.note ?? null,
        body.linkedPunchId ?? null,
        user.id,
        visibility
      )
      .run()

    const newId = Number(ins.meta.last_row_id)
    const row = await db
      .prepare(`SELECT ef.* FROM employee_files ef WHERE ef.id = ?`)
      .bind(newId)
      .first<any>()
    if (!row) return c.json({ error: 'Akte nicht gefunden nach Erstellung.' }, 500)

    return c.json(buildFileDto(row), 201)
  } catch (e: any) {
    console.error('[POST /files] failed:', e?.message ?? e, e?.stack)
    return c.json({ error: `Akte konnte nicht erstellt werden: ${e?.message ?? 'unbekannt'}` }, 500)
  }
})

// GET /files/:id
files.get('/:id', async (c) => {
  const user = c.get('user')
  const db = c.env.DB
  const id = c.req.param('id')

  const row = await db
    .prepare(
      `SELECT ef.* FROM employee_files ef WHERE ef.id = ?`
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

  // Editing rights: creator, OR canManageFiles, OR Owner/Admin in same org
  let canEdit = row.created_by_user_id === user.id
  if (!canEdit) {
    const orgMember = await db
      .prepare(`SELECT can_manage_files, role FROM org_members
                WHERE user_id = ? AND org_id = ? AND is_active = 1`)
      .bind(user.id, row.org_id)
      .first<{ can_manage_files: number; role: string }>()
    canEdit =
      orgMember?.can_manage_files === 1 ||
      ['Owner', 'Admin'].includes(orgMember?.role ?? '')
  }
  if (!canEdit) {
    return c.json({ error: 'Keine Berechtigung diese Akte zu bearbeiten.' }, 403)
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
      `SELECT ef.* FROM employee_files ef WHERE ef.id = ?`
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

  let canDelete = row.created_by_user_id === user.id
  if (!canDelete) {
    const m = await db
      .prepare(`SELECT can_manage_files, role FROM org_members
                WHERE user_id = ? AND org_id = ? AND is_active = 1`)
      .bind(user.id, row.org_id)
      .first<{ can_manage_files: number; role: string }>()
    canDelete = m?.can_manage_files === 1 || ['Owner', 'Admin'].includes(m?.role ?? '')
  }

  if (!canDelete) {
    return c.json({ error: 'Keine Berechtigung diese Akte zu löschen.' }, 403)
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

  let canEdit = row.created_by_user_id === user.id
  if (!canEdit) {
    const m = await db
      .prepare(`SELECT can_manage_files, role FROM org_members
                WHERE user_id = ? AND org_id = ? AND is_active = 1`)
      .bind(user.id, row.org_id)
      .first<{ can_manage_files: number; role: string }>()
    canEdit = m?.can_manage_files === 1 || ['Owner', 'Admin'].includes(m?.role ?? '')
  }
  if (!canEdit) {
    return c.json({ error: 'Keine Berechtigung Dateien zu dieser Akte hochzuladen.' }, 403)
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
      `SELECT ef.* FROM employee_files ef WHERE ef.id = ?`
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

  let canArchive = row.created_by_user_id === user.id
  if (!canArchive) {
    const m = await db
      .prepare(`SELECT can_manage_files, role FROM org_members
                WHERE user_id = ? AND org_id = ? AND is_active = 1`)
      .bind(user.id, row.org_id)
      .first<{ can_manage_files: number; role: string }>()
    canArchive = m?.can_manage_files === 1 || ['Owner', 'Admin'].includes(m?.role ?? '')
  }
  if (!canArchive) {
    return c.json({ error: 'Keine Berechtigung diese Akte zu archivieren.' }, 403)
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
      `SELECT ef.* FROM employee_files ef WHERE ef.id = ?`
    )
    .bind(id)
    .first<any>()

  return c.json(buildFileDto(updated))
})

export default files
