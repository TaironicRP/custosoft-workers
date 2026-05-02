// ── Email via Resend (free 3000/Monat, made for Workers) ──────────────────────
// Setup: https://resend.com → Domain hinzufügen → DNS in Cloudflare → API-Key
// Docs:  https://resend.com/docs/api-reference/emails/send-email

interface SendParams {
  to:        string
  toName?:   string
  subject:   string
  html:      string
  text?:     string   // Plain-text fallback — wichtig für iOS Auto-Code-Detection!
  from:      string
  fromName:  string
  apiKey?:   string   // Resend API key (passed from route via env)
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
      return true
    }

    // Detailed error diagnostics
    let hint = ''
    if (res.status === 401) hint = ' → API-Key ungültig oder gelöscht'
    if (res.status === 403) hint = ' → Domain in Resend nicht verifiziert ODER FROM-Email passt nicht zur Domain'
    if (res.status === 422) hint = ' → Ungültige Daten (FROM/TO/Subject prüfen)'
    if (res.status === 429) hint = ' → Rate-Limit erreicht (Free: 100/Tag, 2/Sek)'

    console.error(`[email] ❌ Resend ${res.status}${hint}\nFROM: ${params.from}\nTO: ${params.to}\nResponse: ${responseText}`)
    return false
  } catch (e: any) {
    console.error(`[email] ❌ Exception during fetch: ${e?.message}\nStack: ${e?.stack}`)
    return false
  }
}

// ── Plain-Text-Versionen — iOS erkennt Codes hier zuverlässiger ──────────────

/** Plain-text version: Apple Mail QuickType Bar findet "Your code is XXXXXX" Pattern */
export function verifyEmailText(code: string, displayName: string): string {
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

export function welcomeEmailText(displayName: string): string {
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

export function verifyEmailHtml(code: string, displayName: string): string {
  const safeName = escapeHtml(displayName)
  const safeCode = escapeHtml(code)
  return `<!DOCTYPE html>
<html lang="de"><head><meta charset="UTF-8">
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
    <p>Deine E-Mail-Adresse bestätigen</p>
  </div>
  <div class="body">
    <p style="color:rgba(255,255,255,0.75);font-size:15px;margin:0 0 8px">Hallo ${safeName},</p>
    <p style="color:rgba(255,255,255,0.55);font-size:14px;margin:0 0 24px">gib diesen Code in der App ein, um deine E-Mail zu bestätigen. Er ist 60 Minuten gültig.</p>
    <div class="code">${safeCode}</div>
    <p class="note">Wenn du diese E-Mail nicht angefordert hast, kannst du sie einfach ignorieren.</p>
  </div>
  <div class="footer">CustoSoft · Dein digitales Arbeits-Tool</div>
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

export function welcomeEmailHtml(displayName: string): string {
  const safeName = escapeHtml(displayName)
  const products = [
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
    <h1 style="color:#fff;font-size:28px;margin:0 0 8px;font-weight:700">Willkommen bei CustoSoft!</h1>
    <p style="color:rgba(255,255,255,0.65);margin:0">Dein digitales Arbeits-Tool</p>
  </div>
  <div class="body">
    <p style="color:rgba(255,255,255,0.75);font-size:15px">Hallo ${safeName},<br><br>
    schön, dass du dabei bist! Hier ist was dich erwartet:</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0">${rows}</table>
    <p style="color:rgba(255,255,255,0.50);font-size:13px">Alle Features sind 14 Tage kostenlos testbar.</p>
  </div>
  <div class="footer">CustoSoft · Dein digitales Arbeits-Tool</div>
</div>
</body></html>`
}
