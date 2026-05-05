// ── Admin Routes — /api/v1/admin (Staff only) ─────────────────────────────────
// Mirrors all features from the legacy ASP.NET admin: users, orgs, licenses,
// grants, notifications, orders, legal-page editing.

import { Hono }                       from 'hono'
import type { Env, AppEnv } from '../types'
import { requireStaff }               from '../middleware/auth'

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
// 9. Mail Logs / Audit
// ═══════════════════════════════════════════════════════════════════════════

admin.get('/mail-logs', async (c) => {
  // Optional: implement mail_logs table if needed for audit
  return c.json({ items: [] })
})

admin.get('/beta-signups', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT * FROM beta_signups ORDER BY created_at DESC`
  ).all<any>()
  return c.json({ items: rows.results ?? [], totalCount: rows.results?.length ?? 0 })
})

export default admin
