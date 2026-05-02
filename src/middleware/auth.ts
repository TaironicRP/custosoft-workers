// ── JWT Auth Middleware for Hono ──────────────────────────────────────────────
import type { Context, Next } from 'hono'
import type { Env }           from '../types'
import { extractBearer, verifyToken } from '../utils/jwt'

/** Hono context with typed variables (userId, user, member, etc.) */
type AuthCtx = Context<{
  Bindings: Env
  Variables: {
    userId:  string
    userRow: any
    user:    any
    member:  any
    orgId:   number
  }
}>

/** Protect a route — attaches userId + userRow to c.set() */
export async function requireAuth(c: AuthCtx, next: Next): Promise<Response | undefined> {
  const token = extractBearer(c.req.header('Authorization') ?? null)
  if (!token) return c.json({ error: 'Nicht angemeldet. Bitte neu einloggen.' }, 401)

  let payload
  try {
    payload = await verifyToken(token, c.env.JWT_SECRET)
  } catch {
    return c.json({ error: 'Nicht angemeldet. Bitte neu einloggen.' }, 401)
  }

  const userId = payload.sub
  if (!userId) return c.json({ error: 'Ungültiger Token.' }, 401)

  // Load full user row
  const user = await c.env.DB
    .prepare('SELECT * FROM users WHERE id = ?')
    .bind(userId)
    .first()

  if (!user)   return c.json({ error: 'Nutzer nicht gefunden.' }, 401)
  if ((user as any).is_blocked) return c.json({ error: 'Dein Konto wurde gesperrt.' }, 403)

  c.set('userId',  userId)
  c.set('userRow', user)
  c.set('user',    { ...user, id: (user as any).id })   // alias: routes use c.get('user').id

  await next()
  return undefined
}

/** Require app staff (SuperAdmin or Staff role) — direct impl for proper Response propagation */
export async function requireStaff(c: AuthCtx, next: Next): Promise<Response | undefined> {
  const token = extractBearer(c.req.header('Authorization') ?? null)
  if (!token) return c.json({ error: 'Nicht angemeldet. Bitte neu einloggen.' }, 401)

  let payload
  try {
    payload = await verifyToken(token, c.env.JWT_SECRET)
  } catch {
    return c.json({ error: 'Nicht angemeldet. Bitte neu einloggen.' }, 401)
  }
  const userId = payload.sub
  if (!userId) return c.json({ error: 'Ungültiger Token.' }, 401)

  const user = await c.env.DB
    .prepare('SELECT * FROM users WHERE id = ?')
    .bind(userId).first()

  if (!user)                       return c.json({ error: 'Nutzer nicht gefunden.' }, 401)
  if ((user as any).is_blocked)    return c.json({ error: 'Dein Konto wurde gesperrt.' }, 403)
  if (!(user as any).app_role)     return c.json({ error: 'Kein Zugriff auf diesen Bereich.' }, 403)

  c.set('userId',  userId)
  c.set('userRow', user)
  c.set('user',    { ...user, id: (user as any).id })
  await next()
  return undefined
}

/** Require user to be org member — direct impl for proper Response propagation */
export async function requireOrgMember(c: AuthCtx, next: Next): Promise<Response | undefined> {
  const token = extractBearer(c.req.header('Authorization') ?? null)
  if (!token) return c.json({ error: 'Nicht angemeldet. Bitte neu einloggen.' }, 401)

  let payload
  try {
    payload = await verifyToken(token, c.env.JWT_SECRET)
  } catch {
    return c.json({ error: 'Nicht angemeldet. Bitte neu einloggen.' }, 401)
  }
  const userId = payload.sub
  if (!userId) return c.json({ error: 'Ungültiger Token.' }, 401)

  const user = await c.env.DB
    .prepare('SELECT * FROM users WHERE id = ?')
    .bind(userId).first()

  if (!user)                    return c.json({ error: 'Nutzer nicht gefunden.' }, 401)
  if ((user as any).is_blocked) return c.json({ error: 'Dein Konto wurde gesperrt.' }, 403)

  const member = await c.env.DB
    .prepare('SELECT * FROM org_members WHERE user_id = ? AND is_active = 1 LIMIT 1')
    .bind(userId).first()

  if (!member) return c.json({ error: 'Du bist in keiner Organisation.' }, 403)

  c.set('userId',  userId)
  c.set('userRow', user)
  c.set('user',    { ...user, id: (user as any).id })
  c.set('member',  member)
  c.set('orgId',   (member as any).org_id)
  await next()
  return undefined
}
