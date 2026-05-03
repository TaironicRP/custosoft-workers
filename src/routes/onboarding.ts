// ── Onboarding — /api/v1/onboarding ──────────────────────────────────────────
import { Hono }              from 'hono'
import { requireAuth }       from '../middleware/auth'
import type { Env, AppEnv }  from '../types'
import { buildUserDto }      from '../types'

const onboarding = new Hono<AppEnv>()
onboarding.use('*', requireAuth)

const VALID_ACCOUNT_TYPES = ['Private', 'Organisation'] as const

// Slugs die zur Org-Erstellung berechtigen
const ORG_CREATION_SLUGS: string[] = [
  'BusinessBasic', 'BusinessBasicYearly',
  'BusinessL',     'BusinessLYearly',
  'BusinessMAX',   'BusinessMAXYearly',
  'AllInOne',      'AllInOneYearly',
  'Recruitment',   'MoreSpace',
  'Business',                              // Legacy
]

// POST /onboarding/account-type
onboarding.post('/account-type', async (c) => {
  const userId = c.get('userId') as string
  const body   = await c.req.json<{ accountType: string }>()

  if (!body.accountType || !VALID_ACCOUNT_TYPES.includes(body.accountType as any)) {
    return c.json({ error: `accountType muss "Private" oder "Organisation" sein.` }, 400)
  }

  await c.env.DB
    .prepare(`UPDATE users SET account_type = ? WHERE id = ?`)
    .bind(body.accountType, userId).run()

  const u = await c.env.DB.prepare(`SELECT * FROM users WHERE id = ?`).bind(userId).first<any>()
  if (!u) return c.json({ error: 'Nutzer nicht gefunden.' }, 500)

  return c.json(await buildUserDto(c.env.DB, u))
})

// POST /onboarding/org
onboarding.post('/org', async (c) => {
  const userId = c.get('userId') as string
  const body   = await c.req.json<{ name: string }>()

  if (!body.name?.trim()) {
    return c.json({ error: 'Org-Name ist Pflicht.' }, 400)
  }

  // Bereits in einer Org?
  const existing = await c.env.DB
    .prepare(`SELECT org_id FROM org_members WHERE user_id = ? AND is_active = 1 LIMIT 1`)
    .bind(userId).first<any>()

  if (existing) {
    return c.json({ error: 'Du bist bereits Mitglied einer Organisation.' }, 409)
  }

  // Berechtigungs-Check
  const u = await c.env.DB.prepare(`SELECT * FROM users WHERE id = ?`).bind(userId).first<any>()
  if (!u) return c.json({ error: 'Nutzer nicht gefunden.' }, 404)

  const isStaff = u.app_role != null
  const isOrgAccount = u.account_type === 'Organisation'

  let hasEligibleExtension = false
  if (!isStaff && !isOrgAccount) {
    const exts = await c.env.DB
      .prepare(`SELECT product FROM user_extensions
                WHERE user_id = ? AND is_active = 1
                  AND (expires_at IS NULL OR expires_at > strftime('%Y-%m-%dT%H:%M:%SZ','now'))`)
      .bind(userId).all<{ product: string }>()
    const slugs = (exts.results ?? []).map(r => r.product)
    hasEligibleExtension = slugs.some(s => ORG_CREATION_SLUGS.includes(s))
  }

  if (!isStaff && !isOrgAccount && !hasEligibleExtension) {
    return c.json({
      error: 'Du brauchst entweder Account-Typ "Organisation" oder eine Business/Premium-Lizenz um eine Organisation zu erstellen.'
    }, 403)
  }

  // Org erstellen — schema: (id AUTOINCREMENT, name, owner_id, logo_url, created_at)
  const orgInsert = await c.env.DB
    .prepare(`INSERT INTO organisations (name, owner_id) VALUES (?, ?)`)
    .bind(body.name.trim(), userId).run()

  const orgId = orgInsert.meta.last_row_id

  // User als Owner hinzufügen — schema: (org_id, user_id, role, ...permissions)
  await c.env.DB
    .prepare(`INSERT INTO org_members (
      org_id, user_id, role, is_active,
      can_manage_members, can_manage_invite_codes, can_create_groups, can_manage_files,
      can_invite_to_chats, can_use_more_space, can_view_salaries,
      can_manage_employee_profiles, can_manage_org_structure,
      can_use_recruitment, can_manage_recruitment
    ) VALUES (?, ?, 'Owner', 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1)`)
    .bind(orgId, userId).run()

  // last_seen_org_id setzen damit Org-Welcome nicht angezeigt wird
  await c.env.DB
    .prepare(`UPDATE users SET last_seen_org_id = ? WHERE id = ?`)
    .bind(orgId, userId).run()

  // ── Org-Object zurückgeben (matches iOS `Organisation` struct) ──────────
  const org = await c.env.DB
    .prepare(`SELECT * FROM organisations WHERE id = ?`)
    .bind(orgId).first<any>()
  if (!org) return c.json({ error: 'Org-Erstellung fehlgeschlagen.' }, 500)

  return c.json({
    id:               org.id,
    name:             org.name,
    ownerId:          org.owner_id,
    logoUrl:          org.logo_url,
    activeExtensions: [],
    memberCount:      1,
    createdAt:        org.created_at,
  }, 201)
})

export default onboarding
