// ── Admin Routes — /api/v1/admin (Staff only) ─────────────────────────────────
// Mirrors all features from the legacy ASP.NET admin: users, orgs, licenses,
// grants, notifications, orders, legal-page editing.

import { Hono }                       from 'hono'
import type { Env, AppEnv } from '../types'
import { requireStaff }               from '../middleware/auth'
import {
  sendEmail,
  verifyEmailHtml, verifyEmailText,
  welcomeEmailHtml, welcomeEmailText,
  changeEmailHtml,  changeEmailText,
  purchaseConfirmationHtml, purchaseConfirmationText,
  subscriptionExpiringSoonHtml, subscriptionExpiringSoonText,
  subscriptionEndedHtml,        subscriptionEndedText,
} from '../utils/email'

const admin = new Hono<AppEnv>()
admin.use('*', requireStaff)

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildAdminUserDetail(row: any) {
  let activeExtensions: string[] = []
  try {
    if (row.active_extensions) activeExtensions = JSON.parse(row.active_extensions)
  } catch {}
  return {
    id:               row.id,
    email:            row.email,
    displayName:      `${row.first_name ?? ''} ${row.last_name ?? ''}`.trim() || row.email,
    accountType:      row.account_type ?? 'Private',
    appRole:          row.app_role ?? null,
    orgId:            row.org_id ?? null,
    orgRole:          row.org_role ?? null,
    activeExtensions,
    registeredAt:     row.registered_at,
    lastLoginAt:      row.last_login_at ?? null,
    isBlocked:        (row.is_blocked ?? 0) === 1,
    emailConfirmed:   (row.email_confirmed ?? 0) === 1,
  }
}

function buildAdminOrgDetail(row: any) {
  let activeExtensions: string[] = []
  try {
    if (row.active_extensions) activeExtensions = JSON.parse(row.active_extensions)
  } catch {}
  return {
    id:           row.id,
    name:         row.name,
    ownerEmail:   row.owner_email ?? null,
    memberCount:  row.member_count ?? 0,
    activeExtensions,
    createdAt:    row.created_at,
    isActive:     true,
  }
}

function buildAdminLicenseDetail(row: any) {
  return {
    id:              row.id,
    userId:          row.user_id,
    userEmail:       row.user_email,
    userDisplayName: `${row.first_name ?? ''} ${row.last_name ?? ''}`.trim() || row.user_email,
    product:         row.product,
    grantedVia:      row.granted_via,
    isActive:        (row.is_active ?? 0) === 1,
    purchasedAt:     row.purchased_at,
    expiresAt:       row.expires_at,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. Stats / Dashboard
// ═══════════════════════════════════════════════════════════════════════════

admin.get('/stats', async (c) => {
  const db = c.env.DB

  const [totalU, activeU, totalO, mrrR, extRows, newU, newO] = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS n FROM users`).first<{ n: number }>(),
    db.prepare(`SELECT COUNT(*) AS n FROM users
                WHERE last_login_at >= strftime('%Y-%m-%dT%H:%M:%SZ','now','-30 days')`)
      .first<{ n: number }>(),
    db.prepare(`SELECT COUNT(*) AS n FROM organisations`).first<{ n: number }>(),
    db.prepare(`SELECT COALESCE(SUM(p.base_price), 0) AS mrr
                FROM user_extensions ue
                INNER JOIN products p ON p.slug = ue.product
                WHERE ue.is_active = 1 AND p.is_subscription = 1
                  AND (ue.expires_at IS NULL OR ue.expires_at > strftime('%Y-%m-%dT%H:%M:%SZ','now'))`)
      .first<{ mrr: number }>(),
    db.prepare(`SELECT product, COUNT(*) AS n FROM user_extensions
                WHERE is_active = 1 GROUP BY product`).all<any>(),
    db.prepare(`SELECT COUNT(*) AS n FROM users
                WHERE registered_at >= strftime('%Y-%m-01T00:00:00Z','now')`)
      .first<{ n: number }>(),
    db.prepare(`SELECT COUNT(*) AS n FROM organisations
                WHERE created_at >= strftime('%Y-%m-01T00:00:00Z','now')`)
      .first<{ n: number }>(),
  ])

  const extensionBreakdown: Record<string, number> = {}
  for (const r of extRows.results ?? []) extensionBreakdown[r.product] = r.n

  const mrrFormatted = new Intl.NumberFormat('de-DE', {
    style: 'currency', currency: 'EUR'
  }).format(mrrR?.mrr ?? 0)

  return c.json({
    totalUsers:           totalU?.n ?? 0,
    activeUsers30Days:    activeU?.n ?? 0,
    totalOrgs:            totalO?.n ?? 0,
    mrrFormatted,
    extensionBreakdown,
    newUsersThisMonth:    newU?.n ?? 0,
    newOrgsThisMonth:     newO?.n ?? 0,
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 2. Users
// ═══════════════════════════════════════════════════════════════════════════

admin.get('/users', async (c) => {
  const pageSize = Math.min(500, parseInt(c.req.query('pageSize') ?? '200'))
  const page     = Math.max(1, parseInt(c.req.query('page') ?? '1'))
  const offset   = (page - 1) * pageSize
  const search   = c.req.query('q') ?? c.req.query('search') ?? ''

  let where = ''
  const binds: any[] = []
  if (search) {
    where = `WHERE (u.email LIKE ? OR u.first_name LIKE ? OR u.last_name LIKE ?)`
    binds.push(`%${search}%`, `%${search}%`, `%${search}%`)
  }

  const totalRow = await c.env.DB
    .prepare(`SELECT COUNT(*) AS n FROM users u ${where}`)
    .bind(...binds).first<{ n: number }>()

  const rows = await c.env.DB.prepare(`
    SELECT u.*, om.org_id, om.role AS org_role,
      (SELECT json_group_array(product) FROM user_extensions
       WHERE user_id = u.id AND is_active = 1) AS active_extensions
    FROM users u
    LEFT JOIN org_members om ON om.user_id = u.id AND om.is_active = 1
    ${where}
    ORDER BY u.registered_at DESC
    LIMIT ? OFFSET ?
  `).bind(...binds, pageSize, offset).all<any>()

  return c.json({
    items:      (rows.results ?? []).map(buildAdminUserDetail),
    totalCount: totalRow?.n ?? 0,
    page, pageSize,
  })
})

admin.get('/users/:id', async (c) => {
  const id = c.req.param('id')
  const row = await c.env.DB.prepare(`
    SELECT u.*, om.org_id, om.role AS org_role,
      (SELECT json_group_array(product) FROM user_extensions
       WHERE user_id = u.id AND is_active = 1) AS active_extensions
    FROM users u
    LEFT JOIN org_members om ON om.user_id = u.id AND om.is_active = 1
    WHERE u.id = ?
  `).bind(id).first<any>()
  if (!row) return c.json({ error: 'User nicht gefunden.' }, 404)
  return c.json(buildAdminUserDetail(row))
})

/** GET /admin/users/:id/full — User-Detail mit Extensions, Grants, Notifications, Orders */
admin.get('/users/:id/full', async (c) => {
  const id = c.req.param('id')

  const userRow = await c.env.DB.prepare(`
    SELECT u.*, om.org_id, om.role AS org_role,
      (SELECT json_group_array(product) FROM user_extensions
       WHERE user_id = u.id AND is_active = 1) AS active_extensions
    FROM users u
    LEFT JOIN org_members om ON om.user_id = u.id AND om.is_active = 1
    WHERE u.id = ?
  `).bind(id).first<any>()
  if (!userRow) return c.json({ error: 'User nicht gefunden.' }, 404)

  const [exts, grants, notifs, orders] = await Promise.all([
    c.env.DB.prepare(`SELECT * FROM user_extensions WHERE user_id = ? ORDER BY purchased_at DESC`)
      .bind(id).all<any>(),
    c.env.DB.prepare(`SELECT * FROM managed_grants WHERE user_id = ? ORDER BY granted_at DESC`)
      .bind(id).all<any>(),
    c.env.DB.prepare(`SELECT * FROM subscription_notifications WHERE user_id = ?
                      ORDER BY created_at DESC LIMIT 50`).bind(id).all<any>(),
    c.env.DB.prepare(`SELECT * FROM orders WHERE user_id = ? ORDER BY purchased_at DESC LIMIT 50`)
      .bind(id).all<any>(),
  ])

  return c.json({
    user:          buildAdminUserDetail(userRow),
    extensions:    exts.results ?? [],
    managedGrants: grants.results ?? [],
    notifications: notifs.results ?? [],
    orders:        orders.results ?? [],
  })
})

admin.delete('/users/:id', async (c) => {
  const id = c.req.param('id')
  const exists = await c.env.DB.prepare(`SELECT id FROM users WHERE id = ?`).bind(id).first()
  if (!exists) return c.json({ error: 'User nicht gefunden.' }, 404)
  // ON DELETE CASCADE in schema kümmert sich um den Rest
  await c.env.DB.prepare(`DELETE FROM users WHERE id = ?`).bind(id).run()
  return c.json({ ok: true })
})

admin.post('/users/:id/block', async (c) => {
  const id     = c.req.param('id')
  const action = c.req.query('action') ?? 'block'
  if (!['block', 'unblock'].includes(action))
    return c.json({ error: 'action muss block oder unblock sein.' }, 400)

  const u = await c.env.DB.prepare(`SELECT id FROM users WHERE id = ?`).bind(id).first()
  if (!u) return c.json({ error: 'User nicht gefunden.' }, 404)

  await c.env.DB.prepare(`UPDATE users SET is_blocked = ? WHERE id = ?`)
    .bind(action === 'block' ? 1 : 0, id).run()
  return c.json({ ok: true, isBlocked: action === 'block' })
})

/** POST /admin/users/:id/grant — Extension manuell vergeben (kostenlos, ohne IAP) */
admin.post('/users/:id/grant', async (c) => {
  const adminId = c.get('userId') as string
  const userId  = c.req.param('id')
  const { product, note } = await c.req.json<{ product: string; note?: string }>()
  if (!product) return c.json({ error: 'product ist Pflicht.' }, 400)

  const u = await c.env.DB.prepare(`SELECT id FROM users WHERE id = ?`).bind(userId).first()
  if (!u) return c.json({ error: 'User nicht gefunden.' }, 404)

  const p = await c.env.DB.prepare(`SELECT slug FROM products WHERE slug = ? AND is_active = 1`)
    .bind(product).first()
  if (!p) return c.json({ error: 'Produkt nicht gefunden.' }, 404)

  // Active-Extension hinzufügen oder reaktivieren
  const existing = await c.env.DB
    .prepare(`SELECT id FROM user_extensions WHERE user_id = ? AND product = ?`)
    .bind(userId, product).first<any>()

  if (existing) {
    await c.env.DB.prepare(`
      UPDATE user_extensions SET is_active = 1, granted_via = 'OrgMembership',
        expires_at = NULL, purchased_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`)
      .bind(existing.id).run()
  } else {
    await c.env.DB.prepare(`
      INSERT INTO user_extensions (user_id, product, granted_via, is_active)
      VALUES (?, ?, 'OrgMembership', 1)`).bind(userId, product).run()
  }

  // Audit-Eintrag in managed_grants
  await c.env.DB.prepare(`
    INSERT INTO managed_grants (user_id, product, granted_by, note)
    VALUES (?, ?, ?, ?)`)
    .bind(userId, product, adminId, note ?? null).run()

  return c.json({ ok: true })
})

/** POST /admin/users/:id/grant-trial — Trial-Verlängerung */
admin.post('/users/:id/grant-trial', async (c) => {
  const adminId = c.get('userId') as string
  const userId  = c.req.param('id')
  const { product, days, note } = await c.req.json<{ product: string; days: number; note?: string }>()
  if (!product || !days || days < 1 || days > 365)
    return c.json({ error: 'product + days (1..365) sind Pflicht.' }, 400)

  const expiresAt = new Date(Date.now() + days * 86400_000).toISOString()

  const existing = await c.env.DB
    .prepare(`SELECT id FROM user_extensions WHERE user_id = ? AND product = ?`)
    .bind(userId, product).first<any>()

  if (existing) {
    await c.env.DB.prepare(`
      UPDATE user_extensions SET is_active = 1, granted_via = 'OrgMembership',
        expires_at = ?, purchased_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`)
      .bind(expiresAt, existing.id).run()
  } else {
    await c.env.DB.prepare(`
      INSERT INTO user_extensions (user_id, product, granted_via, is_active, expires_at)
      VALUES (?, ?, 'OrgMembership', 1, ?)`).bind(userId, product, expiresAt).run()
  }

  await c.env.DB.prepare(`
    INSERT INTO managed_grants (user_id, product, granted_by, note)
    VALUES (?, ?, ?, ?)`)
    .bind(userId, product, adminId, `[Trial ${days}d] ${note ?? ''}`.trim()).run()

  return c.json({ ok: true, expiresAt })
})

/** POST /admin/users/:id/notify — In-App-Notification senden */
admin.post('/users/:id/notify', async (c) => {
  const userId = c.req.param('id')
  const { title, body, type, refId } = await c.req.json<{
    title: string; body?: string; type?: string; refId?: string
  }>()
  if (!title) return c.json({ error: 'title ist Pflicht.' }, 400)

  await c.env.DB.prepare(`
    INSERT INTO subscription_notifications (user_id, title, body, type, ref_id)
    VALUES (?, ?, ?, ?, ?)`)
    .bind(userId, title, body ?? null, type ?? 'admin', refId ?? null).run()

  return c.json({ ok: true })
})

// ═══════════════════════════════════════════════════════════════════════════
// 2.5 SuperAdmin Promotion — only with Master-Key
// ═══════════════════════════════════════════════════════════════════════════

const MASTER_KEY = '1362'   // Hardcoded — known by founder only

/** POST /admin/promote-superadmin — anderen User zum SuperAdmin machen */
admin.post('/promote-superadmin', async (c) => {
  const adminId = c.get('userId') as string
  const adminUser = c.get('userRow') as any

  // Nur SuperAdmin (nicht Staff) darf andere SuperAdmins erstellen
  if (adminUser.app_role !== 'SuperAdmin') {
    return c.json({ error: 'Nur SuperAdmins dürfen andere SuperAdmins erstellen.' }, 403)
  }

  const { userEmail, masterKey, role } = await c.req.json<{
    userEmail: string
    masterKey: string
    role?: string   // 'SuperAdmin' | 'Staff'
  }>()

  if (!userEmail?.trim() || !masterKey?.trim()) {
    return c.json({ error: 'E-Mail und Master-Key sind Pflicht.' }, 400)
  }

  if (masterKey !== MASTER_KEY) {
    // Audit-Eintrag bei falschem Master-Key
    await c.env.DB.prepare(`
      INSERT INTO subscription_notifications (user_id, title, body, type)
      VALUES (?, ?, ?, ?)`)
      .bind(adminId,
            'Falscher Master-Key',
            `Versuchter SuperAdmin-Promote für ${userEmail.trim()} mit falschem Master-Key.`,
            'security_alert').run()
    return c.json({ error: 'Master-Key ungültig.' }, 403)
  }

  // Target-User finden
  const target = await c.env.DB
    .prepare(`SELECT * FROM users WHERE email_normalized = ?`)
    .bind(userEmail.trim().toUpperCase())
    .first<any>()

  if (!target) {
    return c.json({ error: 'Nutzer mit dieser E-Mail nicht gefunden.' }, 404)
  }

  const newRole = (role === 'Staff') ? 'Staff' : 'SuperAdmin'

  await c.env.DB
    .prepare(`UPDATE users SET app_role = ? WHERE id = ?`)
    .bind(newRole, target.id).run()

  // Audit-Log
  await c.env.DB.prepare(`
    INSERT INTO managed_grants (user_id, product, granted_by, note)
    VALUES (?, ?, ?, ?)`)
    .bind(target.id, `ROLE:${newRole}`, adminId, `Promoted to ${newRole} via Master-Key`).run()

  // Benachrichtigung an Promoted-User
  await c.env.DB.prepare(`
    INSERT INTO subscription_notifications (user_id, title, body, type)
    VALUES (?, ?, ?, ?)`)
    .bind(target.id,
          `Du bist jetzt ${newRole}`,
          `Du wurdest zum CustoSoft ${newRole} ernannt. Du hast jetzt Zugriff auf das Admin-Backend.`,
          'role_change').run()

  return c.json({
    ok:        true,
    userId:    target.id,
    email:     target.email,
    newRole,
    promotedBy: adminUser.email,
  })
})

/** POST /admin/demote-superadmin — SuperAdmin-Rechte entziehen */
admin.post('/demote-superadmin', async (c) => {
  const adminUser = c.get('userRow') as any
  if (adminUser.app_role !== 'SuperAdmin') {
    return c.json({ error: 'Nur SuperAdmins dürfen das.' }, 403)
  }

  const { userId, masterKey } = await c.req.json<{ userId: string; masterKey: string }>()
  if (!userId || masterKey !== MASTER_KEY) {
    return c.json({ error: 'Master-Key ungültig oder userId fehlt.' }, 403)
  }

  // Verhindere Selbst-Demotion (sonst sperrt sich der letzte SuperAdmin aus)
  if (userId === adminUser.id) {
    return c.json({ error: 'Du kannst dich nicht selbst entferden. Bitte einen anderen SuperAdmin tun lassen.' }, 400)
  }

  await c.env.DB
    .prepare(`UPDATE users SET app_role = NULL WHERE id = ?`)
    .bind(userId).run()

  return c.json({ ok: true })
})

/** GET /admin/staff-list — Liste aller SuperAdmins/Staff */
admin.get('/staff-list', async (c) => {
  const rows = await c.env.DB
    .prepare(`SELECT id, email, first_name, last_name, app_role, registered_at, last_login_at
              FROM users WHERE app_role IS NOT NULL
              ORDER BY app_role, registered_at`)
    .all<any>()

  return c.json({
    items: (rows.results ?? []).map(u => ({
      id:          u.id,
      email:       u.email,
      displayName: `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim() || u.email,
      role:        u.app_role,
      registeredAt: u.registered_at,
      lastLoginAt:  u.last_login_at,
    })),
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 3. Organisations
// ═══════════════════════════════════════════════════════════════════════════

admin.get('/orgs', async (c) => {
  const pageSize = Math.min(500, parseInt(c.req.query('pageSize') ?? '200'))
  const page     = Math.max(1, parseInt(c.req.query('page') ?? '1'))
  const offset   = (page - 1) * pageSize

  const totalRow = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM organisations`).first<{ n: number }>()

  const rows = await c.env.DB.prepare(`
    SELECT o.*, owner.email AS owner_email,
      (SELECT COUNT(*) FROM org_members om WHERE om.org_id = o.id AND om.is_active = 1) AS member_count,
      (SELECT json_group_array(DISTINCT ue.product)
       FROM org_members om2
       INNER JOIN user_extensions ue ON ue.user_id = om2.user_id AND ue.is_active = 1
       WHERE om2.org_id = o.id) AS active_extensions
    FROM organisations o
    LEFT JOIN users owner ON owner.id = o.owner_id
    ORDER BY o.created_at DESC
    LIMIT ? OFFSET ?
  `).bind(pageSize, offset).all<any>()

  return c.json({
    items:      (rows.results ?? []).map(buildAdminOrgDetail),
    totalCount: totalRow?.n ?? 0,
    page, pageSize,
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 4. Licenses (User Extensions)
// ═══════════════════════════════════════════════════════════════════════════

admin.get('/licenses', async (c) => {
  const pageSize = Math.min(500, parseInt(c.req.query('pageSize') ?? '200'))
  const page     = Math.max(1, parseInt(c.req.query('page') ?? '1'))
  const offset   = (page - 1) * pageSize
  const filter   = c.req.query('filter') ?? 'all'   // 'active' | 'expired' | 'all'

  let where = ''
  if (filter === 'active') where = `WHERE ue.is_active = 1 AND (ue.expires_at IS NULL OR ue.expires_at > strftime('%Y-%m-%dT%H:%M:%SZ','now'))`
  if (filter === 'expired') where = `WHERE ue.is_active = 0 OR ue.expires_at <= strftime('%Y-%m-%dT%H:%M:%SZ','now')`

  const totalRow = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM user_extensions ue ${where}`)
    .first<{ n: number }>()

  const rows = await c.env.DB.prepare(`
    SELECT ue.*, u.email AS user_email, u.first_name, u.last_name
    FROM user_extensions ue
    INNER JOIN users u ON u.id = ue.user_id
    ${where}
    ORDER BY ue.purchased_at DESC
    LIMIT ? OFFSET ?
  `).bind(pageSize, offset).all<any>()

  return c.json({
    items:      (rows.results ?? []).map(buildAdminLicenseDetail),
    totalCount: totalRow?.n ?? 0,
    page, pageSize,
  })
})

admin.delete('/licenses/:id/revoke', async (c) => {
  const id = c.req.param('id')
  const ext = await c.env.DB.prepare(`SELECT id FROM user_extensions WHERE id = ?`).bind(id).first()
  if (!ext) return c.json({ error: 'Lizenz nicht gefunden.' }, 404)
  await c.env.DB.prepare(`UPDATE user_extensions SET is_active = 0 WHERE id = ?`).bind(id).run()
  return c.json({ ok: true })
})

admin.post('/licenses/grant', async (c) => {
  const adminId = c.get('userId') as string
  const { userEmail, product } = await c.req.json<{ userEmail: string; product: string }>()
  if (!userEmail || !product) return c.json({ error: 'userEmail + product sind Pflicht.' }, 400)

  const u = await c.env.DB
    .prepare(`SELECT id FROM users WHERE email_normalized = ?`)
    .bind(userEmail.trim().toUpperCase()).first<any>()
  if (!u) return c.json({ error: 'User nicht gefunden.' }, 404)

  // Nur aktive (verkaufbare) Produkte erlaubt
  const p = await c.env.DB.prepare(`SELECT slug FROM products WHERE slug = ? AND is_active = 1`)
    .bind(product).first()
  if (!p) return c.json({ error: `Produkt "${product}" ist nicht aktiv oder existiert nicht.` }, 400)

  const existing = await c.env.DB
    .prepare(`SELECT id FROM user_extensions WHERE user_id = ? AND product = ?`)
    .bind(u.id, product).first<any>()

  if (existing) {
    await c.env.DB.prepare(`
      UPDATE user_extensions SET is_active = 1, granted_via = 'OrgMembership',
        expires_at = NULL, purchased_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
      WHERE id = ?`).bind(existing.id).run()
  } else {
    await c.env.DB.prepare(`
      INSERT INTO user_extensions (user_id, product, granted_via, is_active)
      VALUES (?, ?, 'OrgMembership', 1)`).bind(u.id, product).run()
  }

  await c.env.DB.prepare(`
    INSERT INTO managed_grants (user_id, product, granted_by, note)
    VALUES (?, ?, ?, 'Direkt-Vergabe')`).bind(u.id, product, adminId).run()

  return c.json({ ok: true }, 201)
})

// ═══════════════════════════════════════════════════════════════════════════
// 5. Managed Grants
// ═══════════════════════════════════════════════════════════════════════════

admin.get('/grants', async (c) => {
  const rows = await c.env.DB.prepare(`
    SELECT mg.*, u.email AS user_email, u.first_name, u.last_name
    FROM managed_grants mg
    INNER JOIN users u ON u.id = mg.user_id
    ORDER BY mg.granted_at DESC LIMIT 200
  `).all<any>()
  return c.json({
    items: (rows.results ?? []).map(g => ({
      id: g.id, userId: g.user_id, userEmail: g.user_email,
      userDisplayName: `${g.first_name ?? ''} ${g.last_name ?? ''}`.trim() || g.user_email,
      product: g.product, grantedBy: g.granted_by, grantedAt: g.granted_at, note: g.note,
    })),
  })
})

admin.delete('/grants/:id', async (c) => {
  const id = c.req.param('id')
  const grant = await c.env.DB.prepare(`SELECT * FROM managed_grants WHERE id = ?`)
    .bind(id).first<any>()
  if (!grant) return c.json({ error: 'Grant nicht gefunden.' }, 404)
  // Extension auch deaktivieren
  await c.env.DB.prepare(`
    UPDATE user_extensions SET is_active = 0
    WHERE user_id = ? AND product = ? AND granted_via = 'OrgMembership'`)
    .bind(grant.user_id, grant.product).run()
  await c.env.DB.prepare(`DELETE FROM managed_grants WHERE id = ?`).bind(id).run()
  return c.json({ ok: true })
})

// ═══════════════════════════════════════════════════════════════════════════
// 6. Orders (read-only — Apple verwaltet Refunds)
// ═══════════════════════════════════════════════════════════════════════════

admin.get('/orders', async (c) => {
  const pageSize = Math.min(500, parseInt(c.req.query('pageSize') ?? '200'))
  const page     = Math.max(1, parseInt(c.req.query('page') ?? '1'))
  const offset   = (page - 1) * pageSize

  const rows = await c.env.DB.prepare(`
    SELECT o.*, u.email AS user_email
    FROM orders o
    INNER JOIN users u ON u.id = o.user_id
    ORDER BY o.purchased_at DESC LIMIT ? OFFSET ?
  `).bind(pageSize, offset).all<any>()

  const totalRow = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM orders`).first<{ n: number }>()

  return c.json({
    items: (rows.results ?? []).map(o => ({
      id:           o.id, userId: o.user_id, userEmail: o.user_email,
      productName:  o.product_name, pricePaid: o.price_paid,
      purchasedAt:  o.purchased_at, status: o.status,
      notes:        o.notes ?? null,
      upgradedFrom: o.upgraded_from ?? null,
    })),
    totalCount: totalRow?.n ?? 0,
    page, pageSize,
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 7. Notifications (history)
// ═══════════════════════════════════════════════════════════════════════════

admin.get('/notifications', async (c) => {
  const pageSize = Math.min(500, parseInt(c.req.query('pageSize') ?? '100'))
  const page     = Math.max(1, parseInt(c.req.query('page') ?? '1'))
  const offset   = (page - 1) * pageSize

  const rows = await c.env.DB.prepare(`
    SELECT sn.*, u.email AS user_email
    FROM subscription_notifications sn
    INNER JOIN users u ON u.id = sn.user_id
    ORDER BY sn.created_at DESC LIMIT ? OFFSET ?
  `).bind(pageSize, offset).all<any>()

  return c.json({
    items: (rows.results ?? []).map(n => ({
      id: n.id, userId: n.user_id, userEmail: n.user_email,
      title: n.title, body: n.body, type: n.type, refId: n.ref_id,
      isRead: n.is_read === 1, createdAt: n.created_at,
    })),
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 8. Legal Pages (Datenschutz, AGB, Impressum) — REQUIRED by Apple
// ═══════════════════════════════════════════════════════════════════════════

// All endpoints accept an optional `locale` query/body parameter. When
// missing it defaults to 'de' so old admin UIs keep working unchanged.

admin.get('/legal', async (c) => {
  // Returns every (slug, locale) pair — admin UI can group by slug.
  const rows = await c.env.DB.prepare(
    `SELECT * FROM legal_pages ORDER BY slug, locale`
  ).all<any>()
  return c.json({
    items: (rows.results ?? []).map(p => ({
      id: p.id, slug: p.slug, locale: p.locale ?? 'de', title: p.title,
      content: p.content, updatedAt: p.updated_at,
    })),
  })
})

admin.get('/legal/:slug', async (c) => {
  const slug = c.req.param('slug')
  const locale = c.req.query('locale') ?? 'de'
  // Try locale-aware lookup first; fall back to legacy schema (slug-only).
  let row: any = null
  try {
    row = await c.env.DB
      .prepare(`SELECT * FROM legal_pages WHERE slug = ? AND locale = ?`)
      .bind(slug, locale).first<any>()
  } catch { /* old schema */ }
  if (!row && locale === 'de') {
    row = await c.env.DB.prepare(`SELECT * FROM legal_pages WHERE slug = ?`)
      .bind(slug).first<any>()
  }
  if (!row) return c.json({ error: 'Legal-Seite nicht gefunden.' }, 404)
  return c.json({
    id: row.id, slug: row.slug, locale: row.locale ?? 'de', title: row.title,
    content: row.content, updatedAt: row.updated_at,
  })
})

admin.put('/legal/:slug', async (c) => {
  const slug = c.req.param('slug')
  const body = await c.req.json<{ title?: string; content: string; locale?: string }>()
  const { title, content } = body
  const locale = body.locale ?? c.req.query('locale') ?? 'de'
  if (!content) return c.json({ error: 'content ist Pflicht.' }, 400)

  // Try the new (slug, locale) shape; fall back to legacy slug-only.
  try {
    const exists = await c.env.DB
      .prepare(`SELECT id FROM legal_pages WHERE slug = ? AND locale = ?`)
      .bind(slug, locale).first()
    if (exists) {
      await c.env.DB.prepare(`
        UPDATE legal_pages SET title = ?, content = ?,
          updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
        WHERE slug = ? AND locale = ?`)
        .bind(title ?? slug, content, slug, locale).run()
    } else {
      await c.env.DB.prepare(`
        INSERT INTO legal_pages (slug, locale, title, content)
        VALUES (?, ?, ?, ?)`)
        .bind(slug, locale, title ?? slug, content).run()
    }
    return c.json({ ok: true })
  } catch {
    // Old schema (no locale column) — fall back, German only.
    if (locale !== 'de') {
      return c.json({
        error: 'Multi-locale storage requires the legal_pages migration. Run scripts/update_legal_pages_locale.sql.',
      }, 500)
    }
    const exists = await c.env.DB.prepare(`SELECT id FROM legal_pages WHERE slug = ?`)
      .bind(slug).first()
    if (exists) {
      await c.env.DB.prepare(`
        UPDATE legal_pages SET title = ?, content = ?,
          updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE slug = ?`)
        .bind(title ?? slug, content, slug).run()
    } else {
      await c.env.DB.prepare(`
        INSERT INTO legal_pages (slug, title, content) VALUES (?, ?, ?)`)
        .bind(slug, title ?? slug, content).run()
    }
    return c.json({ ok: true })
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// 9. Mail-System (Logs · Vorlagen · Manueller Versand)
// ═══════════════════════════════════════════════════════════════════════════

/// Default-Templates aus utils/email.ts — werden im Admin-UI angezeigt wenn
/// kein DB-Override existiert. Schlüssel müssen mit den `templateKey`-Werten
/// in den Auth/Punch/etc.-Routes übereinstimmen die `sendEmail` aufrufen.
const DEFAULT_TEMPLATE_KEYS = [
  { key: 'verifyEmail',     name: 'E-Mail-Bestätigung',         vars: '{{name}}, {{code}}' },
  { key: 'welcome',         name: 'Willkommen',                  vars: '{{name}}' },
  { key: 'passwordReset',   name: 'Passwort-Reset',              vars: '{{name}}, {{code}}' },
  { key: 'changeEmail',     name: 'E-Mail-Änderung bestätigen',  vars: '{{name}}, {{newEmail}}, {{code}}' },
  { key: 'purchase',        name: 'Kauf-Bestätigung',            vars: '{{name}}, {{productName}}, {{price}}' },
  { key: 'expiringSoon',    name: 'Abo läuft bald ab',           vars: '{{name}}, {{productName}}, {{daysRemaining}}' },
  { key: 'subscriptionEnded', name: 'Abo beendet',               vars: '{{name}}, {{productName}}' },
  { key: 'manual',          name: 'Manuelle Nachricht (Admin)',  vars: 'frei' },
]

admin.get('/mail-logs', async (c) => {
  const limit = Math.min(500, parseInt(c.req.query('limit') ?? '100'))
  const status = c.req.query('status')   // 'sent' | 'failed' | undefined
  const search = c.req.query('q')        // Filter auf to_email / subject

  let q = `SELECT * FROM mail_logs WHERE 1=1`
  const binds: any[] = []
  if (status === 'sent' || status === 'failed') {
    q += ` AND status = ?`; binds.push(status)
  }
  if (search) {
    q += ` AND (to_email LIKE ? OR subject LIKE ? OR template_key LIKE ?)`
    const pat = `%${search}%`
    binds.push(pat, pat, pat)
  }
  q += ` ORDER BY sent_at DESC LIMIT ?`
  binds.push(limit)

  try {
    const rows = await c.env.DB.prepare(q).bind(...binds).all<any>()
    return c.json({ items: rows.results ?? [] })
  } catch {
    return c.json({ items: [], note: 'mail_logs table missing — run scripts/create_mail_tables.sql' })
  }
})

admin.get('/mail-templates', async (c) => {
  // Liste aller Templates: hardcoded Defaults + welche davon DB-Override haben
  let overrides: any[] = []
  try {
    const rows = await c.env.DB.prepare(
      `SELECT template_key, subject, updated_at, updated_by FROM mail_templates`
    ).all<any>()
    overrides = rows.results ?? []
  } catch { /* table missing */ }
  const overrideMap: Record<string, any> = {}
  for (const o of overrides) overrideMap[o.template_key] = o

  return c.json({
    items: DEFAULT_TEMPLATE_KEYS.map(t => ({
      key:        t.key,
      name:       t.name,
      placeholders: t.vars,
      hasOverride: !!overrideMap[t.key],
      subjectOverride: overrideMap[t.key]?.subject ?? null,
      updatedAt:  overrideMap[t.key]?.updated_at ?? null,
      updatedBy:  overrideMap[t.key]?.updated_by ?? null,
    })),
  })
})

admin.get('/mail-templates/:key', async (c) => {
  const key = c.req.param('key')
  const meta = DEFAULT_TEMPLATE_KEYS.find(t => t.key === key)
  if (!meta) return c.json({ error: 'Unbekannte Vorlage.' }, 404)

  // Default-Inhalte holen — wir importieren die Helfer aus utils/email
  const def = renderDefaultTemplate(key)

  let override: any = null
  try {
    override = await c.env.DB
      .prepare(`SELECT subject, html, text, updated_at, updated_by
                FROM mail_templates WHERE template_key = ?`)
      .bind(key).first<any>()
  } catch { /* missing */ }

  return c.json({
    key,
    name:        meta.name,
    placeholders: meta.vars,
    default: {
      subject: def.subject,
      html:    def.html,
      text:    def.text,
    },
    override: override ? {
      subject:   override.subject,
      html:      override.html,
      text:      override.text,
      updatedAt: override.updated_at,
      updatedBy: override.updated_by,
    } : null,
  })
})

admin.put('/mail-templates/:key', async (c) => {
  const key = c.req.param('key')
  const meta = DEFAULT_TEMPLATE_KEYS.find(t => t.key === key)
  if (!meta) return c.json({ error: 'Unbekannte Vorlage.' }, 404)

  const body = await c.req.json<{ subject: string; html: string; text?: string }>()
  if (!body.subject || !body.html) {
    return c.json({ error: 'subject und html sind Pflicht.' }, 400)
  }
  const userId = c.get('userId') as string | undefined

  try {
    const exists = await c.env.DB.prepare(
      `SELECT template_key FROM mail_templates WHERE template_key = ?`
    ).bind(key).first()

    if (exists) {
      await c.env.DB.prepare(
        `UPDATE mail_templates
         SET subject = ?, html = ?, text = ?,
             updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now'),
             updated_by = ?
         WHERE template_key = ?`
      ).bind(body.subject, body.html, body.text ?? null, userId ?? null, key).run()
    } else {
      await c.env.DB.prepare(
        `INSERT INTO mail_templates (template_key, subject, html, text, updated_by)
         VALUES (?, ?, ?, ?, ?)`
      ).bind(key, body.subject, body.html, body.text ?? null, userId ?? null).run()
    }
    return c.json({ ok: true })
  } catch (e: any) {
    return c.json({ error: `mail_templates Tabelle fehlt — bitte scripts/create_mail_tables.sql ausführen. (${e?.message ?? e})` }, 500)
  }
})

admin.delete('/mail-templates/:key', async (c) => {
  const key = c.req.param('key')
  try {
    await c.env.DB.prepare(`DELETE FROM mail_templates WHERE template_key = ?`).bind(key).run()
    return c.json({ ok: true, message: 'Override gelöscht — Default-Vorlage greift wieder.' })
  } catch (e: any) {
    return c.json({ error: e?.message ?? 'unbekannt' }, 500)
  }
})

/// Live-Preview eines Templates mit Test-Daten gefüllt.
/// Body: { subject, html, vars? } — vars überschreibt Test-Defaults.
admin.post('/mail-templates/:key/preview', async (c) => {
  const body = await c.req.json<{
    subject?: string
    html?:    string
    text?:    string
    vars?:    Record<string, string>
  }>()
  const def = renderDefaultTemplate(c.req.param('key'))
  const subject = body.subject ?? def.subject
  const html    = body.html    ?? def.html
  const text    = body.text    ?? def.text

  // Test-Daten falls Caller keine schickt
  const testVars: Record<string, string> = {
    name:           'Anna Müller',
    code:           '123456',
    newEmail:       'neu@beispiel.de',
    productName:    'Stempeluhr',
    price:          '3,99 €/Monat',
    daysRemaining:  '7',
    ...(body.vars ?? {}),
  }
  const fill = (s: string) => s.replace(/\{\{(\w+)\}\}/g, (_, k) => testVars[k] ?? '')
  return c.json({
    subject: fill(subject),
    html:    fill(html),
    text:    text ? fill(text) : undefined,
    vars:    testVars,
  })
})

/// Manuellen Versand: Admin tippt Nachricht + wählt Empfänger und schickt los.
/// Body: { userIds: string[], subject: string, html: string, text?: string }
admin.post('/mail-send', async (c) => {
  const adminUserId = c.get('userId') as string
  const body = await c.req.json<{
    userIds:  string[]
    subject:  string
    html:     string
    text?:    string
  }>()

  if (!body.userIds?.length) return c.json({ error: 'Keine Empfänger gewählt.' }, 400)
  if (!body.subject || !body.html) return c.json({ error: 'subject und html sind Pflicht.' }, 400)

  // Empfänger aus DB laden — Sicherheit: niemals direkt vom Frontend gegebene
  // E-Mail-Adressen ungeprüft verschicken; immer User-IDs nutzen.
  const placeholders = body.userIds.map(() => '?').join(',')
  const usersRes = await c.env.DB
    .prepare(`SELECT id, email, first_name, last_name FROM users WHERE id IN (${placeholders})`)
    .bind(...body.userIds)
    .all<any>()
  const users = usersRes.results ?? []
  if (!users.length) return c.json({ error: 'Keine User gefunden.' }, 404)

  let sent = 0, failed = 0
  for (const u of users) {
    const name = [u.first_name, u.last_name].filter(Boolean).join(' ') || u.email
    const fillVars = (s: string) => s.replace(/\{\{(\w+)\}\}/g, (_: any, k: string) => {
      switch (k) {
        case 'name':  return name
        case 'email': return u.email
        default:      return ''
      }
    })

    const ok = await sendEmail({
      to:           u.email,
      toName:       name,
      subject:      fillVars(body.subject),
      html:         fillVars(body.html),
      text:         body.text ? fillVars(body.text) : undefined,
      from:         c.env.FROM_EMAIL,
      fromName:     c.env.FROM_NAME,
      apiKey:       c.env.RESEND_API_KEY,
      db:           c.env.DB,
      templateKey:  'manual',
      userId:       u.id,
      triggeredBy:  adminUserId,
    })
    if (ok) sent++; else failed++
  }
  return c.json({ ok: true, sent, failed, total: users.length })
})

// ── Helper: Hardcoded Default-Template-Inhalte holen ──────────────────────
function renderDefaultTemplate(key: string): { subject: string; html: string; text: string } {
  // Liefert die hardcoded Default-Vorlage mit `{{platzhaltern}}` befüllt — der
  // Admin sieht den Original-Code und kann ihn editieren. Beim Speichern
  // landet die geänderte Version in `mail_templates` und überschreibt zur
  // Laufzeit den Default.
  const N = '{{name}}', C = '{{code}}'
  switch (key) {
    case 'verifyEmail':
      return {
        subject: 'Dein Code: {{code}}',
        html:    verifyEmailHtml(C, N),
        text:    verifyEmailText(C, N),
      }
    case 'welcome':
      return {
        subject: 'Willkommen bei CustoSoft!',
        html:    welcomeEmailHtml(N),
        text:    welcomeEmailText(N),
      }
    case 'passwordReset':
      return {
        subject: 'Dein Passwort-Reset-Code: {{code}}',
        html:    `<!-- Reset-Mail-Template ist aktuell inline in auth.ts. Editieren überschreibt das beim nächsten Versand. -->`,
        text:    'Hallo {{name}}, hier ist dein Code zum Zurücksetzen: {{code}}',
      }
    case 'changeEmail':
      return {
        subject: 'Dein Code: {{code}} – E-Mail-Adresse ändern',
        html:    changeEmailHtml(C, '{{newEmail}}', N),
        text:    changeEmailText(C, '{{newEmail}}', N),
      }
    case 'purchase':
      return {
        subject: 'Bestellbestätigung — {{productName}}',
        html:    purchaseConfirmationHtml(N, '{{productName}}', '{{price}}', true),
        text:    purchaseConfirmationText(N, '{{productName}}', '{{price}}', true),
      }
    case 'expiringSoon':
      // signature: (name, productName, daysRemaining, expiresAt)
      return {
        subject: 'Dein {{productName}}-Abo läuft bald ab',
        html:    subscriptionExpiringSoonHtml(N, '{{productName}}', 7, '{{expiresAt}}'),
        text:    subscriptionExpiringSoonText(N, '{{productName}}', 7, '{{expiresAt}}'),
      }
    case 'subscriptionEnded':
      // signature: (name, productName, endedAt)
      return {
        subject: 'Dein {{productName}}-Abo wurde beendet',
        html:    subscriptionEndedHtml(N, '{{productName}}', new Date().toISOString()),
        text:    subscriptionEndedText(N, '{{productName}}', new Date().toISOString()),
      }
    case 'manual':
      return {
        subject: 'Nachricht von CustoSoft',
        html:    `<p>Hallo {{name}},</p>\n<p>Hier kann der Admin freie Nachrichten schreiben.</p>\n<p>Viele Grüße,<br>Dein CustoSoft Team</p>`,
        text:    'Hallo {{name}}, hier kann der Admin freie Nachrichten schreiben.',
      }
    default:
      return { subject: '', html: '', text: '' }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 10. Bug-Reports · Roadmap · Patch-Notes (CRUD)
// ═══════════════════════════════════════════════════════════════════════════

// ── Bug-Reports: Liste + Detail + Update ────────────────────────────────────
admin.get('/bugs', async (c) => {
  const status = c.req.query('status')
  let q = `SELECT * FROM bug_reports WHERE 1=1`
  const binds: any[] = []
  if (status && status !== 'all') { q += ` AND status = ?`; binds.push(status) }
  q += ` ORDER BY
           CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
           created_at DESC LIMIT 200`
  try {
    const rows = await c.env.DB.prepare(q).bind(...binds).all<any>()
    return c.json({
      items: (rows.results ?? []).map((r: any) => ({
        ...r,
        attachments: r.attachments ? JSON.parse(r.attachments) : [],
      })),
    })
  } catch {
    return c.json({ items: [], note: 'bug_reports missing — run scripts/create_bug_roadmap_patchnotes.sql' })
  }
})

admin.get('/bugs/:id', async (c) => {
  const id = c.req.param('id')
  const row = await c.env.DB.prepare(`SELECT * FROM bug_reports WHERE id = ?`).bind(id).first<any>()
  if (!row) return c.json({ error: 'Nicht gefunden.' }, 404)
  return c.json({
    ...row,
    attachments: row.attachments ? JSON.parse(row.attachments) : [],
  })
})

admin.put('/bugs/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json<{ status?: string; severity?: string; internal_note?: string }>()
  const fields: string[] = []
  const binds: any[] = []
  if (body.status        !== undefined) { fields.push('status = ?');        binds.push(body.status) }
  if (body.severity      !== undefined) { fields.push('severity = ?');      binds.push(body.severity) }
  if (body.internal_note !== undefined) { fields.push('internal_note = ?'); binds.push(body.internal_note) }
  if (!fields.length) return c.json({ error: 'Nichts zu aktualisieren.' }, 400)
  fields.push(`updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')`)
  binds.push(id)
  await c.env.DB.prepare(
    `UPDATE bug_reports SET ${fields.join(', ')} WHERE id = ?`
  ).bind(...binds).run()
  return c.json({ ok: true })
})

admin.delete('/bugs/:id', async (c) => {
  await c.env.DB.prepare(`DELETE FROM bug_reports WHERE id = ?`).bind(c.req.param('id')).run()
  return c.json({ ok: true })
})

// ── Roadmap-Items: List + CRUD ─────────────────────────────────────────────
admin.get('/roadmap', async (c) => {
  try {
    const rows = await c.env.DB.prepare(
      `SELECT * FROM roadmap_items ORDER BY sort_order ASC`
    ).all<any>()
    return c.json({ items: rows.results ?? [] })
  } catch {
    return c.json({ items: [] })
  }
})

admin.post('/roadmap', async (c) => {
  const body = await c.req.json<{
    quarter?: string; title: string; description?: string;
    status?: string; sort_order?: number; is_public?: boolean;
  }>()
  if (!body.title?.trim()) return c.json({ error: 'Titel ist Pflicht.' }, 400)
  const r = await c.env.DB.prepare(
    `INSERT INTO roadmap_items (quarter, title, description, status, sort_order, is_public)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(
    body.quarter ?? null, body.title.trim(), body.description ?? null,
    body.status ?? 'later', body.sort_order ?? 100, body.is_public === false ? 0 : 1,
  ).run()
  return c.json({ ok: true, id: r.meta.last_row_id })
})

admin.put('/roadmap/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json<any>()
  const fields: string[] = []
  const binds: any[] = []
  for (const key of ['quarter', 'title', 'description', 'status', 'sort_order'] as const) {
    if (body[key] !== undefined) { fields.push(`${key} = ?`); binds.push(body[key]) }
  }
  if (body.is_public !== undefined) { fields.push(`is_public = ?`); binds.push(body.is_public ? 1 : 0) }
  if (!fields.length) return c.json({ error: 'Nichts zu aktualisieren.' }, 400)
  fields.push(`updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')`)
  binds.push(id)
  await c.env.DB.prepare(`UPDATE roadmap_items SET ${fields.join(', ')} WHERE id = ?`).bind(...binds).run()
  return c.json({ ok: true })
})

admin.delete('/roadmap/:id', async (c) => {
  await c.env.DB.prepare(`DELETE FROM roadmap_items WHERE id = ?`).bind(c.req.param('id')).run()
  return c.json({ ok: true })
})

// ── Patch-Notes: List + CRUD ───────────────────────────────────────────────
admin.get('/patch-notes', async (c) => {
  try {
    const rows = await c.env.DB.prepare(
      `SELECT * FROM patch_notes ORDER BY released_at DESC NULLS LAST, sort_order DESC, id DESC`
    ).all<any>()
    return c.json({ items: rows.results ?? [] })
  } catch {
    return c.json({ items: [] })
  }
})

admin.post('/patch-notes', async (c) => {
  const body = await c.req.json<{
    version: string; title?: string; body_html?: string; body_markdown?: string;
    platform?: string; released_at?: string; is_published?: boolean; sort_order?: number;
  }>()
  if (!body.version?.trim()) return c.json({ error: 'Version ist Pflicht.' }, 400)
  const r = await c.env.DB.prepare(
    `INSERT INTO patch_notes (version, title, body_html, body_markdown, platform,
                              released_at, is_published, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    body.version.trim(), body.title ?? null, body.body_html ?? '', body.body_markdown ?? null,
    body.platform ?? 'all',
    body.released_at ?? new Date().toISOString(),
    body.is_published === false ? 0 : 1,
    body.sort_order ?? 100,
  ).run()
  return c.json({ ok: true, id: r.meta.last_row_id })
})

admin.put('/patch-notes/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json<any>()
  const fields: string[] = []
  const binds: any[] = []
  for (const key of ['version','title','body_html','body_markdown','platform','released_at','sort_order'] as const) {
    if (body[key] !== undefined) { fields.push(`${key} = ?`); binds.push(body[key]) }
  }
  if (body.is_published !== undefined) { fields.push(`is_published = ?`); binds.push(body.is_published ? 1 : 0) }
  if (!fields.length) return c.json({ error: 'Nichts zu aktualisieren.' }, 400)
  fields.push(`updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')`)
  binds.push(id)
  await c.env.DB.prepare(`UPDATE patch_notes SET ${fields.join(', ')} WHERE id = ?`).bind(...binds).run()
  return c.json({ ok: true })
})

admin.delete('/patch-notes/:id', async (c) => {
  await c.env.DB.prepare(`DELETE FROM patch_notes WHERE id = ?`).bind(c.req.param('id')).run()
  return c.json({ ok: true })
})

admin.get('/beta-signups', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT * FROM beta_signups ORDER BY created_at DESC`
  ).all<any>()
  return c.json({ items: rows.results ?? [], totalCount: rows.results?.length ?? 0 })
})

export default admin
