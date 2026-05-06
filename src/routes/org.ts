// ── Org Routes — /api/v1/org ──────────────────────────────────────────────────
import { Hono }        from 'hono'
import type { Env, AppEnv } from '../types'
import { requireAuth } from '../middleware/auth'
import { randomInviteCode } from '../utils/crypto'
import { archiveUserPunchEntries } from './punch'
import { sendEmail }   from '../utils/email'

// ── Slot-System: max Mitglieder je Lizenz-Tier ───────────────────────────────
// Owner-Lizenz bestimmt die Slots der Org. Ohne Business-Lizenz: max 1 (Owner allein).
function maxMembersForBusinessSlug(slug: string | null | undefined): number {
  if (!slug) return 1
  if (slug === 'BusinessBasic' || slug === 'BusinessBasicYearly') return 10
  if (slug === 'BusinessL'     || slug === 'BusinessLYearly')     return 50
  if (slug === 'BusinessMAX'   || slug === 'BusinessMAXYearly')   return 9999
  if (slug === 'Business')                                         return 10  // Legacy
  if (slug === 'AllInOne'      || slug === 'AllInOneYearly')      return 9999 // Legacy
  return 1
}

/** Gibt das Member-Limit der Org zurück (basierend auf Owner-Lizenz). */
async function getOrgMemberLimit(db: D1Database, orgId: number): Promise<{ limit: number; current: number; ownerSlug: string | null }> {
  const org = await db.prepare(`SELECT owner_id FROM organisations WHERE id = ?`).bind(orgId).first<{ owner_id: string }>()
  if (!org) return { limit: 1, current: 0, ownerSlug: null }

  const ownerExt = await db
    .prepare(`SELECT product FROM user_extensions
              WHERE user_id = ? AND is_active = 1
                AND product IN ('BusinessBasic','BusinessBasicYearly','BusinessL','BusinessLYearly','BusinessMAX','BusinessMAXYearly','Business','AllInOne','AllInOneYearly')
                AND (expires_at IS NULL OR expires_at > strftime('%Y-%m-%dT%H:%M:%SZ','now'))
              ORDER BY
                CASE product
                  WHEN 'BusinessMAX' THEN 1 WHEN 'BusinessMAXYearly' THEN 1 WHEN 'AllInOne' THEN 1 WHEN 'AllInOneYearly' THEN 1
                  WHEN 'BusinessL'   THEN 2 WHEN 'BusinessLYearly'   THEN 2
                  WHEN 'BusinessBasic' THEN 3 WHEN 'BusinessBasicYearly' THEN 3 WHEN 'Business' THEN 3
                  ELSE 9 END
              LIMIT 1`)
    .bind(org.owner_id).first<{ product: string }>()

  const limit = maxMembersForBusinessSlug(ownerExt?.product)

  const cur = await db.prepare(`SELECT COUNT(*) AS n FROM org_members WHERE org_id = ? AND is_active = 1`)
    .bind(orgId).first<{ n: number }>()

  return { limit, current: cur?.n ?? 0, ownerSlug: ownerExt?.product ?? null }
}

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

  // Slot-Info (current vs limit)
  const slots = await getOrgMemberLimit(c.env.DB, o.id)

  return c.json({
    id: o.id, name: o.name, ownerId: o.owner_id, logoUrl: o.logo_url,
    activeExtensions: exts.results.map(r => r.product),
    memberCount: memberCount?.n ?? 0,
    memberLimit: slots.limit,
    ownerLicenseSlug: slots.ownerSlug,
    createdAt: o.created_at,
  })
})

// ── DELETE /org — Organisation komplett auflösen (nur Owner) ─────────────────
org.delete('/', requireAuth, async (c) => {
  const userId = c.get('userId') as string
  const member = await c.env.DB
    .prepare("SELECT * FROM org_members WHERE user_id = ? AND is_active = 1 AND role = 'Owner' LIMIT 1")
    .bind(userId).first<any>()
  if (!member) return c.json({ error: 'Nur der Owner kann die Organisation auflösen.' }, 403)

  // Alle Akten archivieren
  await c.env.DB
    .prepare("UPDATE employee_files SET is_archived = 1, archived_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE org_id = ?")
    .bind(member.org_id).run()

  // Stempelzeiten ALLER aktiven Mitglieder archivieren — die User behalten
  // ihre Zeiten als persönliches Archiv auch nachdem die Org weg ist. Owner
  // ebenfalls (sieht seine Zeiten dann unter den eigenen Archiven).
  try {
    const allMembers = await c.env.DB.prepare(
      `SELECT user_id FROM org_members WHERE org_id = ? AND is_active = 1`
    ).bind(member.org_id).all<{ user_id: string }>()
    for (const m of (allMembers.results ?? [])) {
      try {
        await archiveUserPunchEntries(c.env.DB, m.user_id, 'org_delete', { orgIdFilter: member.org_id })
      } catch (e: any) {
        console.warn(`[org/delete] punch archive for ${m.user_id} failed:`, e?.message ?? e)
      }
    }
  } catch (e: any) {
    console.warn('[org/delete] punch archive bulk failed:', e?.message ?? e)
  }

  // Cascade-Delete via Schema-Constraints (organisations → ON DELETE CASCADE)
  await c.env.DB
    .prepare("DELETE FROM organisations WHERE id = ?")
    .bind(member.org_id).run()

  return new Response(null, { status: 204 })
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

  const items = (members.results ?? []).map(m => ({
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
  }))

  // PaginatedResponse-Shape (iOS erwartet items, totalCount, page, pageSize)
  return c.json({
    items,
    totalCount: items.length,
    page: 1,
    pageSize: items.length,
  })
})

// ── POST /org/invite — Einladung per E-Mail mit auto-generiertem Code ────────
org.post('/invite', requireAuth, async (c) => {
  const userId = c.get('userId') as string
  const userRow = c.get('userRow') as any
  const member = await c.env.DB
    .prepare("SELECT * FROM org_members WHERE user_id = ? AND is_active = 1 AND (role = 'Owner' OR role = 'Admin' OR can_manage_members = 1) LIMIT 1")
    .bind(userId).first<any>()
  if (!member) return c.json({ error: 'Keine Berechtigung.' }, 403)

  const { email, message } = await c.req.json<{ email: string; message?: string }>()
  if (!email?.trim()) return c.json({ error: 'E-Mail erforderlich.' }, 400)

  const cleanEmail = email.trim().toLowerCase()
  const upperEmail = cleanEmail.toUpperCase()

  // Bereits Mitglied?
  const target = await c.env.DB
    .prepare('SELECT id FROM users WHERE email_normalized = ?')
    .bind(upperEmail).first<any>()

  if (target) {
    const alreadyMember = await c.env.DB
      .prepare('SELECT id FROM org_members WHERE user_id = ? AND org_id = ? AND is_active = 1')
      .bind(target.id, member.org_id).first()
    if (alreadyMember)
      return c.json({ error: 'Diese Person ist bereits in deiner Organisation.' }, 409)
  }

  // ── SLOT-CHECK ──────────────────────────────────────────────────────
  const slots = await getOrgMemberLimit(c.env.DB, member.org_id)
  if (slots.current >= slots.limit) {
    return c.json({
      error: `Deine Organisation ist voll (${slots.current}/${slots.limit} Mitglieder). Buche Business L oder MAX um mehr Mitglieder einzuladen.`
    }, 409)
  }

  // Org-Daten für Email
  const org = await c.env.DB
    .prepare('SELECT name FROM organisations WHERE id = ?')
    .bind(member.org_id).first<{ name: string }>()
  if (!org) return c.json({ error: 'Org nicht gefunden.' }, 500)

  // Personalisierten Invite-Code erstellen (gültig 7 Tage, max 1 Verwendung)
  const codeChars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const codeBytes = crypto.getRandomValues(new Uint8Array(8))
  const code = Array.from(codeBytes).map(b => codeChars[b % codeChars.length]).join('')

  const expiresAt = new Date(Date.now() + 7 * 86400_000).toISOString()
  const inviterName = `${userRow.first_name ?? ''} ${userRow.last_name ?? ''}`.trim() || userRow.email

  await c.env.DB
    .prepare(`INSERT INTO org_invite_codes (org_id, code, created_by_id, created_by_name, expires_at, max_uses)
              VALUES (?, ?, ?, ?, ?, 1)`)
    .bind(member.org_id, code, userId, inviterName, expiresAt).run()

  // Email senden
  const subject = `${inviterName} lädt dich zu ${org.name} ein`
  const text = `Hallo!

${inviterName} hat dich zu ${org.name} bei CustoSoft eingeladen.

Dein persönlicher Einladungs-Code: ${code}

So trittst du bei:
1. CustoSoft App laden (App Store)
2. Account erstellen (oder einloggen)
3. Tippe auf "Organisation beitreten"
4. Code eingeben: ${code}

${message ? `Persönliche Nachricht:\n"${message}"\n\n` : ''}Der Code ist 7 Tage gültig.

— Dein CustoSoft Team`

  const html = `<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><style>
    body{margin:0;padding:0;background:#0a0a14;font-family:-apple-system,sans-serif}
    .wrap{max-width:540px;margin:40px auto;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.10);border-radius:24px;overflow:hidden}
    .hero{background:linear-gradient(135deg,#3366ff,#1144cc);padding:40px 32px;text-align:center}
    .hero h1{color:#fff;font-size:24px;font-weight:700;margin:0 0 6px}
    .hero p{color:rgba(255,255,255,0.85);margin:0;font-size:14px}
    .body{padding:32px;color:rgba(255,255,255,0.80)}
    .code-box{background:rgba(51,102,255,0.20);border:1px solid rgba(51,102,255,0.50);border-radius:14px;padding:24px;text-align:center;font-size:32px;font-weight:700;letter-spacing:8px;color:#7790ff;font-family:'SF Mono',monospace;margin:18px 0}
    .steps{background:rgba(255,255,255,0.05);border-radius:12px;padding:18px;margin-top:14px}
    .footer{padding:18px;border-top:1px solid rgba(255,255,255,0.07);text-align:center;color:rgba(255,255,255,0.30);font-size:11px}
  </style></head><body><div class="wrap">
    <div class="hero"><h1>👋 Du bist eingeladen!</h1><p>${inviterName} → ${org.name}</p></div>
    <div class="body">
      <p>Hallo,</p>
      <p><strong>${inviterName}</strong> hat dich zu <strong>${org.name}</strong> bei CustoSoft eingeladen.</p>
      <p style="font-size:13px;color:rgba(255,255,255,0.55)">Dein persönlicher Einladungs-Code:</p>
      <div class="code-box">${code}</div>
      ${message ? `<p style="background:rgba(255,255,255,0.06);padding:14px;border-radius:10px;font-style:italic;color:rgba(255,255,255,0.75)">"${message}"<br><span style="font-size:11px;color:rgba(255,255,255,0.45);font-style:normal">— ${inviterName}</span></p>` : ''}
      <div class="steps">
        <p style="font-weight:600;margin-bottom:10px">So trittst du bei:</p>
        <p style="margin:4px 0">1. <a href="https://apps.apple.com/de/app/custosoft" style="color:#7790ff;text-decoration:none">CustoSoft App</a> laden</p>
        <p style="margin:4px 0">2. Account erstellen oder einloggen</p>
        <p style="margin:4px 0">3. „Organisation beitreten" tippen</p>
        <p style="margin:4px 0">4. Code eingeben: <strong>${code}</strong></p>
      </div>
      <p style="font-size:12px;color:rgba(255,255,255,0.45);margin-top:18px">Der Code ist 7 Tage gültig (bis ${new Date(expiresAt).toLocaleDateString('de-DE')}).</p>
    </div>
    <div class="footer">CustoSoft · <a href="https://custosoftcustomers.com/datenschutz" style="color:rgba(255,255,255,0.50)">Datenschutz</a></div>
  </div></body></html>`

  const sent = await sendEmail({
    to: cleanEmail,
    subject,
    text,
    html,
    from: c.env.FROM_EMAIL,
    fromName: c.env.FROM_NAME,
    apiKey: c.env.RESEND_API_KEY,
  })

  if (!sent) {
    return c.json({ error: 'Einladungs-Mail konnte nicht gesendet werden.' }, 500)
  }

  return c.json({ ok: true, code, expiresAt })
})

// ── GET /org/invite-codes ─────────────────────────────────────────────────────
org.get('/invite-codes', requireAuth, async (c) => {
  const userId = c.get('userId') as string
  const member = await c.env.DB
    .prepare('SELECT * FROM org_members WHERE user_id = ? AND is_active = 1 LIMIT 1')
    .bind(userId).first<any>()
  if (!member) return c.json({ items: [], totalCount: 0, page: 1, pageSize: 100 })

  const codes = await c.env.DB
    .prepare('SELECT * FROM org_invite_codes WHERE org_id = ? ORDER BY created_at DESC')
    .bind(member.org_id).all<any>()

  const items = (codes.results ?? []).map(c => ({
    id: c.id, code: c.code, createdByName: c.created_by_name,
    createdAt: c.created_at, expiresAt: c.expires_at,
    usedCount: c.used_count, maxUses: c.max_uses,
  }))

  return c.json({ items, totalCount: items.length, page: 1, pageSize: items.length })
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

// ── GET /org/preview-code?code=XXX — Vorschau OHNE Beitritt (für Confirmation-Popup) ──
org.get('/preview-code', requireAuth, async (c) => {
  const code = (c.req.query('code') ?? '').trim().toUpperCase()
  if (!code) return c.json({ error: 'Code erforderlich.' }, 400)

  const now = new Date().toISOString()
  const inv = await c.env.DB
    .prepare(`SELECT * FROM org_invite_codes
              WHERE code = ?
                AND (expires_at IS NULL OR expires_at > ?)
                AND (max_uses IS NULL OR used_count < max_uses)`)
    .bind(code, now).first<any>()
  if (!inv) return c.json({ error: 'Ungültiger oder abgelaufener Einladungs-Code.' }, 404)

  const org = await c.env.DB
    .prepare('SELECT * FROM organisations WHERE id = ?')
    .bind(inv.org_id).first<any>()
  if (!org) return c.json({ error: 'Organisation nicht gefunden.' }, 404)

  // Owner-Daten für Anzeige
  const owner = await c.env.DB
    .prepare(`SELECT first_name, last_name, email FROM users WHERE id = ?`)
    .bind(org.owner_id).first<any>()
  const ownerName = owner
    ? (`${owner.first_name ?? ''} ${owner.last_name ?? ''}`.trim() || owner.email)
    : 'Unbekannt'

  const memberRow = await c.env.DB
    .prepare('SELECT COUNT(*) AS n FROM org_members WHERE org_id = ? AND is_active = 1')
    .bind(org.id).first<{ n: number }>()

  return c.json({
    orgId:       org.id,
    orgName:     org.name,
    ownerName,
    memberCount: memberRow?.n ?? 1,
    expiresAt:   inv.expires_at,
  })
})

// ── POST /org/join — join by invite code (returns Organisation) ────────────────
org.post('/join', requireAuth, async (c) => {
  try {
    const userId = c.get('userId') as string
    const { code } = await c.req.json<{ code: string }>()
    if (!code) return c.json({ error: 'Code erforderlich.' }, 400)

    const now  = new Date().toISOString()
    const inv  = await c.env.DB
      .prepare('SELECT * FROM org_invite_codes WHERE code = ? AND (expires_at IS NULL OR expires_at > ?) AND (max_uses IS NULL OR used_count < max_uses)')
      .bind(code.trim().toUpperCase(), now).first<any>()
    if (!inv) return c.json({ error: 'Ungültiger oder abgelaufener Einladungs-Code.' }, 400)

    // Check not already an ACTIVE member of THIS org (inactive rows = previously left → reactivate, not block)
    const activeExisting = await c.env.DB
      .prepare('SELECT id FROM org_members WHERE user_id = ? AND org_id = ? AND is_active = 1')
      .bind(userId, inv.org_id).first()
    if (activeExisting) return c.json({ error: 'Du bist bereits in dieser Organisation.' }, 409)

    // Check if in another ACTIVE org
    const otherMember = await c.env.DB
      .prepare('SELECT id FROM org_members WHERE user_id = ? AND is_active = 1 LIMIT 1')
      .bind(userId).first()
    if (otherMember) return c.json({ error: 'Du bist bereits in einer anderen Organisation.' }, 409)

    // ── SLOT-CHECK ────────────────────────────────────────────────────────
    const slots = await getOrgMemberLimit(c.env.DB, inv.org_id)
    if (slots.current >= slots.limit) {
      return c.json({
        error: `Diese Organisation ist voll (${slots.current}/${slots.limit} Mitglieder). Der Inhaber muss ein größeres Paket buchen.`
      }, 409)
    }

    // Reaktivieren wenn alte inaktive Mitgliedschaft existiert, sonst neu anlegen
    const inactiveRow = await c.env.DB
      .prepare('SELECT id FROM org_members WHERE user_id = ? AND org_id = ? AND is_active = 0')
      .bind(userId, inv.org_id).first<{ id: number }>()
    if (inactiveRow) {
      await c.env.DB
        .prepare(`UPDATE org_members
                  SET is_active = 1,
                      role = 'Member',
                      joined_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
                  WHERE id = ?`)
        .bind(inactiveRow.id).run()
    } else {
      await c.env.DB
        .prepare(`INSERT INTO org_members (org_id, user_id, role, is_active, can_create_groups, can_invite_to_chats, can_use_recruitment)
                  VALUES (?, ?, 'Member', 1, 1, 1, 1)`)
        .bind(inv.org_id, userId).run()
    }

    // Archivierte Akten wieder aktivieren falls vorhanden
    await c.env.DB
      .prepare(`UPDATE employee_files SET is_archived = 0, archived_at = NULL
                WHERE subject_user_id = ? AND org_id = ? AND is_archived = 1`)
      .bind(userId, inv.org_id).run()

    await c.env.DB
      .prepare('UPDATE org_invite_codes SET used_count = used_count + 1 WHERE id = ?')
      .bind(inv.id).run()

    // Org-Object zurückgeben (matches iOS Organisation struct)
    const org = await c.env.DB
      .prepare('SELECT * FROM organisations WHERE id = ?')
      .bind(inv.org_id).first<any>()
    if (!org) return c.json({ error: 'Org nicht gefunden.' }, 500)

    const memberRow = await c.env.DB
      .prepare('SELECT COUNT(*) AS n FROM org_members WHERE org_id = ? AND is_active = 1')
      .bind(org.id).first<{ n: number }>()

    // ── Live-Update: Alle bestehenden Org-Mitglieder (außer dem Neuen) benachrichtigen ──
    try {
      const joinerRow = await c.env.DB
        .prepare('SELECT first_name, last_name, email FROM users WHERE id = ?')
        .bind(userId).first<any>()
      const joinerName = joinerRow
        ? `${joinerRow.first_name ?? ''} ${joinerRow.last_name ?? ''}`.trim() || joinerRow.email
        : 'Jemand'
      const existingMembers = await c.env.DB
        .prepare('SELECT user_id FROM org_members WHERE org_id = ? AND is_active = 1 AND user_id != ?')
        .bind(inv.org_id, userId).all<{ user_id: string }>()
      const notifStmt = c.env.DB.prepare(
        `INSERT INTO subscription_notifications (user_id, title, body, type, ref_id)
         VALUES (?, ?, ?, 'OrgMemberJoined', ?)`
      )
      const notifBatch = (existingMembers.results ?? []).map(m =>
        notifStmt.bind(m.user_id, 'Neues Mitglied', `${joinerName} ist der Organisation beigetreten.`, String(inv.org_id))
      )
      if (notifBatch.length > 0) {
        await c.env.DB.batch(notifBatch)
      }
    } catch (notifErr: any) {
      // Nicht-kritisch — Beitritt trotzdem erfolgreich
      console.warn('[POST /org/join] notification insert failed:', notifErr?.message)
    }

    return c.json({
      id:               org.id,
      name:             org.name,
      ownerId:          org.owner_id,
      logoUrl:          org.logo_url,
      activeExtensions: [],
      memberCount:      memberRow?.n ?? 1,
      createdAt:        org.created_at,
    })
  } catch (e: any) {
    console.error('[POST /org/join] failed:', e?.message ?? e, e?.stack)
    return c.json({ error: `Beitritt fehlgeschlagen: ${e?.message ?? 'unbekannt'}` }, 500)
  }
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

  // ── Stempelzeiten als Archiv konservieren ──────────────────────────────
  // Sichtbar für den User UND die Org. Die User-eigene Stempeluhr fängt damit
  // bei null wieder an (wenn er später neu beitritt oder wieder solo arbeitet).
  try {
    await archiveUserPunchEntries(c.env.DB, userId, 'org_leave', { orgIdFilter: member.org_id })
  } catch (e: any) {
    console.warn('[org/leave] punch archive failed:', e?.message ?? e)
  }

  // SICHERHEIT: Aus allen Org-Conversations entfernen damit der User keine
  // Org-Chats mehr sieht nach dem Verlassen
  await c.env.DB
    .prepare(`DELETE FROM conversation_members
              WHERE user_id = ? AND conversation_id IN
                (SELECT id FROM conversations WHERE org_id = ?)`)
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

  // Stempelzeiten des entfernten Users archivieren — bleibt für Org sichtbar
  // (Lohnabschluss-relevant) UND für den Ex-User in seinem Profil-Archiv.
  try {
    await archiveUserPunchEntries(c.env.DB, targetId, 'org_remove', { orgIdFilter: myMember.org_id })
  } catch (e: any) {
    console.warn('[org/members/remove] punch archive failed:', e?.message ?? e)
  }

  // SICHERHEIT: Aus allen Org-Conversations entfernen
  await c.env.DB
    .prepare(`DELETE FROM conversation_members
              WHERE user_id = ? AND conversation_id IN
                (SELECT id FROM conversations WHERE org_id = ?)`)
    .bind(targetId, myMember.org_id).run()

  await c.env.DB
    .prepare('UPDATE org_members SET is_active = 0 WHERE user_id = ? AND org_id = ?')
    .bind(targetId, myMember.org_id).run()

  return new Response(null, { status: 204 })
})

// ── PUT /org/members/:id/role ─────────────────────────────────────────────────
// Owner ändert Rolle eines Mitglieds. Returns updated OrgMember.
org.put('/members/:id/role', requireAuth, async (c) => {
  try {
    const userId = c.get('userId') as string
    const myMember = await c.env.DB
      .prepare("SELECT * FROM org_members WHERE user_id = ? AND is_active = 1 AND role = 'Owner' LIMIT 1")
      .bind(userId).first<any>()
    if (!myMember) return c.json({ error: 'Nur Owner kann Rollen vergeben.' }, 403)

    const { role } = await c.req.json<{ role: string }>().catch(() => ({ role: '' }))
    if (!['Admin', 'Member'].includes(role)) {
      return c.json({ error: 'Ungültige Rolle.' }, 400)
    }

    const memberId = c.req.param('id')
    await c.env.DB
      .prepare('UPDATE org_members SET role = ? WHERE id = ? AND org_id = ?')
      .bind(role, memberId, myMember.org_id).run()

    const m = await c.env.DB
      .prepare(`SELECT om.*, u.email, u.first_name, u.last_name, u.avatar_url
                FROM org_members om
                JOIN users u ON u.id = om.user_id
                WHERE om.id = ? AND om.org_id = ?`)
      .bind(memberId, myMember.org_id).first<any>()
    if (!m) return c.json({ error: 'Mitglied nicht gefunden.' }, 404)

    return c.json({
      id:          m.id,
      userId:      m.user_id,
      email:       m.email,
      displayName: (`${m.first_name ?? ''} ${m.last_name ?? ''}`.trim()) || m.email,
      avatarUrl:   m.avatar_url,
      orgRole:     m.role,
      joinedAt:    m.joined_at,
      isActive:    m.is_active === 1,
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
    })
  } catch (e: any) {
    console.error('[PUT /org/members/:id/role]', e?.message ?? e)
    return c.json({ error: `Rolle konnte nicht gespeichert werden: ${e?.message ?? 'unbekannt'}` }, 500)
  }
})

// ── PUT /org/members/:id/permissions ─────────────────────────────────────────
// iOS sendet { permissions: { canManageMembers, canCreateGroups, ... } } und
// erwartet das aktualisierte OrgMember-Objekt zurück.
org.put('/members/:id/permissions', requireAuth, async (c) => {
  try {
    const userId = c.get('userId') as string
    const myMember = await c.env.DB
      .prepare("SELECT * FROM org_members WHERE user_id = ? AND is_active = 1 AND role = 'Owner' LIMIT 1")
      .bind(userId).first<any>()
    if (!myMember) return c.json({ error: 'Nur Owner kann Berechtigungen ändern.' }, 403)

    // Body kann entweder { permissions: {...} } (iOS) ODER flat {...} sein
    const raw = await c.req.json<any>().catch(() => ({}))
    const p: Record<string, boolean> = (raw?.permissions ?? raw) ?? {}

    // camelCase → snake_case Feld-Mapping (das iOS sendet camelCase Keys)
    const fieldMap: Array<[string, string]> = [
      ['canManageMembers',          'can_manage_members'],
      ['canManageInviteCodes',      'can_manage_invite_codes'],
      ['canCreateGroups',           'can_create_groups'],
      ['canManageFiles',            'can_manage_files'],
      ['canInviteToChats',          'can_invite_to_chats'],
      ['canUseMoreSpace',           'can_use_more_space'],
      ['canViewSalaries',           'can_view_salaries'],
      ['canManageEmployeeProfiles', 'can_manage_employee_profiles'],
      ['canManageOrgStructure',     'can_manage_org_structure'],
      ['canUseRecruitment',         'can_use_recruitment'],
      ['canManageRecruitment',      'can_manage_recruitment'],
    ]

    const sets = fieldMap.map(([_, col]) => `${col} = ?`).join(', ')
    const vals = fieldMap.map(([camel, _]) => p[camel] ? 1 : 0)

    const memberId = c.req.param('id')
    await c.env.DB
      .prepare(`UPDATE org_members SET ${sets} WHERE id = ? AND org_id = ?`)
      .bind(...vals, memberId, myMember.org_id).run()

    // Aktualisiertes OrgMember zurückgeben — iOS erwartet das
    const m = await c.env.DB
      .prepare(`SELECT om.*, u.email, u.first_name, u.last_name, u.avatar_url
                FROM org_members om
                JOIN users u ON u.id = om.user_id
                WHERE om.id = ? AND om.org_id = ?`)
      .bind(memberId, myMember.org_id).first<any>()
    if (!m) return c.json({ error: 'Mitglied nicht gefunden.' }, 404)

    return c.json({
      id:          m.id,
      userId:      m.user_id,
      email:       m.email,
      displayName: (`${m.first_name ?? ''} ${m.last_name ?? ''}`.trim()) || m.email,
      avatarUrl:   m.avatar_url,
      orgRole:     m.role,
      joinedAt:    m.joined_at,
      isActive:    m.is_active === 1,
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
    })
  } catch (e: any) {
    console.error('[PUT /org/members/:id/permissions]', e?.message ?? e)
    return c.json({ error: `Berechtigungen konnten nicht gespeichert werden: ${e?.message ?? 'unbekannt'}` }, 500)
  }
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
