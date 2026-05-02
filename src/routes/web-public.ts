// ── Public Website — Marketing-Seiten + Legal (Apple Pflicht) ────────────────
import { Hono }     from 'hono'
import type { Env, AppEnv } from '../types'

const webPublic = new Hono<AppEnv>()

// Loads legal page from D1 by slug
async function loadLegal(env: Env, slug: string) {
  return env.DB.prepare('SELECT title, content FROM legal_pages WHERE slug = ?')
    .bind(slug).first<{ title: string; content: string }>()
}

// ── Landing Page ──────────────────────────────────────────────────────────────
webPublic.get('/', (c) => c.html(LANDING_HTML))

// ── Legal Pages (gemeinsames Layout) ──────────────────────────────────────────
webPublic.get('/impressum', async (c) => {
  const p = await loadLegal(c.env, 'impressum')
  return c.html(legalPageHtml('Impressum', p?.content ?? defaultImpressum()))
})

webPublic.get('/datenschutz', async (c) => {
  const p = await loadLegal(c.env, 'datenschutz')
  return c.html(legalPageHtml('Datenschutzerklärung', p?.content ?? defaultDatenschutz()))
})

webPublic.get('/agb', async (c) => {
  const p = await loadLegal(c.env, 'agb')
  return c.html(legalPageHtml('AGB', p?.content ?? defaultAGB()))
})

webPublic.get('/widerruf', async (c) => {
  const p = await loadLegal(c.env, 'widerruf')
  return c.html(legalPageHtml('Widerrufsbelehrung', p?.content ?? defaultWiderruf()))
})

// ── Apply (Bewerbungs-Link) Public Endpoint ───────────────────────────────────
webPublic.get('/apply/:code', async (c) => {
  const code = c.req.param('code')
  const link = await c.env.DB.prepare(`
    SELECT jl.*, o.name AS org_name, op.title AS position_title
    FROM job_links jl
    INNER JOIN organisations o ON o.id = jl.org_id
    LEFT JOIN org_positions op ON op.id = jl.position_id
    WHERE jl.code = ? AND jl.is_active = 1
  `).bind(code).first<any>()

  if (!link) return c.html(legalPageHtml('Bewerbung', '<p>Diese Bewerbungs-URL ist nicht (mehr) aktiv.</p>'))

  return c.html(applyPageHtml({
    orgName:   link.org_name,
    title:     link.title,
    description: link.description ?? '',
    position:  link.position_title ?? '',
    code:      link.code,
  }))
})

export default webPublic

// ═══════════════════════════════════════════════════════════════════════════
// HTML TEMPLATES
// ═══════════════════════════════════════════════════════════════════════════

const SHARED_STYLE = `
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{background:#0a0a14;color:#fff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6;-webkit-font-smoothing:antialiased}
  body::before,body::after{content:'';position:fixed;border-radius:50%;filter:blur(80px);pointer-events:none;z-index:0}
  body::before{width:600px;height:600px;background:radial-gradient(circle,rgba(120,60,255,0.40),transparent 70%);top:-200px;left:-150px}
  body::after{width:480px;height:480px;background:radial-gradient(circle,rgba(50,150,255,0.30),transparent 70%);bottom:-150px;right:-100px}
  .nav{position:sticky;top:0;background:rgba(10,10,20,0.85);backdrop-filter:blur(20px);border-bottom:1px solid rgba(255,255,255,0.08);padding:14px 24px;z-index:10}
  .nav-inner{max-width:1100px;margin:0 auto;display:flex;align-items:center;justify-content:space-between}
  .brand{display:flex;align-items:center;gap:10px;text-decoration:none;color:inherit}
  .brand .logo{width:32px;height:32px;border-radius:8px;background:linear-gradient(135deg,#7733dd,#3355ff);display:flex;align-items:center;justify-content:center;font-size:16px;box-shadow:0 6px 16px rgba(120,60,255,0.45)}
  .brand .name{font-size:16px;font-weight:700}
  .nav-links{display:flex;gap:18px}
  .nav-links a{color:rgba(255,255,255,0.65);text-decoration:none;font-size:14px;font-weight:500;transition:color 0.15s}
  .nav-links a:hover{color:#fff}
  main{position:relative;z-index:1;max-width:1100px;margin:0 auto;padding:60px 24px}
  .footer{position:relative;z-index:1;border-top:1px solid rgba(255,255,255,0.08);padding:40px 24px;text-align:center;color:rgba(255,255,255,0.50);font-size:13px;margin-top:80px}
  .footer a{color:rgba(255,255,255,0.65);text-decoration:none;margin:0 10px}
  .footer a:hover{color:#fff}
  @media (max-width:768px){.nav-links{gap:10px}.nav-links a{font-size:12px}}
`

function commonNav(): string {
  return `<nav class="nav"><div class="nav-inner">
    <a class="brand" href="/"><div class="logo">CS</div><div class="name">CustoSoft</div></a>
    <div class="nav-links">
      <a href="/">Start</a>
      <a href="/impressum">Impressum</a>
      <a href="/datenschutz">Datenschutz</a>
      <a href="/agb">AGB</a>
    </div>
  </div></nav>`
}

function commonFooter(): string {
  return `<div class="footer">
    © 2026 CustoSoft · David Schroedinger ·
    <a href="/impressum">Impressum</a>·
    <a href="/datenschutz">Datenschutz</a>·
    <a href="/agb">AGB</a>·
    <a href="/widerruf">Widerruf</a>·
    <a href="mailto:taironic.media@gmail.com">Kontakt</a>
  </div>`
}

// ── Landing Page ──────────────────────────────────────────────────────────────
const LANDING_HTML = `<!DOCTYPE html>
<html lang="de"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>CustoSoft — Dein digitales Arbeits-Tool</title>
<style>${SHARED_STYLE}
.hero{text-align:center;padding:60px 0 40px}
.hero-eyebrow{display:inline-block;background:rgba(120,60,255,0.20);border:1px solid rgba(120,60,255,0.45);padding:6px 14px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:1.5px;color:#c594ff;margin-bottom:24px}
.hero h1{font-size:clamp(36px,6vw,64px);font-weight:800;line-height:1.05;margin-bottom:18px;background:linear-gradient(135deg,#fff 0%,#c594ff 60%,#7790ff 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;letter-spacing:-1.5px}
.hero p{font-size:18px;color:rgba(255,255,255,0.65);max-width:640px;margin:0 auto 32px}
.cta-row{display:flex;gap:14px;justify-content:center;flex-wrap:wrap}
.cta{display:inline-block;padding:16px 32px;border-radius:14px;font-weight:600;font-size:15px;text-decoration:none;transition:transform 0.15s}
.cta-primary{background:linear-gradient(135deg,#7733dd,#3355ff);color:#fff;box-shadow:0 12px 32px rgba(120,60,255,0.45)}
.cta-secondary{background:rgba(255,255,255,0.06);color:#fff;border:1px solid rgba(255,255,255,0.15)}
.cta:hover{transform:translateY(-2px)}
.features{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:20px;margin:80px 0}
.feat{padding:24px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.10);border-radius:18px;backdrop-filter:blur(10px)}
.feat .ico{font-size:32px;margin-bottom:12px;display:block}
.feat h3{font-size:18px;margin-bottom:8px}
.feat p{color:rgba(255,255,255,0.55);font-size:14px}
.pricing-banner{background:linear-gradient(135deg,rgba(120,60,255,0.20),rgba(50,150,255,0.15));border:1px solid rgba(120,60,255,0.30);border-radius:24px;padding:40px;text-align:center;margin:60px 0}
.pricing-banner h2{font-size:32px;margin-bottom:8px;background:linear-gradient(135deg,#fff,#c594ff);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.pricing-banner p{color:rgba(255,255,255,0.65);font-size:16px;max-width:500px;margin:12px auto 0}
</style></head>
<body>
${commonNav()}
<main>
  <section class="hero">
    <div class="hero-eyebrow">JETZT IM APP STORE</div>
    <h1>Dein digitales Arbeits-Tool</h1>
    <p>Stempeluhr, Akten, Chat, Bewerbungsmanagement — alles in einer App.<br>Made in Germany. Hosted on Cloudflare Edge. Privacy-first.</p>
    <div class="cta-row">
      <a href="https://apps.apple.com/de/app/custosoft" class="cta cta-primary">📱 App Store</a>
      <a href="#features" class="cta cta-secondary">Mehr erfahren</a>
    </div>
  </section>

  <section id="features" class="features">
    <div class="feat"><span class="ico">🕐</span><h3>Stempeluhr</h3><p>Zeiterfassung mit Pause, Statistik, Live-Anzeige in der Dynamic Island. 14 Tage gratis.</p></div>
    <div class="feat"><span class="ico">📁</span><h3>Akten-System</h3><p>Digitale Mitarbeiterakten, Lohnabrechnungen, Verträge — alles zentral, mit Sichtbarkeits-Steuerung.</p></div>
    <div class="feat"><span class="ico">💬</span><h3>Team-Chat</h3><p>Gruppen, DMs, Info-Kanäle, Datei-Anhänge, Echtzeit-Sync. Strukturiert für Teams.</p></div>
    <div class="feat"><span class="ico">📋</span><h3>Bewerbungsmanager</h3><p>Stellen-Links erstellen, Bewerbungen sammeln, Workflow von "Neu" bis "Eingestellt".</p></div>
    <div class="feat"><span class="ico">🖥</span><h3>Wand-Stempeluhr</h3><p>Ein iPad an die Wand — Mitarbeiter stempeln per 4-stelligem PIN. Vollbild-Kiosk.</p></div>
    <div class="feat"><span class="ico">🛡️</span><h3>Privacy-First</h3><p>Daten in der EU (Cloudflare Frankfurt). DSGVO-konform. Kein Tracking, keine Werbe-IDs.</p></div>
  </section>

  <section class="pricing-banner">
    <h2>14 Tage gratis testen</h2>
    <p>Stempeluhr ab 2,99 €/2 Wochen · Business Pakete ab 49 €/Monat · Premium MAX 69 €/Monat mit allen Erweiterungen</p>
  </section>
</main>
${commonFooter()}
</body></html>`

// ── Legal Page Wrapper ────────────────────────────────────────────────────────
function legalPageHtml(title: string, content: string): string {
  return `<!DOCTYPE html>
<html lang="de"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title} · CustoSoft</title>
<style>${SHARED_STYLE}
.legal{padding:40px 0}
.legal h1{font-size:36px;margin-bottom:24px;background:linear-gradient(135deg,#fff,#c594ff);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.legal h2{font-size:22px;margin:28px 0 12px;color:#fff}
.legal h3{font-size:17px;margin:20px 0 8px;color:rgba(255,255,255,0.85)}
.legal p,.legal li{color:rgba(255,255,255,0.75);font-size:15px;margin-bottom:10px}
.legal ul,.legal ol{padding-left:22px;margin-bottom:14px}
.legal a{color:#7790ff;text-decoration:none}
.legal a:hover{text-decoration:underline}
.legal strong{color:#fff}
.legal hr{border:none;height:1px;background:rgba(255,255,255,0.12);margin:24px 0}
.legal-card{background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.10);border-radius:20px;padding:36px;backdrop-filter:blur(10px)}
</style></head>
<body>
${commonNav()}
<main class="legal">
  <h1>${title}</h1>
  <div class="legal-card">${content}</div>
</main>
${commonFooter()}
</body></html>`
}

// ── Apply Page (Bewerbungs-Public-Form) ──────────────────────────────────────
function applyPageHtml(p: { orgName: string; title: string; description: string; position: string; code: string }): string {
  return `<!DOCTYPE html>
<html lang="de"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Bewerbung · ${p.orgName}</title>
<style>${SHARED_STYLE}
.apply-card{background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.12);border-radius:24px;padding:36px;max-width:680px;margin:40px auto}
.apply-card h1{font-size:30px;margin-bottom:8px}
.apply-card .meta{color:rgba(255,255,255,0.55);font-size:14px;margin-bottom:24px}
.apply-card .desc{color:rgba(255,255,255,0.75);margin-bottom:28px;line-height:1.7}
.cta{display:inline-block;padding:14px 28px;background:linear-gradient(135deg,#7733dd,#3355ff);color:#fff;border-radius:12px;font-weight:600;text-decoration:none}
</style></head>
<body>
${commonNav()}
<main>
  <div class="apply-card">
    <h1>${p.title}</h1>
    <div class="meta">${p.orgName}${p.position ? ' · ' + p.position : ''}</div>
    <div class="desc">${p.description.replace(/\n/g, '<br>')}</div>
    <a class="cta" href="custosoft://apply/${p.code}">Direkt in der App bewerben</a>
    <p style="margin-top:20px;font-size:13px;color:rgba(255,255,255,0.40)">Du brauchst die CustoSoft-App. <a href="https://apps.apple.com/de/app/custosoft" style="color:#7790ff">Im App Store laden</a></p>
  </div>
</main>
${commonFooter()}
</body></html>`
}

// ═══════════════════════════════════════════════════════════════════════════
// Default Legal Texts (werden überschrieben sobald Admin Custom-Content speichert)
// ═══════════════════════════════════════════════════════════════════════════

function defaultImpressum(): string {
  return `
<h2>Angaben gemäß § 5 TMG</h2>
<p><strong>David Schroedinger</strong><br>
CustoSoft · Einzelunternehmen<br>
[Straße + Hausnummer]<br>
[PLZ + Ort]<br>
Deutschland</p>

<h2>Kontakt</h2>
<p>E-Mail: <a href="mailto:taironic.media@gmail.com">taironic.media@gmail.com</a><br>
Web: <a href="https://custosoftcustomers.com">custosoftcustomers.com</a></p>

<h2>Umsatzsteuer-ID</h2>
<p>Umsatzsteuer-Identifikationsnummer gemäß §27a UStG:<br>
[USt-IdNr. wird hier eingetragen]</p>

<h2>Verantwortlich für den Inhalt nach § 55 Abs. 2 RStV</h2>
<p>David Schroedinger, Anschrift wie oben.</p>

<h2>Haftung für Inhalte</h2>
<p>Als Diensteanbieter sind wir für eigene Inhalte auf diesen Seiten nach den allgemeinen Gesetzen verantwortlich (§ 7 Abs.1 TMG). Wir sind jedoch nicht verpflichtet, übermittelte oder gespeicherte fremde Informationen zu überwachen oder nach Umständen zu forschen, die auf eine rechtswidrige Tätigkeit hinweisen.</p>

<h2>Haftung für Links</h2>
<p>Unser Angebot enthält Links zu externen Websites Dritter, auf deren Inhalte wir keinen Einfluss haben. Deshalb können wir für diese fremden Inhalte auch keine Gewähr übernehmen.</p>

<p><em>Hinweis: Bitte ergänze deine vollständige Anschrift und USt-IdNr. im Admin-Backend unter „Rechtstexte".</em></p>`
}

function defaultDatenschutz(): string {
  return `
<h2>1. Verantwortlicher</h2>
<p>Verantwortlicher für die Datenverarbeitung im Sinne der DSGVO ist:<br>
David Schroedinger · CustoSoft<br>
E-Mail: <a href="mailto:taironic.media@gmail.com">taironic.media@gmail.com</a></p>

<h2>2. Welche Daten wir verarbeiten</h2>
<p>Bei Nutzung der CustoSoft-App verarbeiten wir folgende Daten:</p>
<ul>
  <li><strong>Account-Daten:</strong> E-Mail-Adresse, Vor- und Nachname, optional Profilbild</li>
  <li><strong>Anmelde-Daten:</strong> Passwort-Hash (PBKDF2-SHA256), JWT-Token, letzter Login-Zeitstempel</li>
  <li><strong>Organisations-Daten:</strong> Name, Mitglieder, Rollen, Berechtigungen</li>
  <li><strong>Stempel-Daten:</strong> Ein-/Aus-Stempel-Zeiten, Pausen, optionale Notizen</li>
  <li><strong>Akten-Daten:</strong> Vom Nutzer angelegte Mitarbeiterakten, Dokumente</li>
  <li><strong>Chat-Daten:</strong> Nachrichten, Anhänge (verschlüsselt im Cloudflare R2 Storage)</li>
  <li><strong>Zahlungsdaten:</strong> Zahlungsabwicklung erfolgt vollständig über Apple — wir erhalten nur Transaction-IDs</li>
</ul>

<h2>3. Wo deine Daten gespeichert sind</h2>
<p>Alle Daten liegen auf Servern von <strong>Cloudflare</strong> (D1 Database, R2 Object Storage) in der Region Europa. Cloudflare ist nach DSGVO Auftragsverarbeiter. Es gibt keinen Datentransfer in Drittländer ohne Angemessenheitsbeschluss.</p>

<h2>4. Rechtsgrundlage</h2>
<p>Die Verarbeitung erfolgt zur Vertragserfüllung (Art. 6 Abs. 1 lit. b DSGVO) und ggf. zur Wahrung berechtigter Interessen (Art. 6 Abs. 1 lit. f DSGVO).</p>

<h2>5. Deine Rechte</h2>
<p>Du hast das Recht auf:</p>
<ul>
  <li>Auskunft (Art. 15 DSGVO)</li>
  <li>Berichtigung (Art. 16 DSGVO)</li>
  <li><strong>Löschung</strong> (Art. 17 DSGVO) — direkt in der App: Profil → Konto löschen</li>
  <li>Einschränkung der Verarbeitung (Art. 18 DSGVO)</li>
  <li>Datenübertragbarkeit (Art. 20 DSGVO)</li>
  <li>Widerspruch (Art. 21 DSGVO)</li>
</ul>

<h2>6. Speicherdauer</h2>
<p>Wir speichern deine Daten so lange dein Account aktiv ist. Nach Konto-Löschung werden alle persönlichen Daten innerhalb von 30 Tagen unwiderruflich gelöscht.</p>

<h2>7. Push-Notifications & Tracking</h2>
<p>Wir senden Push-Notifications nur für transaktionale Zwecke (z.B. neue Chat-Nachrichten). Wir nutzen <strong>kein Werbe-Tracking</strong>, keine Drittanbieter-Analytics, keine IDFA.</p>

<h2>8. Beschwerderecht</h2>
<p>Du kannst dich bei Beschwerden an die zuständige Datenschutz-Aufsichtsbehörde wenden.</p>

<p><em>Stand: ${new Date().toISOString().slice(0, 10)}</em></p>`
}

function defaultAGB(): string {
  return `
<h2>1. Geltungsbereich</h2>
<p>Diese Allgemeinen Geschäftsbedingungen gelten für alle Verträge zwischen David Schroedinger (CustoSoft) und Nutzern der iOS-App „CustoSoft".</p>

<h2>2. Vertragsschluss</h2>
<p>Der Download der App ist kostenlos. Kostenpflichtige Erweiterungen ("In-App-Käufe") werden über das Apple App Store Konto abgerechnet. Mit dem Kauf einer Erweiterung kommt ein Vertrag zwischen dem Nutzer und Apple zustande, dessen Bedingungen der jeweiligen Apple-Vereinbarung folgen.</p>

<h2>3. Leistungsumfang</h2>
<p>CustoSoft bietet Zugriff auf:</p>
<ul>
  <li>Stempeluhr-Funktionen (Zeit­erfassung, Statistiken)</li>
  <li>Akten-System für Mitarbeiterdaten</li>
  <li>Team-Chat-Funktionen</li>
  <li>Bewerbungsmanager (iPad/Mac)</li>
  <li>Wand-Stempeluhr (iPad-Kiosk)</li>
</ul>

<h2>4. Preise & Zahlung</h2>
<p>Alle angegebenen Preise enthalten die gesetzliche Mehrwertsteuer. Die Zahlung erfolgt ausschließlich über Apple.</p>
<ul>
  <li><strong>Stempeluhr</strong>: 2,99 € / 2 Wochen · 14 Tage Trial</li>
  <li><strong>Mehr Platz</strong>: 4,99 € einmalig</li>
  <li><strong>Bewerbungsmanager</strong>: 16,99 € einmalig</li>
  <li><strong>Wand-Stempeluhr</strong>: 9,99 € einmalig</li>
  <li><strong>Business Basic</strong>: 49 €/Monat (10 Slots) · 469 €/Jahr (-20 %)</li>
  <li><strong>Business L</strong>: 89 €/Monat (50 Slots) · 849 €/Jahr (-20 %)</li>
  <li><strong>Business MAX</strong>: 149 €/Monat (unbegrenzt + alle Erweiterungen) · 1.429 €/Jahr</li>
  <li><strong>Premium MAX</strong>: 69 €/Monat · 659 €/Jahr</li>
</ul>

<h2>5. Abo-Verlängerung</h2>
<p>Auto-Renewable Subscriptions verlängern sich automatisch um den jeweiligen Zeitraum, sofern nicht 24 Stunden vor Ablauf gekündigt. Die Verwaltung erfolgt in den iPhone-Einstellungen → Apple-ID → Abonnements.</p>

<h2>6. Widerruf</h2>
<p>Verbraucher haben ein 14-tägiges Widerrufsrecht. Da die Erbringung der digitalen Leistung sofort beginnt und mit ausdrücklicher Zustimmung des Nutzers, erlischt das Widerrufsrecht beim Beginn der Nutzung. Details siehe <a href="/widerruf">Widerrufsbelehrung</a>.</p>

<h2>7. Haftung</h2>
<p>Wir haften unbeschränkt für Vorsatz und grobe Fahrlässigkeit. Bei leichter Fahrlässigkeit haften wir nur bei Verletzung wesentlicher Vertragspflichten und nur bis zur Höhe des vertragstypischen, vorhersehbaren Schadens.</p>

<h2>8. Datenschutz</h2>
<p>Es gilt unsere <a href="/datenschutz">Datenschutzerklärung</a>.</p>

<h2>9. Anwendbares Recht</h2>
<p>Es gilt das Recht der Bundesrepublik Deutschland unter Ausschluss des UN-Kaufrechts.</p>

<p><em>Stand: ${new Date().toISOString().slice(0, 10)}</em></p>`
}

function defaultWiderruf(): string {
  return `
<h2>Widerrufsbelehrung</h2>
<p>Verbraucher haben das Recht, binnen 14 Tagen ohne Angabe von Gründen ihren Vertrag zu widerrufen.</p>

<h3>Widerrufsfrist</h3>
<p>Die Widerrufsfrist beträgt 14 Tage ab dem Tag des Vertragsschlusses.</p>

<h3>Ausübung des Widerrufsrechts</h3>
<p>Um das Widerrufsrecht auszuüben, musst du uns mittels einer eindeutigen Erklärung (z.B. E-Mail) über deinen Entschluss informieren:</p>
<p><strong>David Schroedinger · CustoSoft</strong><br>
E-Mail: <a href="mailto:taironic.media@gmail.com">taironic.media@gmail.com</a></p>

<h3>Erlöschen des Widerrufsrechts</h3>
<p>Das Widerrufsrecht erlischt vorzeitig wenn:</p>
<ul>
  <li>du beim Kauf bestätigst, dass die Leistung sofort erbracht wird, und</li>
  <li>du gleichzeitig auf dein Widerrufsrecht verzichtest, sobald die App-Funktion freigeschaltet wurde.</li>
</ul>

<h3>Refunds via Apple</h3>
<p>Da die Zahlung über Apple läuft, kannst du Refunds direkt über deinen Apple-Account anfordern:<br>
<a href="https://reportaproblem.apple.com" target="_blank">reportaproblem.apple.com</a></p>`
}
