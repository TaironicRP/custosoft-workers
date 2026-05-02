// ── Auth Routes — /api/v1/auth ────────────────────────────────────────────────
import { Hono }         from 'hono'
import type { Env }     from '../types'
import { buildUserDto } from '../types'
import { requireAuth }  from '../middleware/auth'
import { signToken }    from '../utils/jwt'
import { hashPassword, verifyPassword, randomCode, randomToken, uuid } from '../utils/crypto'
import {
  sendEmail,
  verifyEmailHtml, verifyEmailText,
  passwordResetHtml, passwordResetText,
  welcomeEmailHtml, welcomeEmailText,
} from '../utils/email'

const auth = new Hono<{ Bindings: Env }>()

// ── Helper ────────────────────────────────────────────────────────────────────
async function buildResponse(db: D1Database, secret: string, user: any) {
  const dto   = await buildUserDto(db, user)
  const token = await signToken(
    { sub: user.id, email: user.email, role: user.app_role ?? 'user' },
    secret
  )
  return { accessToken: token, expiresIn: 2592000, user: dto }
}

// ── POST /login ───────────────────────────────────────────────────────────────
auth.post('/login', async (c) => {
  const { email, password } = await c.req.json<{ email: string; password: string }>()
  if (!email || !password)
    return c.json({ error: 'E-Mail und Passwort sind erforderlich.' }, 400)

  const user = await c.env.DB
    .prepare('SELECT * FROM users WHERE email_normalized = ?')
    .bind(email.trim().toUpperCase())
    .first<any>()

  if (!user)       return c.json({ error: 'Ungültige E-Mail-Adresse oder Passwort.' }, 401)
  if (user.is_blocked) return c.json({ error: 'Dein Konto wurde gesperrt.' }, 401)
  if (!user.password_hash)
    return c.json({ error: 'Bitte verwende Apple- oder Google-Anmeldung.' }, 401)

  const ok = await verifyPassword(password, user.password_hash)
  if (!ok)   return c.json({ error: 'Ungültige E-Mail-Adresse oder Passwort.' }, 401)

  // Update last_login_at
  await c.env.DB
    .prepare("UPDATE users SET last_login_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?")
    .bind(user.id).run()

  return c.json(await buildResponse(c.env.DB, c.env.JWT_SECRET, user))
})

// ── POST /register ────────────────────────────────────────────────────────────
auth.post('/register', async (c) => {
  const { email, password, displayName } =
    await c.req.json<{ email: string; password: string; displayName?: string }>()

  if (!email || !password)
    return c.json({ error: 'E-Mail und Passwort sind erforderlich.' }, 400)
  if (password.length < 8)
    return c.json({ error: 'Passwort muss mindestens 8 Zeichen lang sein.' }, 400)

  const existing = await c.env.DB
    .prepare('SELECT id FROM users WHERE email_normalized = ?')
    .bind(email.trim().toUpperCase())
    .first()
  if (existing) return c.json({ error: 'Diese E-Mail-Adresse ist bereits registriert.' }, 409)

  const id   = uuid()
  const hash = await hashPassword(password)
  const name = displayName?.trim() || email.split('@')[0]
  const parts = name.split(' ')
  const firstName = parts[0] ?? name
  const lastName  = parts.slice(1).join(' ')

  await c.env.DB.prepare(`
    INSERT INTO users (id, email, email_normalized, password_hash, first_name, last_name, email_confirmed)
    VALUES (?, ?, ?, ?, ?, ?, 0)
  `).bind(id, email.trim().toLowerCase(), email.trim().toUpperCase(), hash, firstName, lastName).run()

  const user = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<any>()

  // Send verification email
  const code    = randomCode()
  const expires = new Date(Date.now() + 3600_000).toISOString()
  await c.env.DB.prepare(
    'INSERT INTO email_verification_tokens (user_id, code, expires_at) VALUES (?, ?, ?)'
  ).bind(id, code, expires).run()

  // ⚠️ MÜSSEN await haben — Workers terminieren sonst vor dem Email-Versand
  await sendEmail({
    to: email, toName: name,
    subject: `Dein Code: ${code}`,
    text: verifyEmailText(code, name),
    html: verifyEmailHtml(code, name),
    from: c.env.FROM_EMAIL, fromName: c.env.FROM_NAME,
    apiKey: c.env.RESEND_API_KEY,
  })

  await sendEmail({
    to: email, toName: name,
    subject: 'Willkommen bei CustoSoft!',
    text: welcomeEmailText(name),
    html: welcomeEmailHtml(name),
    from: c.env.FROM_EMAIL, fromName: c.env.FROM_NAME,
    apiKey: c.env.RESEND_API_KEY,
  })

  return c.json(await buildResponse(c.env.DB, c.env.JWT_SECRET, user))
})

// ── POST /apple ───────────────────────────────────────────────────────────────
auth.post('/apple', async (c) => {
  const { identityToken, email, displayName } =
    await c.req.json<{ identityToken: string; email?: string; displayName?: string }>()
  if (!identityToken) return c.json({ error: 'Kein Identity-Token.' }, 400)

  // Verify Apple JWT
  let appleSub: string
  try {
    appleSub = await verifyAppleToken(identityToken, c.env.APPLE_CLIENT_ID)
  } catch (e: any) {
    return c.json({ error: `Apple-Token ungültig: ${e.message}` }, 401)
  }

  // Find or create user
  let user = await c.env.DB
    .prepare('SELECT * FROM users WHERE apple_sub = ?')
    .bind(appleSub).first<any>()

  if (!user && email) {
    // Check by email first (link accounts)
    user = await c.env.DB
      .prepare('SELECT * FROM users WHERE email_normalized = ?')
      .bind(email.trim().toUpperCase()).first<any>()

    if (user) {
      // Link Apple to existing account
      await c.env.DB
        .prepare('UPDATE users SET apple_sub = ? WHERE id = ?')
        .bind(appleSub, user.id).run()
    } else {
      // New user via Apple
      const id    = uuid()
      const name  = displayName?.trim() || email.split('@')[0]
      const parts = name.split(' ')
      await c.env.DB.prepare(`
        INSERT INTO users (id, email, email_normalized, first_name, last_name, apple_sub, email_confirmed)
        VALUES (?, ?, ?, ?, ?, ?, 1)
      `).bind(
        id, email.trim().toLowerCase(), email.trim().toUpperCase(),
        parts[0] ?? name, parts.slice(1).join(' '),
        appleSub, 1
      ).run()
      user = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<any>()

      await sendEmail({
        to: email, toName: name,
        subject: 'Willkommen bei CustoSoft!',
        text: welcomeEmailText(name),
        html: welcomeEmailHtml(name),
        from: c.env.FROM_EMAIL, fromName: c.env.FROM_NAME,
        apiKey: c.env.RESEND_API_KEY,
      })
    }
  }

  if (!user)       return c.json({ error: 'Apple-Anmeldung fehlgeschlagen.' }, 401)
  if (user.is_blocked) return c.json({ error: 'Dein Konto wurde gesperrt.' }, 401)

  await c.env.DB
    .prepare("UPDATE users SET last_login_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?")
    .bind(user.id).run()

  return c.json(await buildResponse(c.env.DB, c.env.JWT_SECRET, user))
})

// ── POST /forgot ──────────────────────────────────────────────────────────────
auth.post('/forgot', async (c) => {
  const { email } = await c.req.json<{ email: string }>()
  // Always return 200 (anti-enumeration)
  const user = await c.env.DB
    .prepare('SELECT * FROM users WHERE email_normalized = ?')
    .bind((email ?? '').trim().toUpperCase()).first<any>()

  if (user) {
    const token   = randomToken()
    const expires = new Date(Date.now() + 3600_000).toISOString()
    await c.env.DB
      .prepare('INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES (?, ?, ?)')
      .bind(user.id, token, expires).run()

    const resetUrl = `${c.env.PUBLIC_BASE_URL}/reset-password?token=${token}`
    const name     = `${user.first_name} ${user.last_name}`.trim() || user.email
    await sendEmail({
      to: user.email, toName: name,
      subject: 'Passwort zurücksetzen',
      text: passwordResetText(resetUrl, name),
      html: passwordResetHtml(resetUrl, name),
      from: c.env.FROM_EMAIL, fromName: c.env.FROM_NAME,
      apiKey: c.env.RESEND_API_KEY,
    })
  }

  return c.json({ ok: true })
})

// ── POST /reset ───────────────────────────────────────────────────────────────
auth.post('/reset', async (c) => {
  const { token, newPassword } = await c.req.json<{ token: string; newPassword: string }>()
  if (!token || !newPassword)
    return c.json({ error: 'Token und Passwort erforderlich.' }, 400)
  if (newPassword.length < 8)
    return c.json({ error: 'Passwort muss mindestens 8 Zeichen lang sein.' }, 400)

  const now = new Date().toISOString()
  const row = await c.env.DB
    .prepare('SELECT * FROM password_reset_tokens WHERE token = ? AND used = 0 AND expires_at > ?')
    .bind(token, now).first<any>()

  if (!row) return c.json({ error: 'Ungültiger oder abgelaufener Reset-Link.' }, 400)

  const hash = await hashPassword(newPassword)
  await c.env.DB
    .prepare('UPDATE users SET password_hash = ? WHERE id = ?')
    .bind(hash, row.user_id).run()
  await c.env.DB
    .prepare('UPDATE password_reset_tokens SET used = 1 WHERE id = ?')
    .bind(row.id).run()

  return c.json({ ok: true })
})

// ── POST /verify-email ────────────────────────────────────────────────────────
auth.post('/verify-email', requireAuth, async (c) => {
  const { code } = await c.req.json<{ code: string }>()
  const userId   = c.get('userId') as string
  const now      = new Date().toISOString()

  const row = await c.env.DB
    .prepare(`SELECT * FROM email_verification_tokens
              WHERE user_id = ? AND code = ? AND used = 0 AND expires_at > ?`)
    .bind(userId, code, now).first<any>()

  if (!row) return c.json({ error: 'Ungültiger oder abgelaufener Code.' }, 400)

  await c.env.DB
    .prepare('UPDATE users SET email_confirmed = 1 WHERE id = ?')
    .bind(userId).run()
  await c.env.DB
    .prepare('UPDATE email_verification_tokens SET used = 1 WHERE id = ?')
    .bind(row.id).run()

  const user = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first<any>()
  return c.json({ user: await buildUserDto(c.env.DB, user), alreadyVerified: false })
})

// ── POST /resend-verification ─────────────────────────────────────────────────
auth.post('/resend-verification', requireAuth, async (c) => {
  const userId = c.get('userId') as string
  const user   = c.get('userRow') as any

  const code    = randomCode()
  const expires = new Date(Date.now() + 3600_000).toISOString()
  await c.env.DB
    .prepare('INSERT INTO email_verification_tokens (user_id, code, expires_at) VALUES (?, ?, ?)')
    .bind(userId, code, expires).run()

  const name = `${user.first_name} ${user.last_name}`.trim() || user.email
  await sendEmail({
    to: user.email, toName: name,
    subject: `Dein Code: ${code}`,
    text: verifyEmailText(code, name),
    html: verifyEmailHtml(code, name),
    from: c.env.FROM_EMAIL, fromName: c.env.FROM_NAME,
    apiKey: c.env.RESEND_API_KEY,
  })

  return c.json({ ok: true })
})

// ── GET /me ───────────────────────────────────────────────────────────────────
auth.get('/me', requireAuth, async (c) => {
  const user = c.get('userRow') as any
  return c.json(await buildUserDto(c.env.DB, user))
})

// ── PUT /me/username ──────────────────────────────────────────────────────────
auth.put('/me/username', requireAuth, async (c) => {
  const { username } = await c.req.json<{ username: string }>()
  const userId = c.get('userId') as string

  if (!username?.trim())
    return c.json({ error: 'Username darf nicht leer sein.' }, 400)
  if (!/^[a-z0-9_.-]{3,30}$/.test(username))
    return c.json({ error: 'Username: 3–30 Zeichen, nur a-z 0-9 _ - .' }, 400)

  const exists = await c.env.DB
    .prepare('SELECT id FROM users WHERE public_username = ? AND id != ?')
    .bind(username, userId).first()
  if (exists) return c.json({ error: 'Dieser Username ist bereits vergeben.' }, 409)

  await c.env.DB
    .prepare('UPDATE users SET public_username = ? WHERE id = ?')
    .bind(username, userId).run()

  const user = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first<any>()
  return c.json(await buildUserDto(c.env.DB, user))
})

// ── PUT /me/name-visibility ───────────────────────────────────────────────────
auth.put('/me/name-visibility', requireAuth, async (c) => {
  const { visibility } = await c.req.json<{ visibility: string }>()
  const userId = c.get('userId') as string

  if (!['Public', 'OrgOnly', 'Private'].includes(visibility))
    return c.json({ error: 'Ungültige Sichtbarkeit.' }, 400)

  await c.env.DB
    .prepare('UPDATE users SET name_visibility = ? WHERE id = ?')
    .bind(visibility, userId).run()

  const user = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first<any>()
  return c.json(await buildUserDto(c.env.DB, user))
})

// ── POST /me/ack-org-welcome ──────────────────────────────────────────────────
auth.post('/me/ack-org-welcome', requireAuth, async (c) => {
  const userId = c.get('userId') as string
  const member = await c.env.DB
    .prepare('SELECT org_id FROM org_members WHERE user_id = ? AND is_active = 1 LIMIT 1')
    .bind(userId).first<any>()

  if (member) {
    await c.env.DB
      .prepare('UPDATE users SET last_seen_org_id = ? WHERE id = ?')
      .bind(member.org_id, userId).run()
  }

  const user = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first<any>()
  return c.json(await buildUserDto(c.env.DB, user))
})

// ── DELETE /me/delete ─────────────────────────────────────────────────────────
auth.delete('/me/delete', requireAuth, async (c) => {
  const userId = c.get('userId') as string
  await c.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(userId).run()
  return new Response(null, { status: 204 })
})

// ── Apple Token Verification ──────────────────────────────────────────────────
async function verifyAppleToken(identityToken: string, clientId: string): Promise<string> {
  // Fetch Apple's public keys
  const keysRes = await fetch('https://appleid.apple.com/auth/keys')
  const { keys } = await keysRes.json<{ keys: any[] }>()

  // Decode header to find kid
  const [headerB64] = identityToken.split('.')
  const header = JSON.parse(atob(headerB64.replace(/-/g, '+').replace(/_/g, '/')))

  const jwk = keys.find((k: any) => k.kid === header.kid)
  if (!jwk) throw new Error('Apple key not found')

  const pubKey = await crypto.subtle.importKey(
    'jwk', jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['verify']
  )

  // Verify signature
  const [headerPart, payloadPart, sigPart] = identityToken.split('.')
  const data = new TextEncoder().encode(`${headerPart}.${payloadPart}`)
  const sig  = Uint8Array.from(atob(sigPart.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))

  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', pubKey, sig, data)
  if (!valid) throw new Error('Signature invalid')

  // Decode payload
  const payload = JSON.parse(atob(payloadPart.replace(/-/g, '+').replace(/_/g, '/')))

  // Validate claims
  if (payload.iss !== 'https://appleid.apple.com') throw new Error('Wrong issuer')
  if (payload.aud !== clientId) throw new Error('Wrong audience')
  if (payload.exp < Date.now() / 1000) throw new Error('Token expired')

  return payload.sub as string
}

export default auth
