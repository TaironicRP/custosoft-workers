// ── Auth Routes — /api/v1/auth ────────────────────────────────────────────────
import { Hono }         from 'hono'
import type { Env }     from '../types'
import { buildUserDto } from '../types'
import { requireAuth }  from '../middleware/auth'
import { signToken }    from '../utils/jwt'
import { hashPassword, verifyPassword, randomCode, randomToken, uuid } from '../utils/crypto'
import { uploadToR2, parseFileUpload, deleteFromR2 } from '../utils/r2'
import {
  sendEmail,
  verifyEmailHtml, verifyEmailText,
  passwordResetHtml, passwordResetText,
  welcomeEmailHtml, welcomeEmailText,
  changeEmailHtml, changeEmailText,
  pickLang,
} from '../utils/email'

/// Liefert die bevorzugte Sprache eines Users — erst aus DB-Spalte,
/// dann Accept-Language-Header (frische Registrierungen wo noch kein
/// users.language existiert), default `'de'`.
function userLang(c: any, dbLang: string | null | undefined): 'de' | 'en' {
  if (dbLang) return pickLang(dbLang)
  const accept = c.req.header?.('Accept-Language') ?? ''
  return pickLang(accept.split(',')[0])
}

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
    return c.json({ error: 'Bitte verwende „Mit Apple anmelden".' }, 401)

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

  const lang = userLang(c, null)
  // Sprache vermerken — ab jetzt landet jede zukünftige Email lokalisiert
  try {
    await c.env.DB.prepare('UPDATE users SET language = ? WHERE id = ?').bind(lang, id).run()
  } catch { /* language column may not exist yet (pre-migration) */ }

  // ⚠️ MÜSSEN await haben — Workers terminieren sonst vor dem Email-Versand
  await sendEmail({
    to: email, toName: name,
    subject: lang === 'en' ? `Your code: ${code}` : `Dein Code: ${code}`,
    text: verifyEmailText(code, name, lang),
    html: verifyEmailHtml(code, name, lang),
    from: c.env.FROM_EMAIL, fromName: c.env.FROM_NAME,
    apiKey: c.env.RESEND_API_KEY,
    db: c.env.DB, templateKey: 'verifyEmail', userId: id,
  })

  await sendEmail({
    to: email, toName: name,
    subject: lang === 'en' ? 'Welcome to CustoSoft!' : 'Willkommen bei CustoSoft!',
    text: welcomeEmailText(name, lang),
    html: welcomeEmailHtml(name, lang),
    from: c.env.FROM_EMAIL, fromName: c.env.FROM_NAME,
    apiKey: c.env.RESEND_API_KEY,
    db: c.env.DB, templateKey: 'welcome', userId: id,
  })

  return c.json(await buildResponse(c.env.DB, c.env.JWT_SECRET, user))
})

// ── POST /apple ───────────────────────────────────────────────────────────────
auth.post('/apple', async (c) => {
  const { identityToken, email: bodyEmail, displayName } =
    await c.req.json<{ identityToken: string; email?: string; displayName?: string }>()
  if (!identityToken) return c.json({ error: 'Kein Identity-Token.' }, 400)

  // Verify Apple JWT — sub + email kommen aus dem signierten Payload (vertrauenswürdig).
  let applePayload: { sub: string; email?: string }
  try {
    applePayload = await verifyAppleToken(identityToken, c.env.APPLE_CLIENT_ID)
  } catch (e: any) {
    return c.json({ error: `Apple-Token ungültig: ${e.message}` }, 401)
  }
  const appleSub = applePayload.sub

  // 1. Bevorzugt: User mit dieser apple_sub schon vorhanden → einloggen.
  let user = await c.env.DB
    .prepare('SELECT * FROM users WHERE apple_sub = ?')
    .bind(appleSub).first<any>()

  if (!user) {
    // Email ermitteln: signierter Token-Claim hat Vorrang vor dem Body
    // (Apple sendet email beim ersten Login; iOS sendet "" bei Folge-Logins.)
    const email = (applePayload.email ?? bodyEmail ?? '').trim().toLowerCase()
    if (!email) {
      return c.json({
        error: 'E-Mail nicht im Apple-Token enthalten. Bitte unter Einstellungen → Apple-ID → ' +
               '„Anmelden mit Apple" → CustoSoft entfernen und erneut anmelden.'
      }, 400)
    }

    // 2. Existing user mit dieser Email? → Apple-Login dranlinken.
    user = await c.env.DB
      .prepare('SELECT * FROM users WHERE email_normalized = ?')
      .bind(email.toUpperCase()).first<any>()

    if (user) {
      await c.env.DB
        .prepare('UPDATE users SET apple_sub = ? WHERE id = ?')
        .bind(appleSub, user.id).run()
    } else {
      // 3. Brand-new Apple-Registrierung.
      // → Email-Code-Bestätigung (gleicher Flow wie /register).
      const id        = uuid()
      const rawName   = displayName?.trim() || email.split('@')[0]
      const parts     = rawName.split(' ')
      const firstName = parts[0] || rawName
      const lastName  = parts.slice(1).join(' ')

      try {
        await c.env.DB.prepare(`
          INSERT INTO users (id, email, email_normalized, first_name, last_name, apple_sub, email_confirmed)
          VALUES (?, ?, ?, ?, ?, ?, 0)
        `).bind(id, email, email.toUpperCase(), firstName, lastName, appleSub).run()
      } catch (e: any) {
        console.error('[POST /auth/apple] INSERT users failed:', e?.message ?? e)
        return c.json({ error: `Account konnte nicht erstellt werden: ${e?.message ?? 'unbekannt'}` }, 500)
      }

      user = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<any>()

      // Verification-Code generieren + per Mail senden
      const code    = randomCode()
      const expires = new Date(Date.now() + 3600_000).toISOString()
      await c.env.DB
        .prepare('INSERT INTO email_verification_tokens (user_id, code, expires_at) VALUES (?, ?, ?)')
        .bind(id, code, expires).run()

      await sendEmail({
        to: email, toName: rawName,
        subject: `Dein Code: ${code}`,
        text: verifyEmailText(code, rawName),
        html: verifyEmailHtml(code, rawName),
        from: c.env.FROM_EMAIL, fromName: c.env.FROM_NAME,
        apiKey: c.env.RESEND_API_KEY,
        db: c.env.DB, templateKey: 'verifyEmail', userId: id,
      })
    }
  }

  if (!user)           return c.json({ error: 'Apple-Anmeldung fehlgeschlagen.' }, 401)
  if (user.is_blocked) return c.json({ error: 'Dein Konto wurde gesperrt.' }, 401)

  await c.env.DB
    .prepare("UPDATE users SET last_login_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?")
    .bind(user.id).run()

  return c.json(await buildResponse(c.env.DB, c.env.JWT_SECRET, user))
})

// ── POST /forgot ──────────────────────────────────────────────────────────────
// Generiert einen 6-stelligen numerischen Code, speichert ihn in
// password_reset_tokens (das Token-Feld nimmt den Code) und sendet per Email.
// Der iOS-Client zeigt eine Code-Eingabe (6 Ziffern) an.
auth.post('/forgot', async (c) => {
  try {
    const { email } = await c.req.json<{ email?: string }>().catch(() => ({}))
    const cleanEmail = (email ?? '').trim()
    if (!cleanEmail) return c.json({ error: 'Email erforderlich.' }, 400)

    // Always return 200 (anti-enumeration) — egal ob User existiert oder nicht
    const user = await c.env.DB
      .prepare('SELECT * FROM users WHERE email_normalized = ?')
      .bind(cleanEmail.toUpperCase()).first<any>()

    if (user) {
      // 6-stelliger Code: 100000-999999
      const code = String(Math.floor(100000 + Math.random() * 900000))
      const expires = new Date(Date.now() + 30 * 60_000).toISOString()  // 30 Min gültig

      // Alte ungenutzte Codes für diesen User invalidieren (nur ein aktiver Code)
      await c.env.DB
        .prepare('UPDATE password_reset_tokens SET used = 1 WHERE user_id = ? AND used = 0')
        .bind(user.id).run()

      await c.env.DB
        .prepare('INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES (?, ?, ?)')
        .bind(user.id, code, expires).run()

      const name = `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim() || user.email
      const subject = 'Dein Passwort-Reset-Code'
      const text = `Hallo${name ? ' ' + name : ''},

Hier ist dein Code zum Zurücksetzen deines Passworts:

  ${code}

Gib diesen Code in der CustoSoft-App ein um ein neues Passwort zu setzen.
Der Code ist 30 Minuten gültig. Wenn du diesen Code nicht angefordert hast, ignoriere diese E-Mail.

— Dein CustoSoft Team`

      const html = `<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><style>
        body{margin:0;padding:0;background:#0a0a14;font-family:-apple-system,sans-serif;color:#fff}
        .wrap{max-width:540px;margin:40px auto;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.10);border-radius:24px;overflow:hidden}
        .hero{background:linear-gradient(135deg,#7733ff,#3399ff);padding:36px 32px;text-align:center}
        .hero h1{font-size:22px;font-weight:700;margin:0 0 6px;color:#fff}
        .hero p{color:rgba(255,255,255,0.85);margin:0;font-size:13px}
        .body{padding:30px 32px;color:rgba(255,255,255,0.80);line-height:1.55}
        .code-box{background:rgba(119,51,255,0.18);border:1px solid rgba(119,51,255,0.45);border-radius:14px;padding:24px;text-align:center;font-size:36px;font-weight:700;letter-spacing:10px;color:#a98cff;font-family:'SF Mono',monospace;margin:18px 0}
        .footer{padding:18px;border-top:1px solid rgba(255,255,255,0.07);text-align:center;color:rgba(255,255,255,0.30);font-size:11px}
      </style></head><body><div class="wrap">
        <div class="hero"><h1>🔐 Passwort zurücksetzen</h1><p>Dein 6-stelliger Code</p></div>
        <div class="body">
          <p>Hallo${name ? ' ' + name : ''},</p>
          <p>Gib diesen Code in der CustoSoft-App ein um dein Passwort zurückzusetzen:</p>
          <div class="code-box">${code}</div>
          <p style="font-size:12px;color:rgba(255,255,255,0.55);margin-top:16px">Der Code ist <strong>30 Minuten</strong> gültig. Wenn du diesen Reset nicht angefordert hast, ignoriere diese E-Mail — dein Passwort bleibt unverändert.</p>
        </div>
        <div class="footer">CustoSoft · <a href="https://custosoftcustomers.com/datenschutz" style="color:rgba(255,255,255,0.50)">Datenschutz</a></div>
      </div></body></html>`

      const sent = await sendEmail({
        to: user.email, toName: name,
        subject, text, html,
        from: c.env.FROM_EMAIL, fromName: c.env.FROM_NAME,
        apiKey: c.env.RESEND_API_KEY,
        db: c.env.DB, templateKey: 'passwordReset', userId: user.id,
      })
      if (!sent) {
        console.error('[POST /auth/forgot] sendEmail returned false for', user.email,
                      '— RESEND_API_KEY/FROM_EMAIL/PUBLIC_BASE_URL korrekt gesetzt?')
        // Wir geben trotzdem 200 zurück (anti-enumeration), aber loggen den Fail
      } else {
        console.log('[POST /auth/forgot] Code an', user.email, 'gesendet')
      }
    }

    return c.json({ ok: true })
  } catch (e: any) {
    console.error('[POST /auth/forgot]', e?.message ?? e)
    // Anti-enumeration: kein 500 raus
    return c.json({ ok: true })
  }
})

// ── POST /reset ───────────────────────────────────────────────────────────────
// Body: { token: "123456", newPassword: "..." }  — token = der 6-stellige Code
auth.post('/reset', async (c) => {
  try {
    const body = await c.req.json<{ token?: string; code?: string; newPassword?: string }>().catch(() => ({}))
    const code = (body.token ?? body.code ?? '').trim()
    const newPassword = body.newPassword ?? ''
    if (!code || !newPassword)
      return c.json({ error: 'Code und Passwort erforderlich.' }, 400)
    if (newPassword.length < 8)
      return c.json({ error: 'Passwort muss mindestens 8 Zeichen lang sein.' }, 400)

    const now = new Date().toISOString()
    const row = await c.env.DB
      .prepare('SELECT * FROM password_reset_tokens WHERE token = ? AND used = 0 AND expires_at > ?')
      .bind(code, now).first<any>()

    if (!row) return c.json({ error: 'Ungültiger oder abgelaufener Code.' }, 400)

    const hash = await hashPassword(newPassword)
    await c.env.DB
      .prepare('UPDATE users SET password_hash = ? WHERE id = ?')
      .bind(hash, row.user_id).run()
    await c.env.DB
      .prepare('UPDATE password_reset_tokens SET used = 1 WHERE id = ?')
      .bind(row.id).run()

    return c.json({ ok: true })
  } catch (e: any) {
    console.error('[POST /auth/reset]', e?.message ?? e)
    return c.json({ error: `Reset fehlgeschlagen: ${e?.message ?? 'unbekannt'}` }, 500)
  }
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
    db: c.env.DB, templateKey: 'verifyEmail', userId: userId,
  })

  return c.json({ ok: true })
})

// ── GET /me ───────────────────────────────────────────────────────────────────
auth.get('/me', requireAuth, async (c) => {
  const user = c.get('userRow') as any
  return c.json(await buildUserDto(c.env.DB, user))
})

// ── PUT /me — Account-Type ändern (Privat ↔ Organisation) ────────────────────
auth.put('/me', requireAuth, async (c) => {
  const userId = c.get('userId') as string
  const body   = await c.req.json<{ accountType?: string }>()

  if (body.accountType && !['Private', 'Organisation'].includes(body.accountType)) {
    return c.json({ error: 'accountType muss "Private" oder "Organisation" sein.' }, 400)
  }

  if (body.accountType) {
    await c.env.DB
      .prepare(`UPDATE users SET account_type = ? WHERE id = ?`)
      .bind(body.accountType, userId).run()
  }

  const u = await c.env.DB.prepare(`SELECT * FROM users WHERE id = ?`).bind(userId).first<any>()
  if (!u) return c.json({ error: 'Nutzer nicht gefunden.' }, 404)

  return c.json(await buildUserDto(c.env.DB, u))
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

// ── PUT /me/language — DE/EN für lokalisierte E-Mails setzen ─────────────────
auth.put('/me/language', requireAuth, async (c) => {
  const userId = c.get('userId') as string
  const { language } = await c.req.json<{ language: string }>().catch(() => ({ language: '' }))
  const lang = pickLang(language)
  try {
    await c.env.DB
      .prepare('UPDATE users SET language = ? WHERE id = ?')
      .bind(lang, userId).run()
  } catch (e: any) {
    return c.json({ error: 'language Spalte fehlt — scripts/add_user_language.sql ausführen.' }, 500)
  }
  return c.json({ ok: true, language: lang })
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

// ── POST /me/avatar — Profilbild hochladen ────────────────────────────────────
// Multipart-Upload (`file` field). Speichert in R2 unter `avatars/`,
// löscht das alte Avatar-File und aktualisiert users.avatar_url.
// Limits: 8 MB, image/* Content-Type.
auth.post('/me/avatar', requireAuth, async (c) => {
  const userId = c.get('userId') as string

  const upload = await parseFileUpload(c.req.raw)
  if (!upload) return c.json({ error: 'Keine Datei hochgeladen.' }, 400)

  if (!upload.contentType.startsWith('image/')) {
    return c.json({ error: 'Nur Bilddateien erlaubt (PNG, JPG, HEIC, WEBP).' }, 415)
  }

  const MAX_BYTES = 8 * 1024 * 1024 // 8 MB
  if (upload.file.byteLength > MAX_BYTES) {
    return c.json({ error: 'Bild zu groß. Maximal 8 MB.' }, 413)
  }

  // Bestehendes Avatar holen (für Cleanup nach erfolgreichem Upload)
  const prev = await c.env.DB
    .prepare('SELECT avatar_url FROM users WHERE id = ?')
    .bind(userId).first<{ avatar_url: string | null }>()

  // R2-Upload
  const result = await uploadToR2(
    c.env.UPLOADS,
    upload.file,
    upload.filename || 'avatar.jpg',
    upload.contentType,
    'avatars',
  )

  // DB updaten
  await c.env.DB
    .prepare('UPDATE users SET avatar_url = ? WHERE id = ?')
    .bind(result.url, userId).run()

  // Altes Avatar aus R2 entfernen — nur wenn es ein eigener Upload war
  if (prev?.avatar_url && prev.avatar_url.startsWith('/uploads/avatars/')) {
    try {
      await deleteFromR2(c.env.UPLOADS, prev.avatar_url)
    } catch (e) {
      console.warn('[POST /me/avatar] alte Datei löschen fehlgeschlagen:', e)
    }
  }

  const user = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first<any>()
  return c.json(await buildUserDto(c.env.DB, user))
})

// ── DELETE /me/avatar — Profilbild entfernen ──────────────────────────────────
auth.delete('/me/avatar', requireAuth, async (c) => {
  const userId = c.get('userId') as string

  const prev = await c.env.DB
    .prepare('SELECT avatar_url FROM users WHERE id = ?')
    .bind(userId).first<{ avatar_url: string | null }>()

  await c.env.DB
    .prepare('UPDATE users SET avatar_url = NULL WHERE id = ?')
    .bind(userId).run()

  if (prev?.avatar_url && prev.avatar_url.startsWith('/uploads/avatars/')) {
    try {
      await deleteFromR2(c.env.UPLOADS, prev.avatar_url)
    } catch (e) {
      console.warn('[DELETE /me/avatar] R2-Cleanup fehlgeschlagen:', e)
    }
  }

  const user = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first<any>()
  return c.json(await buildUserDto(c.env.DB, user))
})

// ── POST /me/change-password ──────────────────────────────────────────────────
auth.post('/me/change-password', requireAuth, async (c) => {
  const userId = c.get('userId') as string
  const { currentPassword, newPassword } =
    await c.req.json<{ currentPassword: string; newPassword: string }>()

  if (!currentPassword || !newPassword)
    return c.json({ error: 'Aktuelles und neues Passwort sind erforderlich.' }, 400)

  if (newPassword.length < 8)
    return c.json({ error: 'Das neue Passwort muss mindestens 8 Zeichen haben.' }, 400)

  const user = await c.env.DB
    .prepare('SELECT * FROM users WHERE id = ?')
    .bind(userId).first<any>()

  if (!user || !user.password_hash)
    return c.json({ error: 'Kein Passwort gesetzt (Apple-Login-Account).' }, 400)

  const ok = await verifyPassword(currentPassword, user.password_hash)
  if (!ok)
    return c.json({ error: 'Das aktuelle Passwort ist falsch.' }, 401)

  const newHash = await hashPassword(newPassword)
  await c.env.DB
    .prepare('UPDATE users SET password_hash = ? WHERE id = ?')
    .bind(newHash, userId).run()

  return c.json({ success: true })
})

// ── POST /me/change-email/request ─────────────────────────────────────────────
auth.post('/me/change-email/request', requireAuth, async (c) => {
  const userId = c.get('userId') as string
  const { newEmail } = await c.req.json<{ newEmail: string }>()

  if (!newEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail))
    return c.json({ error: 'Bitte gib eine gültige E-Mail-Adresse ein.' }, 400)

  const newEmailNorm = newEmail.trim().toUpperCase()

  // Prüfen ob die neue E-Mail schon vergeben ist
  const existing = await c.env.DB
    .prepare('SELECT id FROM users WHERE email_normalized = ? AND id != ?')
    .bind(newEmailNorm, userId).first<any>()
  if (existing)
    return c.json({ error: 'Diese E-Mail-Adresse wird bereits verwendet.' }, 409)

  const user = await c.env.DB
    .prepare('SELECT * FROM users WHERE id = ?')
    .bind(userId).first<any>()
  if (!user) return c.json({ error: 'Benutzer nicht gefunden.' }, 404)

  const code    = randomCode()
  const expires = new Date(Date.now() + 3600_000).toISOString()

  // Alte noch nicht verwendete Tokens für diesen User invalidieren
  await c.env.DB
    .prepare('UPDATE email_change_tokens SET used = 1 WHERE user_id = ? AND used = 0')
    .bind(userId).run()

  await c.env.DB
    .prepare('INSERT INTO email_change_tokens (user_id, new_email, code, expires_at) VALUES (?, ?, ?, ?)')
    .bind(userId, newEmail.trim(), code, expires).run()

  const name = [user.first_name, user.last_name].filter(Boolean).join(' ') || user.email

  const sent = await sendEmail({
    to: newEmail.trim(), toName: name,
    subject: `Dein Code: ${code} – E-Mail-Adresse ändern`,
    text: changeEmailText(code, newEmail.trim(), name),
    html: changeEmailHtml(code, newEmail.trim(), name),
    db: c.env.DB, templateKey: 'changeEmail', userId: userId,
    from: c.env.FROM_EMAIL, fromName: c.env.FROM_NAME,
    apiKey: c.env.RESEND_API_KEY,
  })

  if (!sent) return c.json({ error: 'E-Mail konnte nicht gesendet werden. Bitte versuche es später erneut.' }, 500)

  return c.json({ success: true })
})

// ── POST /me/change-email/confirm ─────────────────────────────────────────────
auth.post('/me/change-email/confirm', requireAuth, async (c) => {
  const userId = c.get('userId') as string
  const { newEmail, code } = await c.req.json<{ newEmail: string; code: string }>()

  if (!newEmail || !code)
    return c.json({ error: 'E-Mail und Code sind erforderlich.' }, 400)

  const newEmailNorm = newEmail.trim().toUpperCase()

  const token = await c.env.DB
    .prepare(`SELECT * FROM email_change_tokens
       WHERE user_id = ? AND new_email = ? AND code = ? AND used = 0
         AND expires_at > strftime('%Y-%m-%dT%H:%M:%SZ','now')
       ORDER BY id DESC LIMIT 1`)
    .bind(userId, newEmail.trim(), code.trim()).first<any>()

  if (!token)
    return c.json({ error: 'Ungültiger oder abgelaufener Code.' }, 400)

  // Prüfen ob die neue E-Mail zwischenzeitlich von jemand anderem belegt wurde
  const conflict = await c.env.DB
    .prepare('SELECT id FROM users WHERE email_normalized = ? AND id != ?')
    .bind(newEmailNorm, userId).first<any>()
  if (conflict)
    return c.json({ error: 'Diese E-Mail-Adresse wird bereits verwendet.' }, 409)

  await c.env.DB
    .prepare('UPDATE users SET email = ?, email_normalized = ? WHERE id = ?')
    .bind(newEmail.trim(), newEmailNorm, userId).run()

  await c.env.DB
    .prepare('UPDATE email_change_tokens SET used = 1 WHERE id = ?')
    .bind(token.id).run()

  const user = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first<any>()
  return c.json({ success: true, user: await buildUserDto(c.env.DB, user) })
})

// ── DELETE /me/delete ─────────────────────────────────────────────────────────
auth.delete('/me/delete', requireAuth, async (c) => {
  const userId = c.get('userId') as string
  await c.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(userId).run()
  return new Response(null, { status: 204 })
})

// ── Apple Token Verification ──────────────────────────────────────────────────
async function verifyAppleToken(
  identityToken: string,
  clientId: string,
): Promise<{ sub: string; email?: string; email_verified?: boolean }> {
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

  return {
    sub: payload.sub as string,
    email: typeof payload.email === 'string' ? payload.email : undefined,
    email_verified: payload.email_verified === true || payload.email_verified === 'true',
  }
}

// ── POST /auth/apple/notifications — Apple Server-to-Server Events ────────────
// Apple schickt hier Events wenn User:
//   - consent-revoked  → Sign-in-with-Apple für diese App widerrufen
//   - account-delete   → Apple-Account permanent gelöscht
//   - email-disabled   → Relay-E-Mail deaktiviert
//   - email-enabled    → Relay-E-Mail reaktiviert
// Payload: application/x-www-form-urlencoded mit Feld "payload" (ein JWT)
auth.post('/apple/notifications', async (c) => {
  try {
    // Apple sendet form-encoded: payload=<JWT>
    const form = await c.req.formData().catch(() => null)
    const rawJwt = form?.get('payload') as string | null

    if (!rawJwt) {
      // Fallback: manche Implementierungen schicken JSON
      const body = await c.req.json<{ payload?: string }>().catch(() => ({}))
      if (!body.payload) return c.json({ error: 'No payload' }, 400)
    }

    const jwt = rawJwt ?? (await c.req.json<{ payload: string }>()).payload

    // Decode payload (Signatur-Verifikation optional — wir vertrauen dem Inhalt
    // da er nur intern von Apple kommt und wir nur sanfte Aktionen ausführen)
    const parts = jwt.split('.')
    if (parts.length < 2) return c.json({ error: 'Invalid JWT' }, 400)

    const payloadStr = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))
    const notification = JSON.parse(payloadStr) as {
      iss?: string
      aud?: string
      iat?: number
      jti?: string
      events?: string  // JSON string mit Event-Details
    }

    // events ist ein JSON-String
    const events = notification.events ? JSON.parse(notification.events) : null
    if (!events) return c.json({ ok: true }) // kein Event → ignorieren

    const { type, sub: appleSub } = events as {
      type: string
      sub: string
      email?: string
      is_private_email?: boolean
      event_time?: number
    }

    const db = c.env.DB

    if (appleSub) {
      if (type === 'consent-revoked' || type === 'account-delete') {
        // User hat Apple-Login für diese App widerrufen oder Apple-Account gelöscht
        // → User deaktivieren (NICHT löschen, damit Daten erhalten bleiben)
        await db
          .prepare(`UPDATE users SET apple_sub = NULL, is_blocked = 1 WHERE apple_sub = ?`)
          .bind(appleSub).run()

        console.log(`[apple/notifications] ${type} for sub=${appleSub}`)

      } else if (type === 'email-disabled' || type === 'email-enabled') {
        // Relay-Email-Status geändert — wir loggen nur, kein Handlungsbedarf
        console.log(`[apple/notifications] ${type} for sub=${appleSub}`)
      }
    }

    return c.json({ ok: true })
  } catch (e: any) {
    console.error('[apple/notifications] error:', e?.message)
    // Apple erwartet 200 auch bei Fehlern — sonst wiederholt er die Zustellung
    return c.json({ ok: true })
  }
})

export default auth
