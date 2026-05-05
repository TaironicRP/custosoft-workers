// ── Cloudflare Env Bindings ───────────────────────────────────────────────────
export interface Env {
  // D1 Database
  DB: D1Database

  // R2 Bucket (files, images, avatars)
  UPLOADS: R2Bucket

  // Secrets (set via: wrangler secret put <NAME>)
  JWT_SECRET:               string
  APPLE_CLIENT_ID:          string    // com.taironic.custosoft
  APPLE_TEAM_ID:            string
  APPLE_KEY_ID:             string
  APPLE_PRIVATE_KEY:        string    // .p8 key content, \n for newlines
  APPLE_IAP_SHARED_SECRET:  string
  RESEND_API_KEY:           string    // E-Mail-Versand via Resend

  // Vars (non-secret, in wrangler.toml)
  APP_ENV:         string
  PUBLIC_BASE_URL: string
  FROM_EMAIL:      string
  FROM_NAME:       string
  ALLOWED_ORIGINS: string
}

// ── DB Row Types (snake_case = SQLite column names) ───────────────────────────
export interface UserRow {
  id:               string
  email:            string
  email_normalized: string
  password_hash:    string | null
  first_name:       string
  last_name:        string
  avatar_url:       string | null
  account_type:     string
  app_role:         string | null
  public_username:  string | null
  name_visibility:  string
  last_seen_org_id: number | null
  email_confirmed:  number
  is_blocked:       number
  apple_sub:        string | null
  google_sub:       string | null
  registered_at:    string
  last_login_at:    string | null
}

export interface OrgMemberRow {
  id:          number
  org_id:      number
  user_id:     string
  role:        string
  is_active:   number
  joined_at:   string
  can_manage_members:           number
  can_manage_invite_codes:      number
  can_create_groups:            number
  can_manage_files:             number
  can_invite_to_chats:          number
  can_use_more_space:           number
  can_view_salaries:            number
  can_manage_employee_profiles: number
  can_manage_org_structure:     number
  can_use_recruitment:          number
  can_manage_recruitment:       number
}

export interface OrgRow {
  id:         number
  name:       string
  owner_id:   string
  logo_url:   string | null
  created_at: string
}

export interface ExtensionRow {
  id:                   number
  user_id:              string
  product:              string
  granted_via:          string
  is_active:            number
  purchased_at:         string
  expires_at:           string | null
  apple_transaction_id: string | null
}

export interface ConversationRow {
  id:              number
  title:           string
  type:            string
  org_id:          number | null
  is_read_only:    number
  is_info_channel: number
  created_at:      string
}

export interface MessageRow {
  id:               number
  conversation_id:  number
  sender_id:        string
  sender_name:      string
  body:             string
  sent_at:          string
  is_system:        number
  attachment_url:   string | null
  attachment_name:  string | null
  attachment_type:  string | null
  attachment_bytes: number | null
}

export interface PunchRow {
  id:            number
  user_id:       string
  org_id:        number | null
  clock_in:      string
  clock_out:     string | null
  pause_seconds: number
  note:          string | null
  is_manual:     number
}

export interface PauseRow {
  id:             number
  punch_entry_id: number
  paused_at:      string
  resumed_at:     string | null
}

export interface EmployeeFileRow {
  id:                   number
  subject_user_id:      string
  subject_display_name: string
  org_id:               number | null
  title:                string
  type:                 string
  file_url:             string | null
  note:                 string | null
  linked_punch_id:      number | null
  linked_message_id:    number | null
  created_by_user_id:   string
  created_at:           string
  visibility:           number
  is_archived:          number
  archived_at:          string | null
}

export interface ProductRow {
  id:                  number
  slug:                string
  name:                string
  description:         string
  price_formatted:     string
  is_active:           number
  is_subscription:     number
  trial_days:          number
  billing_period_days: number | null
  is_slot_based:       number
  base_price:          number | null
  per_slot_price:      number | null
  starting_slots:      number | null
  max_slots:           number | null
  apple_product_id:    string | null
}

// ── Hono Context Variables ────────────────────────────────────────────────────
export interface ContextVars {
  userId:   string
  userRow:  UserRow
  member:   OrgMemberRow | null
  orgId:    number | null
}

/** Shared Hono environment used by all routes */
export type AppEnv = {
  Bindings: Env
  Variables: {
    userId:  string
    userRow: any
    user:    any           // alias of userRow.id-bearing object
    member:  any
    orgId:   number
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** User display name, same logic as C# AppUser.DisplayName */
export function displayName(u: UserRow): string {
  const full = `${u.first_name} ${u.last_name}`.trim()
  return full || u.email
}

/** Active extensions for a user — deduplicated slugs.
 *  Org-Mitglieder erben alle aktiven Extensions des Org-Inhabers.
 *  MoreSpace ist seit v5 in allen Business-Packs (Basic, L) inklusive. */
export async function activeExtensions(db: D1Database, userId: string): Promise<string[]> {
  const now = new Date().toISOString()
  const rows = await db
    .prepare(`SELECT DISTINCT product FROM user_extensions
              WHERE user_id = ? AND is_active = 1
                AND (expires_at IS NULL OR expires_at > ?)`)
    .bind(userId, now)
    .all<{ product: string }>()
  const slugs = rows.results.map(r => r.product)

  // Org-Mitglieder erben alle aktiven Extensions des Org-Inhabers
  const membership = await db
    .prepare(`SELECT om.org_id, o.owner_id
              FROM org_members om
              JOIN organisations o ON o.id = om.org_id
              WHERE om.user_id = ? AND om.is_active = 1 LIMIT 1`)
    .bind(userId)
    .first<{ org_id: number; owner_id: string }>()

  if (membership && membership.owner_id !== userId) {
    const ownerRows = await db
      .prepare(`SELECT DISTINCT product FROM user_extensions
                WHERE user_id = ? AND is_active = 1
                  AND (expires_at IS NULL OR expires_at > ?)`)
      .bind(membership.owner_id, now)
      .all<{ product: string }>()
    for (const r of ownerRows.results) {
      if (!slugs.includes(r.product)) slugs.push(r.product)
    }
  }

  // Business-Packs inkludieren MoreSpace — auch wenn kein eigener MoreSpace-Kauf vorliegt
  const businessSlugs = ['BusinessBasic', 'BusinessBasicYearly', 'BusinessL', 'BusinessLYearly', 'Business']
  const hasAnyBusiness = slugs.some(s => businessSlugs.includes(s))
  if (hasAnyBusiness && !slugs.includes('MoreSpace')) {
    slugs.push('MoreSpace')
  }

  return slugs
}

/** Build AppUserDto (camelCase — matches iOS Model exactly) */
export async function buildUserDto(db: D1Database, u: UserRow) {
  const exts = await activeExtensions(db, u.id)

  // Org membership
  const member = await db
    .prepare(`SELECT om.*, o.name as org_name
              FROM org_members om
              JOIN organisations o ON o.id = om.org_id
              WHERE om.user_id = ? AND om.is_active = 1
              LIMIT 1`)
    .bind(u.id)
    .first<OrgMemberRow & { org_name: string }>()

  // Pending invite (user was invited but hasn't joined yet — store in a pending_invites table)
  // For now: null — implement as needed
  const pendingInvite = null

  // Individual org permissions — sent so the iOS app can show/hide tabs without
  // treating every Member as an Admin just to grant Recruitment access.
  const myOrgPermissions = member ? {
    canManageMembers:           member.can_manage_members           === 1,
    canManageInviteCodes:       member.can_manage_invite_codes      === 1,
    canCreateGroups:            member.can_create_groups            === 1,
    canManageFiles:             member.can_manage_files             === 1,
    canInviteToChats:           member.can_invite_to_chats          === 1,
    canUseMoreSpace:            member.can_use_more_space           === 1,
    canViewSalaries:            member.can_view_salaries            === 1,
    canManageEmployeeProfiles:  member.can_manage_employee_profiles === 1,
    canManageOrgStructure:      member.can_manage_org_structure     === 1,
    canUseRecruitment:          member.can_use_recruitment          === 1,
    canManageRecruitment:       member.can_manage_recruitment       === 1,
  } : null

  return {
    id:          u.id,
    email:       u.email,
    displayName: displayName(u),
    avatarUrl:   u.avatar_url,
    accountType: u.account_type,
    appRole:     u.app_role,
    orgId:       member?.org_id ?? null,
    orgRole:     member?.role ?? null,
    activeExtensions:  exts,
    publicUsername:    u.public_username,
    nameVisibility:    u.name_visibility,
    needsOrgWelcome:   member != null && member.org_id !== u.last_seen_org_id,
    pendingOrgInvite:  pendingInvite,
    emailConfirmed:    u.email_confirmed === 1,
    myOrgPermissions,
  }
}
