// ── Email via Resend (free 3000/Monat, made for Workers) ──────────────────────
// Setup: https://resend.com → Domain hinzufügen → DNS in Cloudflare → API-Key
// Docs:  https://resend.com/docs/api-reference/emails/send-email
//
// I18N: Alle Helfer akzeptieren optional `lang: 'de' | 'en'`. Default ist 'de'
// damit existierende Aufrufer weiter funktionieren. Englische Subscriber
// erhalten ihre E-Mails automatisch in EN sobald der jeweilige Aufrufer den
// `users.language`-Wert mitgibt.

export type Lang = 'de' | 'en'

/// Normalisiert beliebige Locale-Strings ('en-US', 'EN', 'eng') auf 'de'/'en'.
export function pickLang(raw: string | undefined | null): Lang {
  if (!raw) return 'de'
  return raw.toLowerCase().startsWith('en') ? 'en' : 'de'
}

interface SendParams {
  to:        string
  toName?:   string
  subject:   string
  html:      string
  text?:     string   // Plain-text fallback — wichtig für iOS Auto-Code-Detection!
  from:      string
  fromName:  string
  apiKey?:   string   // Resend API key (passed from route via env)

  // ── Optionales DB-Logging ──────────────────────────────────────────────
  // Wird gesetzt wenn der Worker Zugriff auf D1 hat → Email landet in
  // mail_logs (mit Status sent/failed) für das Admin-Dashboard-Audit.
  db?:           D1Database
  templateKey?:  string        // 'welcome', 'verifyEmail', etc. oder 'manual'
  userId?:       string        // optionale User-Verknüpfung
  triggeredBy?:  string        // Admin-User-ID bei manuellem Versand
}

/// Resolve a template against the DB override layer. Returns null if no
/// override exists — caller should then use the hardcoded default.
export async function loadTemplateOverride(
  db: D1Database,
  key: string,
): Promise<{ subject: string; html: string; text?: string } | null> {
  try {
    const row = await db
      .prepare(`SELECT subject, html, text FROM mail_templates WHERE template_key = ?`)
      .bind(key)
      .first<{ subject: string; html: string; text: string | null }>()
    if (!row) return null
    return {
      subject: row.subject,
      html:    row.html,
      text:    row.text ?? undefined,
    }
  } catch {
    return null   // mail_templates table may not exist yet (pre-migration)
  }
}

/// Replaces `{{name}}`, `{{code}}`, etc. in template HTML/Text/Subject.
export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? '')
}

/** Escape HTML to prevent XSS in email templates */
function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Validate email format */
function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

export async function sendEmail(params: SendParams): Promise<boolean> {
  // ── Validation ────────────────────────────────────────────────────────────
  if (!params.apiKey) {
    console.error('[email] ❌ RESEND_API_KEY missing — secret not set or not deployed')
    return false
  }
  if (!params.apiKey.startsWith('re_')) {
    console.error(`[email] ❌ Invalid Resend API key format (must start with "re_"): ${params.apiKey.slice(0, 6)}...`)
    return false
  }
  if (!isValidEmail(params.to)) {
    console.error(`[email] ❌ Invalid TO email: "${params.to}"`)
    return false
  }
  if (!isValidEmail(params.from)) {
    console.error(`[email] ❌ Invalid FROM email: "${params.from}"`)
    return false
  }
  if (!params.subject || !params.html) {
    console.error('[email] ❌ Subject or HTML body is empty')
    return false
  }

  console.log(`[email] → Sending to ${params.to} (subject: "${params.subject.slice(0, 50)}")`)

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${params.apiKey}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        from:    `${params.fromName} <${params.from}>`,
        to:      [params.to],
        subject: params.subject,
        html:    params.html,
        ...(params.text ? { text: params.text } : {}),
      }),
    })

    const responseText = await res.text().catch(() => '')

    if (res.status >= 200 && res.status < 300) {
      console.log(`[email] ✅ Sent successfully (Resend ID: ${responseText.slice(0, 100)})`)
      await logMailAttempt(params, 'sent', undefined, responseText.slice(0, 200))
      return true
    }

    // Detailed error diagnostics
    let hint = ''
    if (res.status === 401) hint = ' → API-Key ungültig oder gelöscht'
    if (res.status === 403) hint = ' → Domain in Resend nicht verifiziert ODER FROM-Email passt nicht zur Domain'
    if (res.status === 422) hint = ' → Ungültige Daten (FROM/TO/Subject prüfen)'
    if (res.status === 429) hint = ' → Rate-Limit erreicht (Free: 100/Tag, 2/Sek)'

    console.error(`[email] ❌ Resend ${res.status}${hint}\nFROM: ${params.from}\nTO: ${params.to}\nResponse: ${responseText}`)
    await logMailAttempt(params, 'failed', `Resend ${res.status}${hint}: ${responseText.slice(0, 300)}`, undefined)
    return false
  } catch (e: any) {
    console.error(`[email] ❌ Exception during fetch: ${e?.message}\nStack: ${e?.stack}`)
    await logMailAttempt(params, 'failed', `Exception: ${e?.message ?? 'unknown'}`, undefined)
    return false
  }
}

/// Schreibt einen Audit-Eintrag in mail_logs — fail-silent damit Email-Send
/// nicht durch Logging-Fehler kippt.
async function logMailAttempt(
  params: SendParams,
  status: 'sent' | 'failed',
  errorMessage: string | undefined,
  resendId: string | undefined,
): Promise<void> {
  if (!params.db) return
  try {
    await params.db
      .prepare(`INSERT INTO mail_logs
        (template_key, to_email, to_name, from_email, subject,
         status, error_message, resend_id, user_id, triggered_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        params.templateKey ?? 'unknown',
        params.to,
        params.toName ?? null,
        params.from,
        params.subject,
        status,
        errorMessage ?? null,
        resendId ?? null,
        params.userId ?? null,
        params.triggeredBy ?? null,
      )
      .run()
  } catch (e: any) {
    console.warn('[email] mail_logs insert failed:', e?.message)
  }
}

// ── Plain-Text-Versionen — iOS erkennt Codes hier zuverlässiger ──────────────

/** Plain-text version: Apple Mail QuickType Bar findet "Your code is XXXXXX" Pattern */
export function verifyEmailText(code: string, displayName: string, lang: Lang = 'de'): string {
  if (lang === 'en') {
    return `Hi ${displayName},

your CustoSoft verification code is: ${code}

Enter this code in the app. It's valid for 60 minutes.

— CustoSoft Team`
  }
  return `Hallo ${displayName},

dein CustoSoft-Bestätigungscode lautet: ${code}

Your CustoSoft verification code is: ${code}

Gib diesen Code in der App ein. Er ist 60 Minuten gültig.

— CustoSoft Team`
}

export function passwordResetText(resetUrl: string, displayName: string): string {
  return `Hallo ${displayName},

du hast eine Passwort-Zurücksetzung angefordert.
Klicke hier um ein neues Passwort zu setzen (60 Min gültig):

${resetUrl}

Falls du das nicht warst, kannst du diese Mail ignorieren.

— CustoSoft Team`
}

export function purchaseConfirmationText(name: string, productName: string, priceFormatted: string, isSubscription: boolean): string {
  return `Hallo ${name},

vielen Dank für deinen Kauf!

Produkt:    ${productName}
Preis:      ${priceFormatted}
Datum:      ${new Date().toLocaleDateString('de-DE', { day: '2-digit', month: 'long', year: 'numeric' })}
${isSubscription ? '\nDieses Abonnement verlängert sich automatisch.\nVerwaltung in den iPhone-Einstellungen → Apple-ID → Abonnements.\n' : ''}
Die Funktion ist sofort in deiner App freigeschaltet. 🎉

Bei Fragen oder für Refunds wende dich an:
• Apple App Store: https://reportaproblem.apple.com
• CustoSoft Support: taironic.media@gmail.com

Beste Grüße
Dein CustoSoft Team

—
CustoSoft · David Schroedinger
https://custosoftcustomers.com`
}

export function purchaseConfirmationHtml(name: string, productName: string, priceFormatted: string, isSubscription: boolean): string {
  const safeName    = escapeHtml(name)
  const safeProduct = escapeHtml(productName)
  const safePrice   = escapeHtml(priceFormatted)
  const dateStr     = new Date().toLocaleDateString('de-DE', { day: '2-digit', month: 'long', year: 'numeric' })

  return `<!DOCTYPE html>
<html lang="de"><head><meta charset="UTF-8">
<style>
  body{margin:0;padding:0;background:#0a0a14;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
  .wrap{max-width:540px;margin:40px auto;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.10);border-radius:24px;overflow:hidden}
  .hero{background:linear-gradient(135deg,#26d670,#0d9852);padding:42px 32px;text-align:center}
  .hero .check{font-size:54px;display:block;margin-bottom:8px}
  .hero h1{color:#fff;font-size:24px;font-weight:700;margin:0}
  .hero p{color:rgba(255,255,255,0.85);margin:6px 0 0;font-size:14px}
  .body{padding:30px 32px}
  .receipt{background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.10);border-radius:14px;padding:18px;margin:16px 0}
  .row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.07)}
  .row:last-child{border-bottom:none}
  .row .key{color:rgba(255,255,255,0.50);font-size:13px}
  .row .val{color:#fff;font-size:14px;font-weight:600}
  .note{background:rgba(102,34,204,0.15);border:1px solid rgba(102,34,204,0.30);border-radius:10px;padding:14px;font-size:13px;color:rgba(255,255,255,0.75);margin:18px 0}
  .footer{padding:18px 32px;border-top:1px solid rgba(255,255,255,0.07);text-align:center;color:rgba(255,255,255,0.30);font-size:11px}
  .footer a{color:rgba(255,255,255,0.50);text-decoration:none}
</style></head>
<body>
<div class="wrap">
  <div class="hero">
    <span class="check">✓</span>
    <h1>Vielen Dank für deinen Kauf!</h1>
    <p>Bestätigung deiner Bestellung</p>
  </div>
  <div class="body">
    <p style="color:rgba(255,255,255,0.75);font-size:15px;margin:0 0 16px">Hallo ${safeName},</p>
    <p style="color:rgba(255,255,255,0.65);font-size:14px;margin:0 0 8px">deine Bestellung ist bei uns angekommen — die Funktion ist <strong style="color:#26d670">sofort</strong> in deiner App freigeschaltet. 🎉</p>
    <div class="receipt">
      <div class="row"><span class="key">Produkt</span><span class="val">${safeProduct}</span></div>
      <div class="row"><span class="key">Preis</span><span class="val">${safePrice}</span></div>
      <div class="row"><span class="key">Datum</span><span class="val">${dateStr}</span></div>
    </div>
    ${isSubscription ? `<div class="note"><strong>🔄 Auto-Renewable Subscription</strong><br>Verlängerung & Kündigung in den iPhone-Einstellungen → Apple-ID → Abonnements.</div>` : ''}
    <p style="color:rgba(255,255,255,0.55);font-size:13px;margin-top:18px">Bei Fragen oder für Refunds:<br>
    • <a href="https://reportaproblem.apple.com" style="color:#7790ff">Apple App Store Refund</a><br>
    • <a href="mailto:taironic.media@gmail.com" style="color:#7790ff">taironic.media@gmail.com</a></p>
  </div>
  <div class="footer">
    CustoSoft · David Schroedinger ·
    <a href="https://custosoftcustomers.com/impressum">Impressum</a> ·
    <a href="https://custosoftcustomers.com/agb">AGB</a>
  </div>
</div>
</body></html>`
}

export function welcomeEmailText(displayName: string, lang: Lang = 'de'): string {
  if (lang === 'en') {
    return `Hi ${displayName},

welcome to CustoSoft! 🎉

You can now start using:
• Group Chat — team groups & direct messages
• Punch Clock — time tracking with statistics
• Files — digital employee records
• Recruitment — job links & applications
• Wall Punch Clock — iPad terminal for the org

Try all features 14 days free!

— CustoSoft Team`
  }
  return `Hallo ${displayName},

herzlich willkommen bei CustoSoft! 🎉

Du kannst jetzt loslegen mit:
• Gruppen-Chat — Team-Gruppen & Direktnachrichten
• Stempeluhr — Zeiterfassung mit Statistiken
• Akten-System — digitale Mitarbeiterakten
• Bewerbungsmanager — Stellen-Links & Bewerbungen
• Wand-Stempeluhr — iPad-Terminal für die Org

Alle Features 14 Tage gratis testen!

— CustoSoft Team`
}

// ── Email Templates (HTML, alle Texte HTML-escaped gegen XSS) ────────────────

export function verifyEmailHtml(code: string, displayName: string, lang: Lang = 'de'): string {
  const safeName = escapeHtml(displayName)
  const safeCode = escapeHtml(code)
  const t = lang === 'en' ? {
    htmlLang:    'en',
    sub:         'Confirm your email address',
    greet:       `Hi ${safeName},`,
    intro:       `Enter this code in the app to verify your email. It's valid for 60 minutes.`,
    note:        `If you didn't request this email, you can safely ignore it.`,
    footer:      `CustoSoft · Your digital work tool`,
  } : {
    htmlLang:    'de',
    sub:         'Deine E-Mail-Adresse bestätigen',
    greet:       `Hallo ${safeName},`,
    intro:       `gib diesen Code in der App ein, um deine E-Mail zu bestätigen. Er ist 60 Minuten gültig.`,
    note:        `Wenn du diese E-Mail nicht angefordert hast, kannst du sie einfach ignorieren.`,
    footer:      `CustoSoft · Dein digitales Arbeits-Tool`,
  }
  return `<!DOCTYPE html>
<html lang="${t.htmlLang}"><head><meta charset="UTF-8">
<style>
  body{margin:0;padding:0;background:#0a0a14;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
  .wrap{max-width:540px;margin:40px auto;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.10);border-radius:24px;overflow:hidden}
  .hero{background:linear-gradient(135deg,#6622cc,#4411aa);padding:40px 32px;text-align:center}
  .hero h1{color:#fff;font-size:28px;font-weight:700;margin:0 0 8px}
  .hero p{color:rgba(255,255,255,0.70);margin:0;font-size:15px}
  .body{padding:32px}
  .code{background:rgba(102,34,204,0.25);border:1px solid rgba(102,34,204,0.50);border-radius:16px;padding:24px;text-align:center;font-size:42px;font-weight:700;letter-spacing:12px;color:#c594ff;margin:24px 0}
  .note{color:rgba(255,255,255,0.45);font-size:13px;text-align:center;margin-top:16px}
  .footer{padding:20px 32px;border-top:1px solid rgba(255,255,255,0.07);text-align:center;color:rgba(255,255,255,0.25);font-size:12px}
</style></head>
<body>
<div class="wrap">
  <div class="hero">
    <h1>CustoSoft</h1>
    <p>${t.sub}</p>
  </div>
  <div class="body">
    <p style="color:rgba(255,255,255,0.75);font-size:15px;margin:0 0 8px">${t.greet}</p>
    <p style="color:rgba(255,255,255,0.55);font-size:14px;margin:0 0 24px">${t.intro}</p>
    <div class="code">${safeCode}</div>
    <p class="note">${t.note}</p>
  </div>
  <div class="footer">${t.footer}</div>
</div>
</body></html>`
}

export function passwordResetHtml(resetUrl: string, displayName: string): string {
  const safeName = escapeHtml(displayName)
  const safeUrl  = escapeHtml(resetUrl)
  return `<!DOCTYPE html>
<html lang="de"><head><meta charset="UTF-8">
<style>
  body{margin:0;padding:0;background:#0a0a14;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
  .wrap{max-width:540px;margin:40px auto;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.10);border-radius:24px;overflow:hidden}
  .hero{background:linear-gradient(135deg,#cc2244,#881133);padding:40px 32px;text-align:center}
  .hero h1{color:#fff;font-size:28px;font-weight:700;margin:0 0 8px}
  .btn{display:inline-block;background:linear-gradient(135deg,#cc2244,#881133);color:#fff;text-decoration:none;padding:16px 36px;border-radius:14px;font-weight:600;font-size:15px;margin:24px 0}
  .body{padding:32px;text-align:center}
  .footer{padding:20px 32px;border-top:1px solid rgba(255,255,255,0.07);text-align:center;color:rgba(255,255,255,0.25);font-size:12px}
</style></head>
<body>
<div class="wrap">
  <div class="hero"><h1>Passwort zurücksetzen</h1></div>
  <div class="body">
    <p style="color:rgba(255,255,255,0.75);font-size:15px">Hallo ${safeName},</p>
    <p style="color:rgba(255,255,255,0.55);font-size:14px">du hast eine Passwort-Zurücksetzung angefordert. Klicke auf den Button — der Link ist 60 Minuten gültig.</p>
    <a class="btn" href="${safeUrl}">Passwort zurücksetzen</a>
    <p style="color:rgba(255,255,255,0.35);font-size:12px">Oder kopiere diesen Link:<br><span style="color:#c594ff">${safeUrl}</span></p>
  </div>
  <div class="footer">CustoSoft · Wenn du das nicht angefordert hast, ignoriere diese Mail.</div>
</div>
</body></html>`
}

export function welcomeEmailHtml(displayName: string, lang: Lang = 'de'): string {
  const safeName = escapeHtml(displayName)
  const products = lang === 'en' ? [
    { icon: '💬', name: 'Group Chat',       desc: 'Team groups & direct messages' },
    { icon: '🕐', name: 'Punch Clock',      desc: 'Time tracking with statistics' },
    { icon: '📁', name: 'Files',            desc: 'Digital employee records' },
    { icon: '📋', name: 'Recruitment',      desc: 'Job links & applications' },
    { icon: '🖥',  name: 'Wall Punch Clock', desc: 'iPad terminal for the org' },
  ] : [
    { icon: '💬', name: 'Gruppen-Chat',      desc: 'Team-Gruppen & Direktnachrichten' },
    { icon: '🕐', name: 'Stempeluhr',         desc: 'Zeiterfassung mit Statistiken' },
    { icon: '📁', name: 'Akten-System',       desc: 'Digitale Mitarbeiterakten' },
    { icon: '📋', name: 'Bewerbungsmanager',  desc: 'Stellen-Links & Bewerbungen' },
    { icon: '🖥',  name: 'Wand-Stempeluhr',   desc: 'iPad-Terminal für die Org' },
  ]
  const rows = products.map(p =>
    `<tr><td style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.07)">
      <span style="font-size:22px">${p.icon}</span>
      <span style="color:#fff;font-weight:600;margin-left:10px">${p.name}</span>
      <span style="color:rgba(255,255,255,0.45);margin-left:8px;font-size:13px">— ${p.desc}</span>
    </td></tr>`).join('')

  return `<!DOCTYPE html>
<html lang="de"><head><meta charset="UTF-8">
<style>
  body{margin:0;padding:0;background:#0a0a14;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
  .wrap{max-width:540px;margin:40px auto;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.10);border-radius:24px;overflow:hidden}
  .hero{background:linear-gradient(135deg,#6622cc,#4411aa);padding:48px 32px;text-align:center}
  .body{padding:32px}
  .footer{padding:20px 32px;border-top:1px solid rgba(255,255,255,0.07);text-align:center;color:rgba(255,255,255,0.25);font-size:12px}
</style></head>
<body>
<div class="wrap">
  <div class="hero">
    <p style="font-size:48px;margin:0 0 12px">🎉</p>
    <h1 style="color:#fff;font-size:28px;margin:0 0 8px;font-weight:700">${lang === 'en' ? 'Welcome to CustoSoft!' : 'Willkommen bei CustoSoft!'}</h1>
    <p style="color:rgba(255,255,255,0.65);margin:0">${lang === 'en' ? 'Your digital work tool' : 'Dein digitales Arbeits-Tool'}</p>
  </div>
  <div class="body">
    <p style="color:rgba(255,255,255,0.75);font-size:15px">${lang === 'en' ? `Hi ${safeName},<br><br>great to have you on board! Here's what's waiting:` : `Hallo ${safeName},<br><br>schön, dass du dabei bist! Hier ist was dich erwartet:`}</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0">${rows}</table>
    <p style="color:rgba(255,255,255,0.50);font-size:13px">${lang === 'en' ? 'Try all features 14 days free.' : 'Alle Features sind 14 Tage kostenlos testbar.'}</p>
  </div>
  <div class="footer">CustoSoft · ${lang === 'en' ? 'Your digital work tool' : 'Dein digitales Arbeits-Tool'}</div>
</div>
</body></html>`
}

// ── Subscription Expiring Soon ────────────────────────────────────────────────

export function subscriptionExpiringSoonText(
  name: string, productName: string, daysLeft: number, expiresAt: string
): string {
  const dateStr = new Date(expiresAt).toLocaleDateString('de-DE', {
    day: '2-digit', month: 'long', year: 'numeric',
  })
  const daysStr = daysLeft === 1 ? '1 Tag' : `${daysLeft} Tagen`
  return `Hallo ${name},

dein Abo für ${productName} läuft in ${daysStr} ab (${dateStr}).

Verlängerung & Kündigung in den iPhone-Einstellungen → Apple-ID → Abonnements.
Das Abo verlängert sich automatisch, sofern du es nicht bis 24 h vor Ablauf kündigst.

— CustoSoft Team`
}

export function subscriptionExpiringSoonHtml(
  name: string, productName: string, daysLeft: number, expiresAt: string
): string {
  const safeName    = escapeHtml(name)
  const safeProduct = escapeHtml(productName)
  const dateStr = new Date(expiresAt).toLocaleDateString('de-DE', {
    day: '2-digit', month: 'long', year: 'numeric',
  })
  const daysStr      = daysLeft === 1 ? '1 Tag' : `${daysLeft} Tagen`
  const urgentColor  = daysLeft <= 1 ? '#ef4444' : daysLeft <= 3 ? '#f97316' : '#f59e0b'
  return `<!DOCTYPE html>
<html lang="de"><head><meta charset="UTF-8"><style>
  body{margin:0;padding:0;background:#0a0a14;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
  .wrap{max-width:540px;margin:40px auto;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.10);border-radius:24px;overflow:hidden}
  .hero{background:linear-gradient(135deg,#92400e,#b45309);padding:36px 32px;text-align:center}
  .body{padding:30px 32px}
  .badge{display:inline-block;background:${urgentColor}22;border:1px solid ${urgentColor}66;border-radius:10px;padding:12px 20px;font-size:18px;font-weight:700;color:${urgentColor};margin:16px 0}
  .info{background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.10);border-radius:12px;padding:16px;margin:16px 0}
  .footer{padding:18px 32px;border-top:1px solid rgba(255,255,255,0.07);text-align:center;color:rgba(255,255,255,0.30);font-size:11px}
</style></head>
<body><div class="wrap">
  <div class="hero">
    <p style="font-size:40px;margin:0 0 8px">⏰</p>
    <h1 style="color:#fff;font-size:22px;margin:0;font-weight:700">Dein Abo läuft bald ab</h1>
  </div>
  <div class="body">
    <p style="color:rgba(255,255,255,0.75);font-size:15px;margin:0 0 12px">Hallo ${safeName},</p>
    <p style="color:rgba(255,255,255,0.65);font-size:14px;margin:0 0 8px">
      dein Abo für <strong style="color:#fff">${safeProduct}</strong> läuft ab:
    </p>
    <div class="badge">In ${daysStr} · ${dateStr}</div>
    <div class="info">
      <p style="margin:0;color:rgba(255,255,255,0.55);font-size:13px;line-height:1.6">
        📱 <strong style="color:rgba(255,255,255,0.80)">Verlängerung &amp; Kündigung</strong><br>
        iPhone-Einstellungen → Apple-ID → Abonnements<br>
        <span style="font-size:11px;opacity:0.7">Das Abo verlängert sich automatisch, sofern du es nicht bis 24 h vor Ablauf kündigst.</span>
      </p>
    </div>
  </div>
  <div class="footer">CustoSoft · Automatische System-Nachricht</div>
</div></body></html>`
}

// ── Subscription Ended ────────────────────────────────────────────────────────

export function subscriptionEndedText(
  name: string, productName: string, endedAt: string
): string {
  const dateStr = new Date(endedAt).toLocaleDateString('de-DE', {
    day: '2-digit', month: 'long', year: 'numeric',
  })
  return `Hallo ${name},

dein Abo für ${productName} ist am ${dateStr} abgelaufen.

Deine Daten (Stempelzeiten, Akten, Chats) bleiben erhalten — du kannst sie sofort wieder nutzen, sobald du erneut abonnierst.

Shop in der App → Kaufoptionen → Abo erneuern.

— CustoSoft Team`
}

export function subscriptionEndedHtml(
  name: string, productName: string, endedAt: string
): string {
  const safeName    = escapeHtml(name)
  const safeProduct = escapeHtml(productName)
  const dateStr = new Date(endedAt).toLocaleDateString('de-DE', {
    day: '2-digit', month: 'long', year: 'numeric',
  })
  return `<!DOCTYPE html>
<html lang="de"><head><meta charset="UTF-8"><style>
  body{margin:0;padding:0;background:#0a0a14;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
  .wrap{max-width:540px;margin:40px auto;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.10);border-radius:24px;overflow:hidden}
  .hero{background:linear-gradient(135deg,#7f1d1d,#991b1b);padding:36px 32px;text-align:center}
  .body{padding:30px 32px}
  .info-box{background:rgba(102,34,204,0.12);border:1px solid rgba(102,34,204,0.30);border-radius:12px;padding:16px;margin:16px 0}
  .footer{padding:18px 32px;border-top:1px solid rgba(255,255,255,0.07);text-align:center;color:rgba(255,255,255,0.30);font-size:11px}
  .footer a{color:rgba(255,255,255,0.45);text-decoration:none}
  .btn{display:inline-block;background:linear-gradient(135deg,#6622cc,#4411aa);color:#fff;text-decoration:none;padding:12px 28px;border-radius:12px;font-size:14px;font-weight:600}
</style></head>
<body><div class="wrap">
  <div class="hero">
    <p style="font-size:40px;margin:0 0 8px">📦</p>
    <h1 style="color:#fff;font-size:22px;margin:0;font-weight:700">Abo abgelaufen</h1>
    <p style="color:rgba(255,255,255,0.70);font-size:13px;margin:6px 0 0">Bis bald, ${safeName}!</p>
  </div>
  <div class="body">
    <p style="color:rgba(255,255,255,0.75);font-size:15px;margin:0 0 12px">
      Dein Abo für <strong style="color:#fff">${safeProduct}</strong> ist am <strong>${dateStr}</strong> abgelaufen.
    </p>
    <div class="info-box">
      <p style="margin:0;color:rgba(255,255,255,0.70);font-size:13px;line-height:1.6">
        📁 <strong style="color:#fff">Deine Daten bleiben erhalten</strong><br>
        Stempelzeiten, Akten und Chats sind weiterhin sicher gespeichert.<br>
        Sobald du erneut abonnierst, hast du sofort wieder vollen Zugriff.
      </p>
    </div>
    <div style="text-align:center;padding:16px 0">
      <a class="btn" href="https://apps.apple.com/de/app/custosoft">Jetzt erneuern</a>
    </div>
  </div>
  <div class="footer">
    CustoSoft ·
    <a href="https://custosoftcustomers.com/datenschutz">Datenschutz</a> ·
    <a href="https://custosoftcustomers.com/impressum">Impressum</a>
  </div>
</div></body></html>`
}

// ── E-Mail-Adresse ändern ─────────────────────────────────────────────────────

export function changeEmailText(code: string, newEmail: string, displayName: string): string {
  return `Hallo ${displayName},

du hast eine Änderung deiner E-Mail-Adresse beantragt.
Neue E-Mail: ${newEmail}

Dein Bestätigungscode lautet: ${code}

Your verification code to change your email is: ${code}

Gib diesen Code in der App ein. Er ist 60 Minuten gültig.
Falls du das nicht warst, kannst du diese E-Mail ignorieren.

— CustoSoft Team`
}

export function changeEmailHtml(code: string, newEmail: string, displayName: string): string {
  const safeName  = escapeHtml(displayName)
  const safeCode  = escapeHtml(code)
  const safeEmail = escapeHtml(newEmail)
  return `<!DOCTYPE html>
<html lang="de"><head><meta charset="UTF-8">
<style>
  body{margin:0;padding:0;background:#0a0a14;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
  .wrap{max-width:540px;margin:40px auto;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.10);border-radius:24px;overflow:hidden}
  .hero{background:linear-gradient(135deg,#1a7adb,#0d55aa);padding:40px 32px;text-align:center}
  .hero h1{color:#fff;font-size:28px;font-weight:700;margin:0 0 8px}
  .hero p{color:rgba(255,255,255,0.70);margin:0;font-size:15px}
  .body{padding:32px}
  .code{background:rgba(26,122,219,0.20);border:1px solid rgba(26,122,219,0.45);border-radius:16px;padding:24px;text-align:center;font-size:42px;font-weight:700;letter-spacing:12px;color:#6eb6ff;margin:24px 0}
  .email-box{background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.10);border-radius:12px;padding:14px 18px;font-family:monospace;font-size:14px;color:rgba(255,255,255,0.70);margin-bottom:24px;text-align:center}
  .note{color:rgba(255,255,255,0.45);font-size:13px;text-align:center;margin-top:16px}
  .footer{padding:20px 32px;border-top:1px solid rgba(255,255,255,0.07);text-align:center;color:rgba(255,255,255,0.25);font-size:12px}
</style></head>
<body>
<div class="wrap">
  <div class="hero">
    <h1>CustoSoft</h1>
    <p>E-Mail-Adresse ändern</p>
  </div>
  <div class="body">
    <p style="color:rgba(255,255,255,0.75);font-size:15px;margin:0 0 8px">Hallo ${safeName},</p>
    <p style="color:rgba(255,255,255,0.55);font-size:14px;margin:0 0 16px">du möchtest deine E-Mail-Adresse ändern zu:</p>
    <div class="email-box">${safeEmail}</div>
    <p style="color:rgba(255,255,255,0.55);font-size:14px;margin:0 0 4px">Gib diesen Code in der App ein (60 Min gültig):</p>
    <div class="code">${safeCode}</div>
    <p class="note">Falls du das nicht warst, kannst du diese E-Mail einfach ignorieren.</p>
  </div>
  <div class="footer">CustoSoft · Dein digitales Arbeits-Tool</div>
</div>
</body></html>`
}
