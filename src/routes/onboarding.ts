import { Hono } from 'hono'
import { requireAuth } from '../middleware/auth'
import type { Env, AppEnv } from '../types'
import { buildUserDto } from '../types'

const onboarding = new Hono<AppEnv>()

onboarding.use('*', requireAuth)

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function fetchFullUser(db: any, userId: string) {
  return db
    .prepare(
      `SELECT
        u.*,
        om.org_id,
        om.org_role,
        om.can_manage_files,
        om.can_view_salaries,
        (
          SELECT json_group_array(p.slug)
          FROM user_extensions ue
          INNER JOIN products p ON p.id = ue.product_id
          WHERE ue.user_id = u.id
            AND ue.is_active = 1
            AND (ue.expires_at IS NULL OR ue.expires_at > strftime('%Y-%m-%dT%H:%M:%SZ','now'))
        ) AS active_extensions
      FROM users u
      LEFT JOIN org_members om ON om.user_id = u.id
      WHERE u.id = ?`
    )
    .bind(userId)
    .first<any>()
}

// Valid account types
const VALID_ACCOUNT_TYPES = ['Private', 'Organisation'] as const
type AccountType = (typeof VALID_ACCOUNT_TYPES)[number]

// Extension slugs that allow org creation
const ORG_CREATION_SLUGS = [
  'business',
  'recruitment',
  'akten',
  'chat',
  'morespace',
  'allinone',
  'premium',
]

// ─── Routes ──────────────────────────────────────────────────────────────────

// POST /onboarding/account-type
onboarding.post('/account-type', async (c) => {
  const user = c.get('user')
  const db = c.env.DB

  const body = await c.req.json<{ accountType: AccountType }>()

  if (!body.accountType || !VALID_ACCOUNT_TYPES.includes(body.accountType)) {
    return c.json(
      { error: `accountType must be one of: ${VALID_ACCOUNT_TYPES.join(', ')}` },
      400
    )
  }

  await db
    .prepare(`UPDATE users SET account_type = ? WHERE id = ?`)
    .bind(body.accountType, user.id)
    .run()

  const updatedUser = await fetchFullUser(db, user.id)
  if (!updatedUser) {
    return c.json({ error: 'User not found after update' }, 500)
  }

  return c.json(buildUserDto(updatedUser))
})

// POST /onboarding/org
onboarding.post('/org', async (c) => {
  const user = c.get('user')
  const db = c.env.DB

  const body = await c.req.json<{ name: string }>()

  if (!body.name || !body.name.trim()) {
    return c.json({ error: 'name is required' }, 400)
  }

  // Check if user is already in an org
  const existingMembership = await db
    .prepare(`SELECT org_id FROM org_members WHERE user_id = ? LIMIT 1`)
    .bind(user.id)
    .first<{ org_id: string }>()

  if (existingMembership) {
    return c.json({ error: 'You are already a member of an organisation' }, 409)
  }

  // Check permission to create org
  const currentUser = await db
    .prepare(`SELECT account_type FROM users WHERE id = ?`)
    .bind(user.id)
    .first<{ account_type: string }>()

  const hasOrgAccountType = currentUser?.account_type === 'Organisation'

  let hasOrgExtension = false
  if (!hasOrgAccountType) {
    const extensions = await db
      .prepare(
        `SELECT p.slug FROM user_extensions ue
         INNER JOIN products p ON p.id = ue.product_id
         WHERE ue.user_id = ? AND ue.is_active = 1
           AND (ue.expires_at IS NULL OR ue.expires_at > strftime('%Y-%m-%dT%H:%M:%SZ','now'))`
      )
      .bind(user.id)
      .all()

    const userSlugs = (extensions.results ?? []).map((r: any) => r.slug as string)
    hasOrgExtension = userSlugs.some((slug) => ORG_CREATION_SLUGS.includes(slug))
  }

  if (!hasOrgAccountType && !hasOrgExtension) {
    return c.json(
      {
        error:
          'You need an Organisation account type or an active business extension to create an organisation',
      },
      403
    )
  }

  // Create org
  const orgId = crypto.randomUUID()
  const orgName = body.name.trim()

  await db
    .prepare(
      `INSERT INTO orgs (id, name, created_at, is_active)
       VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'), 1)`
    )
    .bind(orgId, orgName)
    .run()

  // Add user as Owner
  await db
    .prepare(
      `INSERT INTO org_members (user_id, org_id, org_role, joined_at)
       VALUES (?, ?, 'Owner', strftime('%Y-%m-%dT%H:%M:%SZ','now'))`
    )
    .bind(user.id, orgId)
    .run()

  // Fetch updated user with new org membership
  const updatedUser = await fetchFullUser(db, user.id)
  if (!updatedUser) {
    return c.json({ error: 'Failed to fetch updated user' }, 500)
  }

  return c.json(buildUserDto(updatedUser), 201)
})

export default onboarding
