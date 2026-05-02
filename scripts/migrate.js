#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════════
// CustoSoft Data Migration: ASP.NET SQLite → Cloudflare D1
// Usage: node scripts/migrate.js
//
// Reads custosoft.db (ASP.NET Identity schema) and outputs:
//   scripts/migrated_users.sql
//   scripts/migrated_orgs.sql
//   scripts/migrated_data.sql
//
// Then import via:
//   wrangler d1 execute custosoft-db --file=scripts/migrated_users.sql --remote
//   wrangler d1 execute custosoft-db --file=scripts/migrated_orgs.sql --remote
//   wrangler d1 execute custosoft-db --file=scripts/migrated_data.sql --remote
// ══════════════════════════════════════════════════════════════════════════════

const path    = require('path')
const fs      = require('fs')
const Database = require('better-sqlite3')

const DB_PATH = path.join(__dirname, '../../CustoSoftAPI/custosoft.db')
const OUT_DIR = __dirname

if (!fs.existsSync(DB_PATH)) {
  console.error(`DB not found at ${DB_PATH}`)
  process.exit(1)
}

const db    = new Database(DB_PATH, { readonly: true })
const lines = { users: [], orgs: [], data: [] }

function esc(val) {
  if (val === null || val === undefined) return 'NULL'
  if (typeof val === 'number') return val.toString()
  if (typeof val === 'boolean') return val ? '1' : '0'
  return `'${String(val).replace(/'/g, "''")}'`
}

function iso(val) {
  if (!val) return 'NULL'
  try {
    const d = new Date(val)
    return esc(d.toISOString().replace('T', 'T').replace('.000Z', 'Z'))
  } catch { return 'NULL' }
}

// ── Users (AspNetUsers → users) ───────────────────────────────────────────────
console.log('Migrating users...')
const users = db.prepare('SELECT * FROM AspNetUsers').all()

for (const u of users) {
  // NOTE: Password hashes from ASP.NET Identity are NOT compatible with our PBKDF2 format.
  // Users will need to use "Forgot Password" to set a new password.
  // Apple/Google logins will still work.
  const firstName = esc(u.FirstName || '')
  const lastName  = esc(u.LastName  || '')
  const email     = esc(u.Email || u.UserName || '')
  const emailNorm = esc((u.Email || u.UserName || '').toUpperCase())

  lines.users.push(
    `INSERT OR IGNORE INTO users ` +
    `(id, email, email_normalized, password_hash, first_name, last_name, avatar_url, ` +
    `account_type, app_role, public_username, name_visibility, email_confirmed, is_blocked, ` +
    `apple_sub, registered_at, last_login_at) VALUES ` +
    `(${esc(u.Id)}, ${email}, ${emailNorm}, NULL, ${firstName}, ${lastName}, ` +
    `${esc(u.AvatarUrl)}, ${esc(u.AccountType || 'Private')}, ` +
    `${esc(u.AppRole)}, ${esc(u.PublicUsername)}, ${esc(u.NameVisibility || 'Public')}, ` +
    `${u.EmailConfirmed ? 1 : 0}, ${u.IsBlocked ? 1 : 0}, ` +
    `${esc(u.AppleSub)}, ${iso(u.RegisteredAt)}, ${iso(u.LastLoginAt)});`
  )
}
console.log(`  → ${users.length} users`)

// ── Organisations ─────────────────────────────────────────────────────────────
console.log('Migrating organisations...')
const orgs = db.prepare('SELECT * FROM Organizations').all()
for (const o of orgs) {
  lines.orgs.push(
    `INSERT OR IGNORE INTO organisations (id, name, owner_id, logo_url, created_at) VALUES ` +
    `(${esc(o.Id)}, ${esc(o.Name)}, ${esc(o.OwnerId)}, ${esc(o.LogoUrl)}, ${iso(o.CreatedAt)});`
  )
}
console.log(`  → ${orgs.length} organisations`)

// ── Org Members ───────────────────────────────────────────────────────────────
console.log('Migrating org members...')
const members = db.prepare('SELECT * FROM OrgMembers').all()
for (const m of members) {
  lines.data.push(
    `INSERT OR IGNORE INTO org_members ` +
    `(id, org_id, user_id, role, is_active, joined_at, ` +
    `can_manage_members, can_manage_invite_codes, can_create_groups, can_manage_files, ` +
    `can_invite_to_chats, can_use_more_space, can_view_salaries, ` +
    `can_manage_employee_profiles, can_manage_org_structure, can_use_recruitment, can_manage_recruitment) VALUES ` +
    `(${m.Id}, ${m.OrgId}, ${esc(m.UserId)}, ${esc(m.Role || 'Member')}, ${m.IsActive ? 1 : 0}, ` +
    `${iso(m.JoinedAt)}, ` +
    `${m.CanManageMembers?1:0}, ${m.CanManageInviteCodes?1:0}, ${m.CanCreateGroups?1:1}, ` +
    `${m.CanManageFiles?1:0}, ${m.CanInviteToChats?1:1}, ${m.CanUseMoreSpace?1:0}, ` +
    `${m.CanViewSalaries?1:0}, ${m.CanManageEmployeeProfiles?1:0}, ` +
    `${m.CanManageOrgStructure?1:0}, ${m.CanUseRecruitment?1:1}, ${m.CanManageRecruitment?1:0});`
  )
}
console.log(`  → ${members.length} members`)

// ── User Extensions ───────────────────────────────────────────────────────────
console.log('Migrating extensions...')
let extTable = 'UserExtensions'
try { db.prepare(`SELECT 1 FROM ${extTable} LIMIT 1`).get() } catch { extTable = null }
if (extTable) {
  const exts = db.prepare(`SELECT * FROM ${extTable}`).all()
  for (const e of exts) {
    lines.data.push(
      `INSERT OR IGNORE INTO user_extensions (id, user_id, product, granted_via, is_active, purchased_at, expires_at) VALUES ` +
      `(${e.Id}, ${esc(e.UserId)}, ${esc(e.ProductSlug || e.Product)}, ` +
      `${esc(e.GrantedVia || 'Purchase')}, ${e.IsActive?1:1}, ${iso(e.PurchasedAt)}, ${iso(e.ExpiresAt)});`
    )
  }
  console.log(`  → ${exts.length} extensions`)
}

// ── Conversations ─────────────────────────────────────────────────────────────
console.log('Migrating conversations...')
const convs = db.prepare('SELECT * FROM Conversations').all()
for (const conv of convs) {
  lines.data.push(
    `INSERT OR IGNORE INTO conversations (id, title, type, org_id, is_read_only, is_info_channel, created_at) VALUES ` +
    `(${conv.Id}, ${esc(conv.Title)}, ${esc(conv.Type)}, ${esc(conv.OrgId)}, ` +
    `${conv.IsReadOnly?1:0}, ${conv.IsInfoChannel?1:0}, ${iso(conv.CreatedAt)});`
  )
}
console.log(`  → ${convs.length} conversations`)

// ── Conversation Members ──────────────────────────────────────────────────────
const convMembers = db.prepare('SELECT * FROM ConversationMembers').all()
for (const m of convMembers) {
  lines.data.push(
    `INSERT OR IGNORE INTO conversation_members (id, conversation_id, user_id, joined_at) VALUES ` +
    `(${m.Id}, ${m.ConversationId}, ${esc(m.UserId)}, ${iso(m.JoinedAt)});`
  )
}
console.log(`  Messages members: ${convMembers.length}`)

// ── Messages ──────────────────────────────────────────────────────────────────
console.log('Migrating messages...')
const msgs = db.prepare('SELECT * FROM Messages').all()
for (const msg of msgs) {
  lines.data.push(
    `INSERT OR IGNORE INTO messages ` +
    `(id, conversation_id, sender_id, sender_name, body, sent_at, is_system, ` +
    `attachment_url, attachment_name, attachment_type, attachment_bytes) VALUES ` +
    `(${msg.Id}, ${msg.ConversationId}, ${esc(msg.SenderId)}, ${esc(msg.SenderName || '')}, ` +
    `${esc(msg.Body || '')}, ${iso(msg.SentAt)}, ${msg.IsSystem?1:0}, ` +
    `${esc(msg.AttachmentUrl)}, ${esc(msg.AttachmentName)}, ${esc(msg.AttachmentType)}, ` +
    `${esc(msg.AttachmentBytes)});`
  )
}
console.log(`  → ${msgs.length} messages`)

// ── Punch Entries ─────────────────────────────────────────────────────────────
console.log('Migrating punch entries...')
const punches = db.prepare('SELECT * FROM PunchEntries').all()
for (const p of punches) {
  lines.data.push(
    `INSERT OR IGNORE INTO punch_entries (id, user_id, org_id, clock_in, clock_out, pause_seconds, note, is_manual) VALUES ` +
    `(${p.Id}, ${esc(p.UserId)}, ${esc(p.OrgId)}, ${iso(p.ClockIn)}, ${iso(p.ClockOut)}, ` +
    `${p.PauseSeconds||0}, ${esc(p.Note)}, ${p.IsManual?1:0});`
  )
}
console.log(`  → ${punches.length} punch entries`)

// ── Employee Files ────────────────────────────────────────────────────────────
console.log('Migrating employee files...')
const efFiles = db.prepare('SELECT * FROM EmployeeFiles').all()
for (const f of efFiles) {
  lines.data.push(
    `INSERT OR IGNORE INTO employee_files ` +
    `(id, subject_user_id, subject_display_name, org_id, title, type, file_url, note, ` +
    `linked_punch_id, linked_message_id, created_by_user_id, created_at, visibility, is_archived, archived_at) VALUES ` +
    `(${f.Id}, ${esc(f.SubjectUserId)}, ${esc(f.SubjectDisplayName||'')}, ${esc(f.OrgId)}, ` +
    `${esc(f.Title)}, ${esc(f.Type)}, ${esc(f.FileUrl)}, ${esc(f.Note)}, ` +
    `${esc(f.LinkedPunchId)}, ${esc(f.LinkedMessageId)}, ${esc(f.CreatedByUserId)}, ` +
    `${iso(f.CreatedAt)}, ${f.Visibility||1}, ${f.IsArchived?1:0}, ${iso(f.ArchivedAt)});`
  )
}
console.log(`  → ${efFiles.length} employee files`)

// ── Legal Pages ───────────────────────────────────────────────────────────────
try {
  const pages = db.prepare('SELECT * FROM LegalPages').all()
  for (const p of pages) {
    lines.data.push(
      `INSERT OR REPLACE INTO legal_pages (id, slug, title, content, updated_at) VALUES ` +
      `(${p.Id}, ${esc(p.Slug)}, ${esc(p.Title)}, ${esc(p.Content)}, ${iso(p.UpdatedAt)});`
    )
  }
  console.log(`  Legal pages: ${pages.length}`)
} catch { console.log('  No legal pages table') }

// ── Write output files ────────────────────────────────────────────────────────
const header = (label) => `-- ${label}\nPRAGMA foreign_keys = OFF;\nBEGIN TRANSACTION;\n`
const footer = `\nCOMMIT;\nPRAGMA foreign_keys = ON;\n`

fs.writeFileSync(path.join(OUT_DIR, 'migrated_users.sql'),
  header('Users') + lines.users.join('\n') + footer)

fs.writeFileSync(path.join(OUT_DIR, 'migrated_orgs.sql'),
  header('Organisations') + lines.orgs.join('\n') + footer)

fs.writeFileSync(path.join(OUT_DIR, 'migrated_data.sql'),
  header('All Other Data') + lines.data.join('\n') + footer)

console.log('\n✅ Done!')
console.log('Files written:')
console.log('  scripts/migrated_users.sql')
console.log('  scripts/migrated_orgs.sql')
console.log('  scripts/migrated_data.sql')
console.log('\n⚠️  NOTE: Password hashes are NOT migrated.')
console.log('   Users must use "Forgot Password" to set a new password.')
console.log('   Apple/Google Sign-In continues to work without any reset.')
