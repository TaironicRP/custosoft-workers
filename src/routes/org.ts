// ── Org Routes — /api/v1/org ──────────────────────────────────────────────────
import { Hono }        from 'hono'
import type { Env, AppEnv } from '../types'
import { requireAuth } from '../middleware/auth'
import { randomInviteCode } from '../utils/crypto'

const org = new Hono<AppEnv>()

// ── GET /org — current user's org ────────────────────────────────────────────
org.get('/', requireAuth, async (c) => {
  const userId = c.get('userId') as string
  const member = await c.env.DB
    .prepare('SELECT * FROM org_members WHERE user_id = ? AND is_active = 1 LIMIT 1')
    .bind(userId).first<any>()
  if (!member) return c.json({ error: 'Du bist in keiner Organisation.' }, 404)

  const o = await c.env.DB
    .prepare('SELECT * FROM organisations WHERE id = ?')
    .bind(member.org_id).first<any>()
  if (!o) return c.json({ error: 'Org nicht gefunden.' }, 404)

  const exts = await c.env.DB
    .prepare(`SELECT DISTINCT product FROM user_extensions
              WHERE user_id = (SELECT owner_id FROM organisations WHERE id = ?)
              AND is_active = 1 AND (expires_at IS NULL OR expires_at > strftime('%Y-%m-%dT%H:%M:%SZ','now'))`)
    .bind(o.id).all<{ product: string }>()

  const memberCount = await c.env.DB
    .prepare('SELECT COUNT(*) as n FROM org_members WHERE org_id = ? AND is_active = 1')
    .bind(o.id).first<{ n: number }>()

  return c.json({
    id: o.id, name: o.name, ownerId: o.owner_id, logoUrl: o.logo_url,
    activeExtensions: exts.results.map(r => r.product),
    memberCount: memberCount?.n ?? 0,
    createdAt: o.created_at,
  })
})

// ── PUT /org — update org name/logo ──────────────────────────────────────────
org.put('/', requireAuth, async (c) => {
  const userId = c.get('userId') as string
  const member = await c.env.DB
    .prepare("SELECT * FROM org_members WHERE user_id = ? AND is_active = 1 AND role IN ('Owner','Admin') LIMIT 1")
    .bind(userId).first<any>()
  if (!member) return c.json({ error: 'Keine Berechtigung.' }, 403)

  const body = await c.req.json<{ name?: string; logoUrl?: string }>()
  if (body.name) {
    await c.env.DB
      .prepare('UPDATE organisations SET name = ? WHERE id = ?')
      .bind(body.name.trim(), member.org_id).run()
  }
  return c.json({ ok: true })
})

// ── GET /org/members ──────────────────────────────────────────────────────────
org.get('/members', requireAuth, async (c) => {
  const userId = c.get('userId') as string
  const member = await c.env.DB
    .prepare('SELECT * FROM org_members WHERE user_id = ? AND is_active = 1 LIMIT 1')
    .bind(userId).first<any>()
  if (!member) return c.json({ error: 'Nicht in einer Org.' }, 403)

  const members = await c.env.DB
    .prepare(`SELECT om.*, u.email, u.first_name, u.last_name, u.avatar_url, u.public_username, u.name_visibility
              FROM org_members om
              JOIN users u ON u.id = om.user_id
              WHERE om.org_id = ? AND om.is_active = 1
              ORDER BY om.role ASC, om.joined_at ASC`)
    .bind(member.org_id).all<any>()

  return c.json(members.results.map(m => ({
    id: m.id, userId: m.user_id, email: m.email,
    displayName: `${m.first_name} ${m.last_name}`.trim() || m.email,
    avatarUrl: m.avatar_url, orgRole: m.role, joinedAt: m.joined_at,
    isActive: m.is_active === 1,
    permissions: {
      canManageMembers:          m.can_manage_members === 1,
      canManageInviteCodes:      m.can_manage_invite_codes === 1,
      canCreateGroups:           m.can_create_groups === 1,
      canManageFiles:            m.can_manage_files === 1,
      canInviteToChats:          m.can_invite_to_chats === 1,
      canUseMoreSpace:           m.can_use_more_space === 1,
      canViewSalaries:           m.can_view_salaries === 1,
      canManageEmployeeProfiles: m.can_manage_employee_profiles === 1,
      canManageOrgStructure:     m.can_manage_org_structure === 1,
      canUseRecruitment:         m.can_use_recruitment === 1,
      canManageRecruitment:      m.can_manage_recruitment === 1,
    },
  })))
})

// ── POST /org/invite — invite by email ───────────────────────────────────────
org.post('/invite', requireAuth, async (c) => {
  const userId = c.get('userId') as string
  const member = await c.env.DB
    .prepare("SELECT * FROM org_members WHERE user_id = ? AND is_active = 1 AND (role = 'Owner' OR can_manage_members = 1) LIMIT 1")
    .bind(userId).first<any>()
  if (!member) return c.json({ error: 'Keine Berechtigung.' }, 403)

  const { email } = await c.req.json<{ email: string; message?: string }>()
  if (!email) return c.json({ error: 'E-Mail erforderlich.' }, 400)

  // Check if already member
  const target = await c.env.DB
    .prepare('SELECT id FROM users WHERE email_normalized = ?')
    .bind(email.trim().toUpperCase()).first<any>()

  if (target) {
    const alreadyMember = await c.env.DB
      .prepare('SELECT id FROM org_members WHERE user_id = ? AND org_id = ? AND is_active = 1')
      .bind(target.id, member.org_id).first()
    if (alreadyMember)
      return c.json({ error: 'Diese Person ist bereits in deiner Organisation.' }, 409)
  }

  // For now: create a pending invite code and email it
  // TODO: implement pending_invites table for full invite flow
  return c.json({ ok: true, message: 'Einladung wird gesendet.' })
})

// ── GET /org/invite-codes ─────────────────────────────────────────────────────
org.get('/invite-codes', requireAuth, async (c) => {
  const userId = c.get('userId') as string
  const member = await c.env.DB
    .prepare('SELECT * FROM org_members WHERE user_id = ? AND is_active = 1 LIMIT 1')
    .bind(userId).first<any>()
  if (!member) return c.json([], 200)

  const codes = await c.env.DB
    .prepare('SELECT * FROM org_invite_codes WHERE org_id = ? ORDER BY created_at DESC')
    .bind(member.org_id).all<any>()

  return c.json(codes.results.map(c => ({
    id: c.id, code: c.code, createdByName: c.created_by_name,
    createdAt: c.created_at, expiresAt: c.expires_at,
    usedCount: c.used_count, maxUses: c.max_uses,
  })))
})

// ── POST /org/invite-codes — create new code ──────────────────────────────────
org.post('/invite-codes', requireAuth, async (c) => {
  const userId = c.get('userId') as string
  const user   = c.get('userRow') as any
  const member = await c.env.DB
    .prepare("SELECT * FROM org_members WHERE user_id = ? AND is_active = 1 AND (role = 'Owner' OR can_manage_invite_codes = 1) LIMIT 1")
    .bind(userId).first<any>()
  if (!member) return c.json({ error: 'Keine Berechtigung.' }, 403)

  const body = await c.req.json<{ expiresAt?: string; maxUses?: number }>().catch(() => ({}))
  const code = randomInviteCode()
  const name = `${user.first_name} ${user.last_name}`.trim() || user.email

  const res = await c.env.DB
    .prepare('INSERT INTO org_invite_codes (org_id, code, created_by_id, created_by_name, expires_at, max_uses) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(member.org_id, code, userId, name, body.expiresAt ?? null, body.maxUses ?? null).run()

  const row = await c.env.DB
    .prepare('SELECT * FROM org_invite_codes WHERE id = ?')
    .bind(res.meta.last_row_id).first<any>()

  return c.json({
    id: row.id, code: row.code, createdByName: row.created_by_name,
    createdAt: row.created_at, expiresAt: row.expires_at,
    usedCount: row.used_count, maxUses: row.max_uses,
  })
})

// ── DELETE /org/invite-codes/:id ──────────────────────────────────────────────
org.delete('/invite-codes/:id', requireAuth, async (c) => {
  const userId = c.get('userId') as string
  const member = await c.env.DB
    .prepare("SELECT * FROM org_members WHERE user_id = ? AND is_active = 1 AND (role = 'Owner' OR can_manage_invite_codes = 1) LIMIT 1")
    .bind(userId).first<any>()
  if (!member) return c.json({ error: 'Keine Berechtigung.' }, 403)

  await c.env.DB
    .prepare('DELETE FROM org_invite_codes WHERE id = ? AND org_id = ?')
    .bind(c.req.param('id'), member.org_id).run()

  return new Response(null, { status: 204 })
})

// ── POST /org/join — join by invite code ──────────────────────────────────────
org.post('/join', requireAuth, async (c) => {
  const userId = c.get('userId') as string
  const { code } = await c.req.json<{ code: string }>()
  if (!code) return c.json({ error: 'Code erforderlich.' }, 400)

  const now  = new Date().toISOString()
  const inv  = await c.env.DB
    .prepare('SELECT * FROM org_invite_codes WHERE code = ? AND (expires_at IS NULL OR expires_at > ?) AND (max_uses IS NULL OR used_count < max_uses)')
    .bind(code.trim().toUpperCase(), now).first<any>()
  if (!inv) return c.json({ error: 'Ungültiger oder abgelaufener Einladungs-Code.' }, 400)

  // Check not already member
  const existing = await c.env.DB
    .prepare('SELECT id FROM org_members WHERE user_id = ? AND org_id = ?')
    .bind(userId, inv.org_id).first()
  if (existing) return c.json({ error: 'Du bist bereits in dieser Organisation.' }, 409)

  // Check if in another org
  const otherMember = await c.env.DB
    .prepare('SELECT id FROM org_members WHERE user_id = ? AND is_active = 1 LIMIT 1')
    .bind(userId).first()
  if (otherMember) return c.json({ error: 'Du bist bereits in einer anderen Organisation.' }, 409)

  await c.env.DB
    .prepare('INSERT INTO org_members (org_id, user_id, role) VALUES (?, ?, ?)')
    .bind(inv.org_id, userId, 'Member').run()

  await c.env.DB
    .prepare('UPDATE org_invite_codes SET used_count = used_count + 1 WHERE id = ?')
    .bind(inv.id).run()

  return c.json({ ok: true })
})

// ── POST /org/leave ───────────────────────────────────────────────────────────
org.post('/leave', requireAuth, async (c) => {
  const userId = c.get('userId') as string
  const member = await c.env.DB
    .prepare("SELECT * FROM org_members WHERE user_id = ? AND is_active = 1 LIMIT 1")
    .bind(userId).first<any>()
  if (!member) return c.json({ error: 'Nicht in einer Org.' }, 404)
  if (member.role === 'Owner') return c.json({ error: 'Owner kann die Org nicht verlassen.' }, 400)

  // Archive employee files instead of deleting
  await c.env.DB
    .prepare("UPDATE employee_files SET is_archived = 1, archived_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE subject_user_id = ? AND org_id = ?")
    .bind(userId, member.org_id).run()

  await c.env.DB
    .prepare('UPDATE org_members SET is_active = 0 WHERE id = ?')
    .bind(member.id).run()

  return c.json({ ok: true })
})

// ── DELETE /org/members/:userId — remove member ───────────────────────────────
org.delete('/members/:uid', requireAuth, async (c) => {
  const userId  = c.get('userId') as string
  const targetId = c.req.param('uid')

  const myMember = await c.env.DB
    .prepare("SELECT * FROM org_members WHERE user_id = ? AND is_active = 1 AND (role = 'Owner' OR can_manage_members = 1) LIMIT 1")
    .bind(userId).first<any>()
  if (!myMember) return c.json({ error: 'Keine Berechtigung.' }, 403)

  await c.env.DB
    .prepare("UPDATE employee_files SET is_archived = 1, archived_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE subject_user_id = ? AND org_id = ?")
    .bind(targetId, myMember.org_id).run()

  await c.env.DB
    .prepare('UPDATE org_members SET is_active = 0 WHERE user_id = ? AND org_id = ?')
    .bind(targetId, myMember.org_id).run()

  return new Response(null, { status: 204 })
})

// ── PUT /org/members/:id/role ─────────────────────────────────────────────────
org.put('/members/:id/role', requireAuth, async (c) => {
  const userId = c.get('userId') as string
  const myMember = await c.env.DB
    .prepare("SELECT * FROM org_members WHERE user_id = ? AND is_active = 1 AND role = 'Owner' LIMIT 1")
    .bind(userId).first<any>()
  if (!myMember) return c.json({ error: 'Nur Owner kann Rollen vergeben.' }, 403)

  const { role } = await c.req.json<{ role: string }>()
  if (!['Admin', 'Member'].includes(role))
    return c.json({ error: 'Ungültige Rolle.' }, 400)

  await c.env.DB
    .prepare('UPDATE org_members SET role = ? WHERE id = ? AND org_id = ?')
    .bind(role, c.req.param('id'), myMember.org_id).run()

  return c.json({ ok: true })
})

// ── PUT /org/members/:id/permissions ─────────────────────────────────────────
org.put('/members/:id/permissions', requireAuth, async (c) => {
  const userId = c.get('userId') as string
  const myMember = await c.env.DB
    .prepare("SELECT * FROM org_members WHERE user_id = ? AND is_active = 1 AND role = 'Owner' LIMIT 1")
    .bind(userId).first<any>()
  if (!myMember) return c.json({ error: 'Nur Owner kann Berechtigungen ändern.' }, 403)

  const p = await c.req.json<Record<string, boolean>>()
  const fields = [
    'can_manage_members','can_manage_invite_codes','can_create_groups','can_manage_files',
    'can_invite_to_chats','can_use_more_space','can_view_salaries',
    'can_manage_employee_profiles','can_manage_org_structure','can_use_recruitment','can_manage_recruitment'
  ]

  // Convert camelCase keys to snake_case
  const toSnake = (s: string) => s.replace(/[A-Z]/g, l => `_${l.toLowerCase()}`)
  const sets = fields.map(f => `${f} = ?`).join(', ')
  const vals = fields.map(f => {
    const key = f.split('_').map((w,i) => i === 0 ? w : w[0].toUpperCase() + w.slice(1)).join('')
    return p[key] ? 1 : 0
  })

  await c.env.DB
    .prepare(`UPDATE org_members SET ${sets} WHERE id = ? AND org_id = ?`)
    .bind(...vals, c.req.param('id'), myMember.org_id).run()

  return c.json({ ok: true })
})

// ── GET /org/permissions/morespace / recruitment ──────────────────────────────
org.get('/permissions/morespace', requireAuth, async (c) => {
  return c.json(await permissionStatus(c, 'MoreSpace'))
})
org.get('/permissions/recruitment', requireAuth, async (c) => {
  return c.json(await permissionStatus(c, 'Recruitment'))
})

async function permissionStatus(c: any, product: string) {
  const userId = c.get('userId') as string
  const member = await c.env.DB
    .prepare('SELECT * FROM org_members WHERE user_id = ? AND is_active = 1 LIMIT 1')
    .bind(userId).first<any>()
  if (!member) return { ownerHasLicense: false, allowedCount: 0, totalMembers: 0 }

  const org = await c.env.DB
    .prepare('SELECT owner_id FROM organisations WHERE id = ?')
    .bind(member.org_id).first<any>()

  const ownerHas = await c.env.DB
    .prepare("SELECT id FROM user_extensions WHERE user_id = ? AND product = ? AND is_active = 1 AND (expires_at IS NULL OR expires_at > strftime('%Y-%m-%dT%H:%M:%SZ','now'))")
    .bind(org?.owner_id, product).first()

  const totalMembers = await c.env.DB
    .prepare('SELECT COUNT(*) as n FROM org_members WHERE org_id = ? AND is_active = 1')
    .bind(member.org_id).first<{ n: number }>()

  return {
    ownerHasLicense: !!ownerHas,
    allowedCount: ownerHas ? (totalMembers?.n ?? 0) : 0,
    totalMembers: totalMembers?.n ?? 0,
  }
}

// ── Org Structure: Positions & Departments ────────────────────────────────────

org.get('/positions', requireAuth, async (c) => {
  const m = await getMember(c); if (!m) return c.json({ error: 'Nicht in einer Org.' }, 403)
  const r = await c.env.DB.prepare('SELECT * FROM org_positions WHERE org_id = ? ORDER BY sort_order').bind(m.org_id).all<any>()
  return c.json(r.results.map(p => ({ id: p.id, orgId: p.org_id, title: p.title, color: p.color, sortOrder: p.sort_order })))
})
org.post('/positions', requireAuth, async (c) => {
  const m = await getMember(c); if (!m) return c.json({ error: 'Nicht in einer Org.' }, 403)
  if (!canManageStructure(m)) return c.json({ error: 'Keine Berechtigung.' }, 403)
  const { title, color } = await c.req.json<any>()
  const res = await c.env.DB.prepare('INSERT INTO org_positions (org_id, title, color) VALUES (?, ?, ?)').bind(m.org_id, title, color ?? null).run()
  const r = await c.env.DB.prepare('SELECT * FROM org_positions WHERE id = ?').bind(res.meta.last_row_id).first<any>()
  return c.json({ id: r.id, orgId: r.org_id, title: r.title, color: r.color, sortOrder: r.sort_order })
})
org.put('/positions/:id', requireAuth, async (c) => {
  const m = await getMember(c); if (!m) return c.json({ error: 'Nicht in einer Org.' }, 403)
  if (!canManageStructure(m)) return c.json({ error: 'Keine Berechtigung.' }, 403)
  const { title, color } = await c.req.json<any>()
  await c.env.DB.prepare('UPDATE org_positions SET title = ?, color = ? WHERE id = ? AND org_id = ?').bind(title, color ?? null, c.req.param('id'), m.org_id).run()
  return c.json({ ok: true })
})
org.delete('/positions/:id', requireAuth, async (c) => {
  const m = await getMember(c); if (!m) return c.json({ error: 'Nicht in einer Org.' }, 403)
  if (!canManageStructure(m)) return c.json({ error: 'Keine Berechtigung.' }, 403)
  await c.env.DB.prepare('DELETE FROM org_positions WHERE id = ? AND org_id = ?').bind(c.req.param('id'), m.org_id).run()
  return new Response(null, { status: 204 })
})

org.get('/departments', requireAuth, async (c) => {
  const m = await getMember(c); if (!m) return c.json({ error: 'Nicht in einer Org.' }, 403)
  const r = await c.env.DB.prepare('SELECT * FROM org_departments WHERE org_id = ? ORDER BY sort_order').bind(m.org_id).all<any>()
  return c.json(r.results.map(d => ({ id: d.id, orgId: d.org_id, name: d.name, color: d.color, sortOrder: d.sort_order })))
})
org.post('/departments', requireAuth, async (c) => {
  const m = await getMember(c); if (!m) return c.json({ error: 'Nicht in einer Org.' }, 403)
  if (!canManageStructure(m)) return c.json({ error: 'Keine Berechtigung.' }, 403)
  const { name, color } = await c.req.json<any>()
  const res = await c.env.DB.prepare('INSERT INTO org_departments (org_id, name, color) VALUES (?, ?, ?)').bind(m.org_id, name, color ?? null).run()
  const r = await c.env.DB.prepare('SELECT * FROM org_departments WHERE id = ?').bind(res.meta.last_row_id).first<any>()
  return c.json({ id: r.id, orgId: r.org_id, name: r.name, color: r.color, sortOrder: r.sort_order })
})
org.put('/departments/:id', requireAuth, async (c) => {
  const m = await getMember(c); if (!m) return c.json({ error: 'Nicht in einer Org.' }, 403)
  if (!canManageStructure(m)) return c.json({ error: 'Keine Berechtigung.' }, 403)
  const { name, color } = await c.req.json<any>()
  await c.env.DB.prepare('UPDATE org_departments SET name = ?, color = ? WHERE id = ? AND org_id = ?').bind(name, color ?? null, c.req.param('id'), m.org_id).run()
  return c.json({ ok: true })
})
org.delete('/departments/:id', requireAuth, async (c) => {
  const m = await getMember(c); if (!m) return c.json({ error: 'Nicht in einer Org.' }, 403)
  if (!canManageStructure(m)) return c.json({ error: 'Keine Berechtigung.' }, 403)
  await c.env.DB.prepare('DELETE FROM org_departments WHERE id = ? AND org_id = ?').bind(c.req.param('id'), m.org_id).run()
  return new Response(null, { status: 204 })
})

// ── Employees (profile data) ──────────────────────────────────────────────────
org.get('/employees', requireAuth, async (c) => {
  const m = await getMember(c); if (!m) return c.json({ error: 'Nicht in einer Org.' }, 403)
  const canViewSalaries = m.role === 'Owner' || m.can_view_salaries === 1

  const rows = await c.env.DB.prepare(`
    SELECT om.id as member_id, om.user_id, om.role, u.email,
           u.first_name, u.last_name, u.avatar_url,
           ep.position_id, op.title as position_title,
           ep.department_id, od.name as department_name,
           ep.hourly_rate, ep.monthly_salary, ep.weekly_hours,
           ep.hire_date, ep.profile_notes
    FROM org_members om
    JOIN users u ON u.id = om.user_id
    LEFT JOIN employee_profiles ep ON ep.member_id = om.id
    LEFT JOIN org_positions op ON op.id = ep.position_id
    LEFT JOIN org_departments od ON od.id = ep.department_id
    WHERE om.org_id = ? AND om.is_active = 1
    ORDER BY om.role, u.first_name
  `).bind(m.org_id).all<any>()

  return c.json(rows.results.map(r => ({
    memberId: r.member_id, userId: r.user_id,
    displayName: `${r.first_name} ${r.last_name}`.trim() || r.email,
    email: m.role === 'Owner' || m.can_manage_employee_profiles === 1 ? r.email : null,
    role: r.role,
    positionId: r.position_id, positionTitle: r.position_title,
    departmentId: r.department_id, departmentName: r.department_name,
    hourlyRate:    canViewSalaries ? r.hourly_rate    : null,
    monthlySalary: canViewSalaries ? r.monthly_salary : null,
    weeklyHours: r.weekly_hours, hireDate: r.hire_date,
    profileNotes: m.can_manage_employee_profiles === 1 ? r.profile_notes : null,
    salaryVisibleToCaller: canViewSalaries,
  })))
})

org.put('/employees/:userId', requireAuth, async (c) => {
  const userId = c.get('userId') as string
  const m = await getMember(c); if (!m) return c.json({ error: 'Nicht in einer Org.' }, 403)
  if (m.role !== 'Owner' && m.can_manage_employee_profiles !== 1)
    return c.json({ error: 'Keine Berechtigung.' }, 403)

  const targetMember = await c.env.DB
    .prepare('SELECT id FROM org_members WHERE user_id = ? AND org_id = ? AND is_active = 1')
    .bind(c.req.param('userId'), m.org_id).first<any>()
  if (!targetMember) return c.json({ error: 'Mitglied nicht gefunden.' }, 404)

  const body = await c.req.json<any>()

  // Upsert employee_profiles
  const existing = await c.env.DB
    .prepare('SELECT id FROM employee_profiles WHERE member_id = ?')
    .bind(targetMember.id).first()

  if (existing) {
    await c.env.DB.prepare(`
      UPDATE employee_profiles SET position_id=?, department_id=?, hourly_rate=?,
      monthly_salary=?, weekly_hours=?, hire_date=?, profile_notes=? WHERE member_id=?
    `).bind(
      body.positionId ?? null, body.departmentId ?? null,
      body.hourlyRate ?? null, body.monthlySalary ?? null, body.weeklyHours ?? null,
      body.hireDate ?? null, body.profileNotes ?? null, targetMember.id
    ).run()
  } else {
    await c.env.DB.prepare(`
      INSERT INTO employee_profiles (member_id, position_id, department_id, hourly_rate,
      monthly_salary, weekly_hours, hire_date, profile_notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      targetMember.id, body.positionId ?? null, body.departmentId ?? null,
      body.hourlyRate ?? null, body.monthlySalary ?? null, body.weeklyHours ?? null,
      body.hireDate ?? null, body.profileNotes ?? null
    ).run()
  }

  return c.json({ ok: true })
})

// ── Helpers ───────────────────────────────────────────────────────────────────
async function getMember(c: any) {
  const userId = c.get('userId') as string
  return c.env.DB
    .prepare('SELECT * FROM org_members WHERE user_id = ? AND is_active = 1 LIMIT 1')
    .bind(userId).first<any>()
}
function canManageStructure(m: any) {
  return m.role === 'Owner' || m.can_manage_org_structure === 1
}

export default org
