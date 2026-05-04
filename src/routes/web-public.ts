// ── Public Website — Marketing-Seiten + Legal (Apple Pflicht) ────────────────
import { Hono }     from 'hono'
import type { Env, AppEnv } from '../types'
import { sendEmail } from '../utils/email'

const webPublic = new Hono<AppEnv>()

// Loads legal page from D1 by slug
async function loadLegal(env: Env, slug: string) {
  return env.DB.prepare('SELECT title, content FROM legal_pages WHERE slug = ?')
    .bind(slug).first<{ title: string; content: string }>()
}

// ── Landing Page ──────────────────────────────────────────────────────────────
webPublic.get('/', (c) => c.html(LANDING_HTML))

// Live Beta-Counter — Landing-Page lädt das via Fetch beim Mount.
webPublic.get('/beta-count', async (c) => {
  try {
    const row = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM beta_signups').first<{ n: number }>()
    return c.json({ count: row?.n ?? 0, limit: 100 })
  } catch {
    return c.json({ count: 0, limit: 100 })
  }
})

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

// ── Beta-Tester Signup ────────────────────────────────────────────────────────
webPublic.post('/beta-signup', async (c) => {
  let body: { email?: string; firstName?: string; device?: string; teamSize?: string; message?: string }
  try { body = await c.req.json() } catch { return c.json({ error: 'Ungültige Anfrage.' }, 400) }

  const email = (body.email ?? '').trim().toLowerCase()
  if (!email || !email.includes('@') || !email.includes('.')) {
    return c.json({ error: 'Bitte gib eine gültige E-Mail-Adresse ein.' }, 400)
  }

  const existing = await c.env.DB
    .prepare('SELECT id FROM beta_signups WHERE email = ?').bind(email).first()
  if (existing) {
    return c.json({ ok: true, alreadyRegistered: true, message: 'Du bist bereits auf unserer Beta-Liste! Wir melden uns.' })
  }

  await c.env.DB.prepare(
    'INSERT INTO beta_signups (email, first_name, device, team_size, message) VALUES (?, ?, ?, ?, ?)'
  ).bind(email, body.firstName ?? null, body.device ?? null, body.teamSize ?? null, body.message ?? null).run()

  // Bestätigungsmail
  try {
    const name = body.firstName ? body.firstName : 'Hey'
    await sendEmail({
      to: email, toName: body.firstName ?? '',
      subject: 'Du bist auf der CustoSoft Beta-Liste! 🎉',
      text: `${name}!\n\nDu bist jetzt offiziell auf unserer Beta-Liste für CustoSoft.\n\nBelohnung bei Release: Lebenslange Stempeluhr-Lizenz — kostenlos, für immer.\n\nWir melden uns sobald der Beta-Start näher rückt.\n\nBis dann,\nDavid — CustoSoft`,
      html: `<div style="font-family:-apple-system,sans-serif;max-width:520px;margin:0 auto;background:#0a0a14;color:#fff;padding:40px 32px;border-radius:16px">
        <div style="background:linear-gradient(135deg,#7733dd,#3355ff);border-radius:12px;padding:20px;text-align:center;margin-bottom:28px">
          <span style="font-size:32px">🎉</span>
          <h1 style="margin:8px 0 4px;font-size:22px">Du bist dabei!</h1>
          <p style="margin:0;opacity:0.8;font-size:14px">CustoSoft Beta-Programm</p>
        </div>
        <p style="font-size:16px;line-height:1.6;color:rgba(255,255,255,0.85)">Hey${body.firstName ? ' ' + body.firstName : ''},</p>
        <p style="font-size:15px;line-height:1.7;color:rgba(255,255,255,0.75)">du bist offiziell auf unserer Beta-Liste. Sobald es losgeht, bekommst du als Erster Bescheid.</p>
        <div style="background:rgba(120,60,255,0.15);border:1px solid rgba(120,60,255,0.4);border-radius:12px;padding:20px;margin:24px 0">
          <div style="font-size:12px;color:#c594ff;font-weight:700;letter-spacing:1px;margin-bottom:8px">DEINE BELOHNUNG BEI RELEASE</div>
          <div style="font-size:18px;font-weight:700">⏱ Lebenslange Stempeluhr-Lizenz</div>
          <div style="font-size:13px;color:rgba(255,255,255,0.6);margin-top:4px">Kostenlos · Für immer freigeschaltet</div>
        </div>
        <p style="font-size:13px;color:rgba(255,255,255,0.45);margin-top:28px">Fragen? Antworte einfach auf diese Mail.<br>custosoftsupportde@gmail.com</p>
      </div>`,
      from: c.env.FROM_EMAIL, fromName: c.env.FROM_NAME,
      apiKey: c.env.RESEND_API_KEY,
    })
  } catch (e: any) {
    console.error('[beta-signup] email failed:', e?.message)
  }

  const count = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM beta_signups').first<{ n: number }>()
  return c.json({ ok: true, message: 'Erfolgreich registriert! Bestätigungsmail unterwegs.', totalSignups: count?.n ?? 0 })
})

webPublic.get('/apply/:code', async (c) => {  const code = c.req.param('code')
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
<title>CustoSoft — Die Team-App für Apple. Made in Germany.</title>
<meta name="description" content="Stempeluhr, Akten, Chat, Bewerbungsmanager — nativ auf iOS, iPadOS & macOS. Jetzt als Beta-Tester bewerben und lebenslange Lizenz sichern.">
<meta property="og:title" content="CustoSoft — Die App für dein Team.">
<meta property="og:description" content="Nativ in Swift. Nur Apple. Nur Deutschland. Jetzt Beta-Tester werden.">
<style>${SHARED_STYLE}

/* ═══ ANIMATIONS ══════════════════════════════════════════════════════════ */
@keyframes float{0%,100%{transform:translateY(0) rotate(-1deg)}50%{transform:translateY(-18px) rotate(1deg)}}
@keyframes fadeUp{from{opacity:0;transform:translateY(28px)}to{opacity:1;transform:translateY(0)}}
@keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.5;transform:scale(1.5)}}
@keyframes orbit{0%{transform:translate(0,0) scale(1)}33%{transform:translate(80px,-60px) scale(1.15)}66%{transform:translate(-50px,80px) scale(.9)}100%{transform:translate(0,0) scale(1)}}
@keyframes orbit2{0%{transform:translate(0,0) scale(1)}33%{transform:translate(-90px,50px) scale(1.1)}66%{transform:translate(60px,-40px) scale(.85)}100%{transform:translate(0,0) scale(1)}}
@keyframes gradientShift{0%,100%{background-position:0% 50%}50%{background-position:100% 50%}}
@keyframes shimmer{0%{background-position:-200% 0}100%{background-position:200% 0}}
@keyframes glow{0%,100%{box-shadow:0 0 20px rgba(120,60,255,.5)}50%{box-shadow:0 0 40px rgba(120,60,255,.9),0 0 80px rgba(120,60,255,.3)}}
@keyframes progress{from{width:0}to{width:var(--p)}}
@keyframes slideInLeft{from{opacity:0;transform:translateX(-30px)}to{opacity:1;transform:translateX(0)}}
@keyframes slideInRight{from{opacity:0;transform:translateX(30px)}to{opacity:1;transform:translateX(0)}}
@keyframes countUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
@keyframes borderPulse{0%,100%{border-color:rgba(120,60,255,.3)}50%{border-color:rgba(120,60,255,.8)}}
@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
@keyframes checkmark{0%{stroke-dashoffset:50}100%{stroke-dashoffset:0}}

/* ═══ HERO ════════════════════════════════════════════════════════════════ */
.hero-wrap{position:relative;min-height:100vh;display:flex;flex-direction:column;justify-content:center;overflow:hidden}
.orb{position:absolute;border-radius:50%;filter:blur(90px);pointer-events:none}
.orb1{width:700px;height:700px;background:radial-gradient(circle,rgba(120,60,255,.45),transparent 70%);top:-200px;left:-200px;animation:orbit 18s ease-in-out infinite}
.orb2{width:500px;height:500px;background:radial-gradient(circle,rgba(50,120,255,.35),transparent 70%);bottom:-150px;right:-100px;animation:orbit2 22s ease-in-out infinite}
.orb3{width:300px;height:300px;background:radial-gradient(circle,rgba(255,80,200,.20),transparent 70%);top:40%;left:60%;animation:orbit 28s ease-in-out infinite reverse}
.hero-inner{position:relative;z-index:2;max-width:1100px;margin:0 auto;padding:100px 24px 60px;display:grid;grid-template-columns:1fr 420px;gap:60px;align-items:center}
.hero-text .badge{display:inline-flex;align-items:center;gap:8px;background:rgba(120,60,255,.18);border:1px solid rgba(120,60,255,.50);padding:8px 16px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:1.8px;color:#c594ff;margin-bottom:24px;text-transform:uppercase;animation:fadeUp .6s ease both}
.hero-text .badge .dot{width:6px;height:6px;border-radius:50%;background:#0fbf73;animation:pulse 1.6s ease-in-out infinite}
.hero-text h1{font-size:clamp(44px,6vw,74px);font-weight:900;line-height:1.0;letter-spacing:-3px;margin-bottom:20px;animation:fadeUp .7s .1s ease both;background:linear-gradient(135deg,#fff 0%,#d0a8ff 40%,#7790ff 80%,#fff 100%);background-size:200% auto;-webkit-background-clip:text;-webkit-text-fill-color:transparent;animation:gradientShift 5s ease infinite,fadeUp .7s .1s ease both}
.hero-text h1 em{font-style:normal;background:linear-gradient(135deg,#ffd060,#ff7030);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.hero-text .sub{font-size:clamp(15px,1.6vw,18px);color:rgba(255,255,255,.68);line-height:1.6;margin-bottom:28px;animation:fadeUp .7s .2s ease both;max-width:520px}
.platform-strip{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:28px;animation:fadeUp .7s .3s ease both}
.plat-badge{display:inline-flex;align-items:center;gap:7px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.14);padding:7px 13px;border-radius:10px;font-size:12px;font-weight:600;color:rgba(255,255,255,.85)}
.plat-badge .ico{font-size:15px}
.avail-badge{display:inline-flex;align-items:center;gap:6px;background:rgba(15,191,115,.12);border:1px solid rgba(15,191,115,.35);padding:7px 13px;border-radius:10px;font-size:12px;font-weight:600;color:#0fbf73}
.coming-badge{display:inline-flex;align-items:center;gap:6px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.10);padding:7px 13px;border-radius:10px;font-size:11px;color:rgba(255,255,255,.45);font-weight:500}
.hero-cta-row{display:flex;gap:12px;flex-wrap:wrap;animation:fadeUp .7s .4s ease both}
.cta{display:inline-flex;align-items:center;gap:9px;padding:15px 26px;border-radius:13px;font-weight:700;font-size:15px;text-decoration:none;transition:all .18s;border:none;cursor:pointer}
.cta-primary{background:linear-gradient(135deg,#7733dd,#3355ff);color:#fff;box-shadow:0 14px 36px rgba(120,60,255,.55);animation:glow 3s ease-in-out infinite}
.cta-primary:hover{transform:translateY(-3px);box-shadow:0 20px 48px rgba(120,60,255,.7)}
.cta-secondary{background:rgba(255,255,255,.07);color:#fff;border:1px solid rgba(255,255,255,.15)}
.cta-secondary:hover{transform:translateY(-2px);background:rgba(255,255,255,.12)}

/* ═══ PHONE MOCKUP ════════════════════════════════════════════════════════ */
.phone-wrap{position:relative;display:flex;justify-content:center;align-items:center;animation:fadeUp .8s .5s ease both}
.phone{width:260px;height:520px;background:linear-gradient(180deg,#111122,#0d0d1e);border:2px solid rgba(255,255,255,.15);border-radius:44px;box-shadow:0 60px 120px rgba(0,0,0,.7),0 0 80px rgba(120,60,255,.3),inset 0 1px 0 rgba(255,255,255,.08);position:relative;overflow:hidden;animation:float 5s ease-in-out infinite;flex-shrink:0}
.phone::before{content:'';position:absolute;top:14px;left:50%;transform:translateX(-50%);width:90px;height:28px;background:#000;border-radius:14px;z-index:10}
.phone-side-btn{position:absolute;right:-3px;top:110px;width:3px;height:40px;background:rgba(255,255,255,.2);border-radius:2px}
.phone-side-btn2{position:absolute;right:-3px;top:160px;width:3px;height:60px;background:rgba(255,255,255,.2);border-radius:2px}
.phone-vol{position:absolute;left:-3px;top:120px;width:3px;height:30px;background:rgba(255,255,255,.2);border-radius:2px}
.phone-vol2{position:absolute;left:-3px;top:160px;width:3px;height:30px;background:rgba(255,255,255,.2);border-radius:2px}
.phone-screen{position:absolute;inset:0;padding:58px 16px 20px;overflow:hidden}
.phone-screen .p-nav{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px}
.phone-screen .p-nav .p-title{font-size:16px;font-weight:700}
.phone-screen .p-nav .p-time{font-size:12px;color:rgba(255,255,255,.45)}
.phone-screen .p-row{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px}
.phone-screen .p-card{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:12px 10px}
.phone-screen .p-card .p-label{font-size:8px;color:rgba(255,255,255,.4);letter-spacing:.8px;text-transform:uppercase;margin-bottom:3px}
.phone-screen .p-card .p-val{font-size:17px;font-weight:800}
.phone-screen .p-card .p-val.green{color:#0fbf73}
.phone-screen .p-card .p-val.amber{color:#ffb733}
.phone-screen .p-stamp-btn{display:flex;align-items:center;justify-content:center;gap:8px;background:linear-gradient(135deg,#7733dd,#3355ff);border-radius:14px;padding:14px;font-weight:700;font-size:13px;margin-top:8px;box-shadow:0 8px 24px rgba(120,60,255,.5)}
.phone-screen .p-members{margin-top:10px}
.phone-screen .p-members .p-label{font-size:8px;color:rgba(255,255,255,.4);letter-spacing:.8px;margin-bottom:6px}
.phone-screen .p-member{display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.05)}
.phone-screen .p-member .p-av{width:24px;height:24px;border-radius:50%;background:linear-gradient(135deg,#7733dd,#3355ff);display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;flex-shrink:0}
.phone-screen .p-member .p-name{font-size:11px;flex:1}
.phone-screen .p-member .p-status{font-size:9px;color:#0fbf73;font-weight:600}
.phone-glow{position:absolute;bottom:-40px;left:50%;transform:translateX(-50%);width:200px;height:80px;background:rgba(120,60,255,.5);border-radius:50%;filter:blur(30px);z-index:-1}

/* ═══ BETA COUNTER ════════════════════════════════════════════════════════ */
.beta-counter-strip{background:rgba(15,191,115,.08);border-top:1px solid rgba(15,191,115,.15);border-bottom:1px solid rgba(15,191,115,.15);padding:14px 24px;text-align:center;position:relative;z-index:2}
.beta-counter-inner{max-width:700px;margin:0 auto;display:flex;align-items:center;justify-content:center;gap:16px;flex-wrap:wrap}
.beta-counter-inner .spots-num{font-size:28px;font-weight:900;color:#0fbf73;font-variant-numeric:tabular-nums}
.beta-counter-inner .spots-label{font-size:14px;color:rgba(255,255,255,.7)}
.beta-progress{width:200px;height:8px;background:rgba(255,255,255,.1);border-radius:4px;overflow:hidden}
.beta-progress-fill{height:100%;background:linear-gradient(90deg,#0fbf73,#00e5a0);border-radius:4px;width:0;--p:47%;animation:progress 2s 1s ease forwards}

/* ═══ SECTION SHARED ══════════════════════════════════════════════════════ */
.section{position:relative;z-index:1;max-width:1100px;margin:0 auto;padding:80px 24px}
.section-head{text-align:center;margin-bottom:48px}
.section-head .tag{font-size:11px;font-weight:700;letter-spacing:2.5px;color:#c594ff;text-transform:uppercase;margin-bottom:10px}
.section-head h2{font-size:clamp(28px,4vw,44px);font-weight:900;letter-spacing:-1.5px;background:linear-gradient(135deg,#fff,#c594ff);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.section-head p{color:rgba(255,255,255,.55);font-size:15px;max-width:560px;margin:12px auto 0;line-height:1.6}

/* ═══ PLATFORM SECTION ════════════════════════════════════════════════════ */
.platform-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;margin-bottom:40px}
.plat-card{padding:24px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:18px;text-align:center;transition:all .2s}
.plat-card:hover{transform:translateY(-4px);border-color:rgba(120,60,255,.35);background:rgba(120,60,255,.06)}
.plat-card .p-icon{font-size:36px;margin-bottom:12px;display:block}
.plat-card h3{font-size:17px;font-weight:700;margin-bottom:4px}
.plat-card .p-desc{font-size:12px;color:rgba(255,255,255,.5)}
.plat-card.coming{opacity:.5;border-style:dashed}
.plat-card.coming:hover{opacity:.7}
.coming-tag{display:inline-block;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);padding:3px 9px;border-radius:6px;font-size:10px;color:rgba(255,255,255,.55);font-weight:600;letter-spacing:.5px;text-transform:uppercase;margin-top:6px}

/* ═══ FEATURES GRID ═══════════════════════════════════════════════════════ */
.features-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:18px}
.feat{padding:28px;border-radius:20px;background:linear-gradient(160deg,rgba(255,255,255,.06),rgba(255,255,255,.02));border:1px solid rgba(255,255,255,.09);transition:all .2s;position:relative;overflow:hidden}
.feat:hover{transform:translateY(-4px);border-color:rgba(120,60,255,.35)}
.feat::before{content:'';position:absolute;top:-40%;right:-20%;width:200px;height:200px;border-radius:50%;background:radial-gradient(circle,var(--ac,rgba(120,60,255,.2)),transparent 70%);filter:blur(30px);pointer-events:none}
.feat .f-icon{font-size:30px;margin-bottom:12px;display:block}
.feat h3{font-size:18px;font-weight:700;margin-bottom:6px}
.feat p{color:rgba(255,255,255,.6);font-size:13.5px;line-height:1.6}
.feat .f-tag{display:inline-block;margin-top:12px;background:rgba(255,255,255,.07);padding:4px 10px;border-radius:7px;font-size:11px;color:rgba(255,255,255,.6);font-weight:600}
.feat.fc1{--ac:rgba(0,200,180,.2)}.feat.fc2{--ac:rgba(140,180,255,.2)}.feat.fc3{--ac:rgba(50,200,140,.2)}.feat.fc4{--ac:rgba(140,80,255,.25)}.feat.fc5{--ac:rgba(80,100,255,.25)}.feat.fc6{--ac:rgba(255,200,50,.15)}

/* ═══ BETA SECTION ════════════════════════════════════════════════════════ */
.beta-section{background:linear-gradient(135deg,rgba(120,60,255,.12),rgba(50,130,255,.08));border:1px solid rgba(120,60,255,.25);border-radius:28px;padding:64px 48px;text-align:center;position:relative;overflow:hidden}
.beta-section::before{content:'';position:absolute;top:-50%;left:-20%;width:600px;height:600px;border-radius:50%;background:radial-gradient(circle,rgba(120,60,255,.35),transparent 70%);filter:blur(80px);pointer-events:none;animation:orbit 20s ease-in-out infinite}
.beta-section h2{font-size:clamp(28px,4vw,46px);font-weight:900;letter-spacing:-1.5px;background:linear-gradient(135deg,#fff,#c594ff);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:10px;position:relative;z-index:1}
.beta-section .reward-box{display:inline-flex;align-items:center;gap:12px;background:rgba(15,191,115,.12);border:1px solid rgba(15,191,115,.35);border-radius:14px;padding:16px 24px;margin:20px 0 32px;position:relative;z-index:1}
.beta-section .reward-box .r-icon{font-size:28px}
.beta-section .reward-box .r-text strong{display:block;font-size:16px;font-weight:700;color:#0fbf73}
.beta-section .reward-box .r-text span{font-size:12px;color:rgba(255,255,255,.6)}

/* Form */
.beta-form{max-width:560px;margin:0 auto;position:relative;z-index:1}
.form-row{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px}
.form-field{display:flex;flex-direction:column;gap:6px;margin-bottom:14px;text-align:left}
.form-field label{font-size:12px;font-weight:600;color:rgba(255,255,255,.6);letter-spacing:.5px}
.form-field input,.form-field select{background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:13px 16px;color:#fff;font-size:14px;font-family:inherit;outline:none;transition:all .15s;width:100%;box-sizing:border-box}
.form-field input:focus,.form-field select:focus{border-color:rgba(120,60,255,.6);background:rgba(120,60,255,.08);box-shadow:0 0 0 3px rgba(120,60,255,.15)}
.form-field select option{background:#1a1a2e;color:#fff}
.form-field input::placeholder{color:rgba(255,255,255,.3)}
.form-submit{width:100%;padding:16px;background:linear-gradient(135deg,#7733dd,#3355ff);color:#fff;font-size:16px;font-weight:700;border:none;border-radius:14px;cursor:pointer;transition:all .18s;margin-top:6px;position:relative;overflow:hidden}
.form-submit:hover{transform:translateY(-2px);box-shadow:0 14px 36px rgba(120,60,255,.55)}
.form-submit:disabled{opacity:.6;cursor:not-allowed;transform:none}
.form-note{font-size:12px;color:rgba(255,255,255,.35);margin-top:12px}
.form-error{color:#ff6b6b;font-size:13px;margin-top:8px;display:none}
.form-success{display:none;text-align:center;padding:32px 0}
.form-success .success-icon{font-size:56px;margin-bottom:12px;animation:countUp .5s ease}
.form-success h3{font-size:22px;font-weight:700;margin-bottom:8px;color:#0fbf73}
.form-success p{color:rgba(255,255,255,.65);font-size:14px;line-height:1.6}

/* ═══ ROADMAP ══════════════════════════════════════════════════════════════ */
.roadmap{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px}
.rm-card{padding:24px;border-radius:18px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);position:relative}
.rm-card.active{border-color:rgba(15,191,115,.30);background:rgba(15,191,115,.04)}
.rm-card.next{border-color:rgba(120,60,255,.25);background:rgba(120,60,255,.04)}
.rm-dot{width:10px;height:10px;border-radius:50%;margin-bottom:12px}
.rm-dot.done{background:#0fbf73}
.rm-dot.soon{background:#7733dd;animation:glow 2s ease-in-out infinite}
.rm-dot.later{background:rgba(255,255,255,.25)}
.rm-card .rm-phase{font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:6px}
.rm-card.active .rm-phase{color:#0fbf73}
.rm-card.next .rm-phase{color:#c594ff}
.rm-card h4{font-size:17px;font-weight:700;margin-bottom:6px}
.rm-card p{font-size:13px;color:rgba(255,255,255,.55);line-height:1.5}
.rm-card ul{padding-left:0;list-style:none;margin:10px 0 0}
.rm-card li{font-size:12px;color:rgba(255,255,255,.6);padding:3px 0;display:flex;align-items:center;gap:7px}
.rm-card li::before{content:'→';color:#c594ff;font-size:10px}

/* ═══ FAQ ══════════════════════════════════════════════════════════════════ */
.faq{max-width:700px;margin:0 auto;display:flex;flex-direction:column;gap:12px}
.faq-item{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:14px;overflow:hidden}
.faq-q{padding:18px 20px;font-weight:600;font-size:14px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;list-style:none;user-select:none}
.faq-q::after{content:'＋';color:rgba(255,255,255,.4);font-size:16px;transition:transform .2s}
.faq-item.open .faq-q::after{transform:rotate(45deg);color:#c594ff}
.faq-a{height:0;overflow:hidden;transition:height .3s ease;padding:0 20px}
.faq-a p{padding:0 0 16px;font-size:13.5px;color:rgba(255,255,255,.6);line-height:1.7;margin:0}

/* ═══ RESPONSIVE ══════════════════════════════════════════════════════════ */
@media(max-width:900px){
  .hero-inner{grid-template-columns:1fr;text-align:center;padding:80px 20px 40px}
  .phone-wrap{order:-1;margin-bottom:20px}
  .hero-cta-row{justify-content:center}
  .platform-strip{justify-content:center}
  .hero-text .sub{margin:0 auto 28px}
  .form-row{grid-template-columns:1fr}
  .beta-section{padding:40px 24px}
}
@media(max-width:600px){
  .phone{width:220px;height:440px}
  .beta-section h2{font-size:26px}
}
</style>
</head>
<body>
${commonNav()}

<!-- ═══ HERO ═══════════════════════════════════════════════════════════════ -->
<div class="hero-wrap">
  <div class="orb orb1"></div>
  <div class="orb orb2"></div>
  <div class="orb orb3"></div>
  <div class="hero-inner">
    <div class="hero-text">
      <div class="badge"><span class="dot"></span>Beta-Programm — jetzt offen</div>
      <h1>Die App<br>für dein<br><em>Team.</em></h1>
      <p class="sub">Stempeluhr · Mitarbeiter-Akten · Team-Chat · Bewerbungsmanagement. Nativ in Swift. Datenschutz first. Made in Germany.</p>
      <div class="platform-strip">
        <span class="plat-badge"><span class="ico"></span> iOS 17+</span>
        <span class="plat-badge"><span class="ico"></span> iPadOS 17+</span>
        <span class="plat-badge"><span class="ico"></span> macOS 14+</span>
        <span class="avail-badge">🇩🇪 Nur Deutschland</span>
        <span class="coming-badge">Web · Android geplant</span>
      </div>
      <div class="hero-cta-row">
        <a href="#beta" class="cta cta-primary">🧪 Jetzt Tester werden</a>
        <a href="#features" class="cta cta-secondary">Features entdecken ↓</a>
      </div>
    </div>

    <!-- Phone Mockup -->
    <div class="phone-wrap">
      <div class="phone">
        <div class="phone-side-btn"></div><div class="phone-side-btn2"></div>
        <div class="phone-vol"></div><div class="phone-vol2"></div>
        <div class="phone-screen">
          <div class="p-nav"><span class="p-title">Stempeluhr</span><span class="p-time">09:41</span></div>
          <div class="p-row">
            <div class="p-card"><div class="p-label">Seit</div><div class="p-val green">07:38 h</div></div>
            <div class="p-card"><div class="p-label">Pause</div><div class="p-val amber">0:23 h</div></div>
          </div>
          <div class="p-row">
            <div class="p-card"><div class="p-label">Woche</div><div class="p-val">31:12 h</div></div>
            <div class="p-card"><div class="p-label">Team aktiv</div><div class="p-val">7/12</div></div>
          </div>
          <div class="p-stamp-btn">⏱ Gestempelt</div>
          <div class="p-members">
            <div class="p-label">TEAM HEUTE</div>
            <div class="p-member"><div class="p-av">DK</div><span class="p-name">Davina K.</span><span class="p-status">● Aktiv</span></div>
            <div class="p-member"><div class="p-av" style="background:linear-gradient(135deg,#0fbf73,#0080cc)">MR</div><span class="p-name">Max R.</span><span class="p-status">● Aktiv</span></div>
            <div class="p-member"><div class="p-av" style="background:linear-gradient(135deg,#ff7030,#dd3355)">LP</div><span class="p-name">Lisa P.</span><span class="p-status" style="color:#ffb733">● Pause</span></div>
          </div>
        </div>
      </div>
      <div class="phone-glow"></div>
    </div>
  </div>
</div>

<!-- Beta-Counter Strip -->
<div class="beta-counter-strip">
  <div class="beta-counter-inner">
    <span class="spots-num" id="betaCount">0</span>
    <span class="spots-label">von <strong>100</strong> Beta-Plätzen vergeben</span>
    <div class="beta-progress"><div class="beta-progress-fill"></div></div>
    <span style="font-size:13px;color:rgba(255,255,255,.5)">🎁 Belohnung: lebenslange Stempeluhr-Lizenz</span>
  </div>
</div>

<!-- ═══ PLATFORM ════════════════════════════════════════════════════════════ -->
<div class="section" id="platform">
  <div class="section-head">
    <div class="tag">Plattformen</div>
    <h2>Nativ. Kein Browser. Kein Kompromiss.</h2>
    <p>100 % Swift für Apple-Geräte. Schneller, schöner, sicherer als jede Webwrapper-App. Zukünftig auch Web & Android.</p>
  </div>
  <div class="platform-cards">
    <div class="plat-card">
      <span class="p-icon"></span>
      <h3>iPhone</h3>
      <div class="p-desc">iOS 17+ · Dynamic Island · Lock Screen Widget · Face ID</div>
    </div>
    <div class="plat-card">
      <span class="p-icon"></span>
      <h3>iPad</h3>
      <div class="p-desc">iPadOS 17+ · Stage Manager · Wand-Stempeluhr-Kiosk · Multitasking</div>
    </div>
    <div class="plat-card">
      <span class="p-icon"></span>
      <h3>Mac</h3>
      <div class="p-desc">macOS 14 Sonoma · Native Sidebar · Cmd+, Settings · Menüleiste</div>
    </div>
    <div class="plat-card coming">
      <span class="p-icon">🌐</span>
      <h3>Web</h3>
      <div class="p-desc">Browserbasierte Version. Gleiches Backend, alle Daten synchron.</div>
      <div class="coming-tag">In Planung</div>
    </div>
    <div class="plat-card coming">
      <span class="p-icon">🤖</span>
      <h3>Android</h3>
      <div class="p-desc">Nativ in Kotlin. Material You Design. Auf Augenhöhe mit der iOS-App.</div>
      <div class="coming-tag">In Planung</div>
    </div>
  </div>
</div>

<!-- ═══ FEATURES ════════════════════════════════════════════════════════════ -->
<div class="section" id="features">
  <div class="section-head">
    <div class="tag">Funktionen</div>
    <h2>Alles drin. Nichts Unnötiges.</h2>
    <p>Modular — kaufe nur was du brauchst. Jede Erweiterung wird sofort freigeschaltet, keine Wartezeit.</p>
  </div>
  <div class="features-grid">
    <div class="feat fc1">
      <span class="f-icon">⏱</span>
      <h3>Stempeluhr</h3>
      <p>Ein-Tap stempeln. Pausen, Wochen-Statistiken, Dynamic-Island-Live-Anzeige und CSV-Export für die Lohnbuchhaltung.</p>
      <span class="f-tag">2,99 €/Woche · jederzeit kündbar</span>
    </div>
    <div class="feat fc2">
      <span class="f-icon">📋</span>
      <h3>Bewerbungsmanager</h3>
      <p>Stellenlinks erstellen, Bewerbungen sammeln, Status-Workflow von „Neu" bis „Eingestellt". Direkte Übernahme als Mitarbeiter.</p>
      <span class="f-tag">9,99 € einmalig · Dauerlizenz</span>
    </div>
    <div class="feat fc3">
      <span class="f-icon">🪧</span>
      <h3>Wand-Stempeluhr</h3>
      <p>iPad an die Wand. Mitarbeiter stempeln per persönlichem 7-stelligem Code. Vollbild-Kiosk, Hold-to-Exit Sperre.</p>
      <span class="f-tag">14,99 € einmalig · Dauerlizenz</span>
    </div>
    <div class="feat fc4">
      <span class="f-icon">💬</span>
      <h3>Team-Chat</h3>
      <p>Echtzeit-Messaging mit Foto-Anhängen, Emoji-Picker, In-App Banner. Strikte Org-Isolation — kein Datenleck zwischen Firmen.</p>
      <span class="f-tag">Inklusive in Business-Paketen</span>
    </div>
    <div class="feat fc5">
      <span class="f-icon">🏢</span>
      <h3>Organisations-Verwaltung</h3>
      <p>10 granulare Berechtigungen pro Mitarbeiter. Abteilungen, Positionen, Lohn-Auswertung mit Export. Mitglieder erben Stempeluhr & Akten vom Inhaber.</p>
      <span class="f-tag">Business Basic 49 €/Monat · Business L 89 €/Monat (50 Slots)</span>
    </div>
    <div class="feat fc6">
      <span class="f-icon">📁</span>
      <h3>Mitarbeiter-Akten</h3>
      <p>Digitale Personalakten mit Dokumenten-Upload. Nur für berechtigte Admins sichtbar. DSGVO-konform, EU-Server.</p>
      <span class="f-tag">Inklusive in Business-Paketen</span>
    </div>
  </div>
</div>

<!-- ═══ BETA SIGNUP ══════════════════════════════════════════════════════════ -->
<div class="section" id="beta">
  <div class="beta-section">
    <div class="section-head" style="margin-bottom:16px">
      <div class="tag">Beta-Programm</div>
      <h2>Werde einer der ersten<br>100 Beta-Tester.</h2>
    </div>
    <div class="reward-box">
      <span class="r-icon">🎁</span>
      <div class="r-text">
        <strong>Lebenslange Stempeluhr-Lizenz</strong>
        <span>Kostenlos · Für immer freigeschaltet · Bei Release automatisch aktiviert</span>
      </div>
    </div>

    <!-- Form -->
    <div class="beta-form" id="betaFormWrap">
      <div class="form-row">
        <div class="form-field">
          <label>VORNAME</label>
          <input type="text" id="bf-name" placeholder="z.B. David" autocomplete="given-name">
        </div>
        <div class="form-field">
          <label>E-MAIL *</label>
          <input type="email" id="bf-email" placeholder="deine@email.de" autocomplete="email" required>
        </div>
      </div>
      <div class="form-row">
        <div class="form-field">
          <label>DEIN GERÄT</label>
          <select id="bf-device">
            <option value="">Bitte wählen …</option>
            <option value="iphone">iPhone</option>
            <option value="ipad">iPad</option>
            <option value="mac">Mac</option>
            <option value="multiple">Mehrere Apple-Geräte</option>
          </select>
        </div>
        <div class="form-field">
          <label>TEAMGRÖSSE (OPTIONAL)</label>
          <select id="bf-team">
            <option value="">Nur ich</option>
            <option value="2-5">2–5 Personen</option>
            <option value="6-20">6–20 Personen</option>
            <option value="20+">Mehr als 20</option>
          </select>
        </div>
      </div>
      <button class="form-submit" id="betaSubmit" type="button">🚀 Jetzt bewerben — kostenlos</button>
      <div class="form-error" id="betaError"></div>
      <p class="form-note">Kein Spam. Keine Weitergabe. Nur Beta-Updates und deine Lizenz-Aktivierung bei Release.</p>
    </div>

    <!-- Success state -->
    <div class="form-success" id="betaSuccess">
      <div class="success-icon">🎉</div>
      <h3>Du bist dabei!</h3>
      <p>Wir haben dir eine Bestätigungsmail geschickt.<br>Du wirst als Erster informiert wenn es losgeht — und bekommst automatisch deine lebenslange Stempeluhr-Lizenz bei Release.</p>
      <p style="margin-top:16px;font-size:12px;opacity:.5">Schau auch in deinen Spam-Ordner.</p>
    </div>
  </div>
</div>

<!-- ═══ ROADMAP ══════════════════════════════════════════════════════════════ -->
<div class="section">
  <div class="section-head">
    <div class="tag">Roadmap</div>
    <h2>Was noch kommt.</h2>
    <p>CustoSoft wird weiter wachsen — hier ist der Plan.</p>
  </div>
  <div class="roadmap">
    <div class="rm-card active">
      <div class="rm-dot done"></div>
      <div class="rm-phase">Phase 1 — Live</div>
      <h4>iOS · iPadOS · macOS</h4>
      <p>Stempeluhr, Chat, Akten, Bewerbungsmanager, Wand-Stempeluhr. Cloudflare Edge, EU-Server.</p>
      <ul><li>App Store — TestFlight läuft</li><li>Push Notifications</li><li>Business-Abos</li></ul>
    </div>
    <div class="rm-card next">
      <div class="rm-dot soon"></div>
      <div class="rm-phase">Phase 2 — In Planung</div>
      <h4>Web-Version</h4>
      <p>Vollständige Web-App im Browser. Gleiches Backend, alle Daten synchron mit der Apple-App.</p>
      <ul><li>Alle Core-Features</li><li>Desktop-optimiertes UI</li><li>Export & Reports</li></ul>
    </div>
    <div class="rm-card">
      <div class="rm-dot later"></div>
      <div class="rm-phase">Phase 3 — Geplant</div>
      <h4>Android (Kotlin)</h4>
      <p>Nativ in Kotlin mit Jetpack Compose. Material You Design. Auf Augenhöhe mit der iOS-App — kein Wrapper.</p>
      <ul><li>Stempeluhr, Chat, Akten</li><li>Material You · Android 12+</li><li>Play Store</li></ul>
    </div>
    <div class="rm-card">
      <div class="rm-dot later"></div>
      <div class="rm-phase">Langfristig</div>
      <h4>Enterprise & API</h4>
      <p>Lohnbuchhaltungs-Integration, HR-Schnittstellen, Custom-Onboarding für größere Teams.</p>
      <ul><li>DATEV-Export</li><li>REST API für Dritte</li><li>Whitelabel</li></ul>
    </div>
  </div>
</div>

<!-- ═══ FAQ ══════════════════════════════════════════════════════════════════ -->
<div class="section">
  <div class="section-head">
    <div class="tag">FAQ</div>
    <h2>Häufige Fragen.</h2>
  </div>
  <div class="faq">
    <div class="faq-item">
      <div class="faq-q">Was bekomme ich als Beta-Tester?</div>
      <div class="faq-a"><p>Eine <strong>lebenslange Stempeluhr-Lizenz</strong> — komplett kostenlos, für immer freigeschaltet, automatisch auf deinen Account bei Release aktiviert. Kein Abo, keine monatlichen Kosten.</p></div>
    </div>
    <div class="faq-item">
      <div class="faq-q">Warum aktuell nur in Deutschland?</div>
      <div class="faq-a"><p>CustoSoft wird für den deutschen Markt entwickelt — Sprache, Rechtslage (Arbeitszeitgesetz, DSGVO), Lohnbuchhaltungs-Export. Weitere Länder folgen sobald Lokalisierungen fertig sind.</p></div>
    </div>
    <div class="faq-item">
      <div class="faq-q">Warum nur Apple-Geräte?</div>
      <div class="faq-a"><p>Wir haben uns bewusst für 100 % native Entwicklung entschieden — Swift auf Apple, Kotlin auf Android. Kein Cross-Platform-Kompromiss. Web & Android kommen nativ in separaten Phasen.</p></div>
    </div>
    <div class="faq-item">
      <div class="faq-q">Wo liegen meine Daten?</div>
      <div class="faq-a"><p>Alle Daten liegen auf Cloudflare-Servern in der EU-Region Frankfurt. Kein US-Hosting, keine Drittanbieter-Analytics, kein Werbe-Tracking. Details in der <a href="/datenschutz" style="color:#c594ff">Datenschutzerklärung</a>.</p></div>
    </div>
    <div class="faq-item">
      <div class="faq-q">Kann ich die App auch ohne Abo nutzen?</div>
      <div class="faq-a"><p>Ja — <strong>Bewerbungsmanager (9,99 €)</strong>, <strong>Wand-Stempeluhr (14,99 €)</strong> und <strong>Mehr Platz (4,99 €)</strong> sind Dauerlizenzen ohne Abo. Die Stempeluhr läuft als Wochen-Abo (2,99 €/Woche), jederzeit kündbar. Ohne Kauf steht ein kostenloser Bewerber-Modus zur Verfügung.</p></div>
    </div>
  </div>
</div>

${commonFooter()}

<script>
// ── Beta-Counter animate (live aus DB) ──────────────────────────────────────
(function() {
  var el   = document.getElementById('betaCount');
  var fill = document.querySelector('.beta-progress-fill');
  var lbl  = document.querySelector('.spots-label');
  function animateTo(target, limit) {
    var duration = 1800, startTime = null;
    function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
    function step(ts) {
      if (!startTime) startTime = ts;
      var p = Math.min((ts - startTime) / duration, 1);
      el.textContent = Math.round(easeOut(p) * target);
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
    if (fill) fill.style.setProperty('--p', Math.min(100, Math.round(target / limit * 100)) + '%');
    if (lbl)  lbl.innerHTML = 'von <strong>' + limit + '</strong> Beta-Plätzen vergeben';
  }
  fetch('/beta-count')
    .then(function(r) { return r.json(); })
    .then(function(d) { setTimeout(function() { animateTo(d.count || 0, d.limit || 100); }, 400); })
    .catch(function() { animateTo(0, 100); });
})();

// ── Smooth scroll ───────────────────────────────────────────────────────────
document.querySelectorAll('a[href^="#"]').forEach(function(a) {
  a.addEventListener('click', function(e) {
    var id = a.getAttribute('href').slice(1);
    var el = document.getElementById(id);
    if (el) { e.preventDefault(); el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  });
});

// ── FAQ accordion ───────────────────────────────────────────────────────────
document.querySelectorAll('.faq-item').forEach(function(item) {
  var q = item.querySelector('.faq-q');
  var a = item.querySelector('.faq-a');
  q.addEventListener('click', function() {
    var isOpen = item.classList.contains('open');
    document.querySelectorAll('.faq-item').forEach(function(i) {
      i.classList.remove('open');
      i.querySelector('.faq-a').style.height = '0';
    });
    if (!isOpen) {
      item.classList.add('open');
      a.style.height = a.scrollHeight + 'px';
    }
  });
});

// ── Beta form submit ────────────────────────────────────────────────────────
document.getElementById('betaSubmit').addEventListener('click', function() {
  var email = document.getElementById('bf-email').value.trim();
  var name  = document.getElementById('bf-name').value.trim();
  var device = document.getElementById('bf-device').value;
  var team   = document.getElementById('bf-team').value;
  var errEl  = document.getElementById('betaError');
  errEl.style.display = 'none';
  if (!email || email.indexOf('@') < 0) {
    errEl.textContent = 'Bitte gib eine gültige E-Mail-Adresse ein.';
    errEl.style.display = 'block';
    return;
  }
  var btn = this;
  btn.disabled = true;
  btn.textContent = 'Wird registriert …';
  fetch('/beta-signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email, firstName: name, device: device, teamSize: team })
  }).then(function(r) { return r.json(); }).then(function(data) {
    if (data.ok) {
      document.getElementById('betaFormWrap').style.display = 'none';
      document.getElementById('betaSuccess').style.display = 'block';
    } else {
      errEl.textContent = data.error || 'Ein Fehler ist aufgetreten. Bitte versuch es nochmal.';
      errEl.style.display = 'block';
      btn.disabled = false;
      btn.textContent = '🚀 Jetzt bewerben — kostenlos';
    }
  }).catch(function() {
    errEl.textContent = 'Netzwerkfehler. Bitte versuch es nochmal.';
    errEl.style.display = 'block';
    btn.disabled = false;
    btn.textContent = '🚀 Jetzt bewerben — kostenlos';
  });
});
</script>
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
<p><strong>David Schrödinger</strong><br>
CustoSoft<br>
Badstubweg 3<br>
87487 Wiggensbach<br>
Deutschland</p>

<h2>Kontakt</h2>
<p>E-Mail: <a href="mailto:custosoftsupportde@gmail.com">custosoftsupportde@gmail.com</a><br>
Web: <a href="https://api.custosoft.de">api.custosoft.de</a></p>

<h2>Umsatzsteuer</h2>
<p>Gemäß § 19 UStG wird keine Umsatzsteuer berechnet (Kleinunternehmerregelung).</p>

<h2>Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV</h2>
<p>David Schrödinger, Anschrift wie oben.</p>

<h2>Streitschlichtung</h2>
<p>Die Europäische Kommission stellt eine Plattform zur Online-Streitbeilegung (OS) bereit:
<a href="https://ec.europa.eu/consumers/odr" target="_blank" rel="noopener">https://ec.europa.eu/consumers/odr</a>.<br>
Wir sind nicht bereit und nicht verpflichtet, an einem Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen.</p>

<h2>Haftung für Inhalte</h2>
<p>Als Diensteanbieter sind wir für eigene Inhalte auf diesen Seiten nach den allgemeinen Gesetzen verantwortlich (§ 7 Abs.1 TMG). Wir sind jedoch nicht verpflichtet, übermittelte oder gespeicherte fremde Informationen zu überwachen oder nach Umständen zu forschen, die auf eine rechtswidrige Tätigkeit hinweisen (§§ 8–10 TMG). Eine diesbezügliche Haftung ist jedoch erst ab dem Zeitpunkt der Kenntnis einer konkreten Rechtsverletzung möglich.</p>

<h2>Haftung für Links</h2>
<p>Unser Angebot enthält Links zu externen Websites Dritter, auf deren Inhalte wir keinen Einfluss haben. Deshalb können wir für diese fremden Inhalte auch keine Gewähr übernehmen. Rechtswidrige Inhalte waren zum Zeitpunkt der Verlinkung nicht erkennbar.</p>

<h2>Urheberrecht</h2>
<p>Die durch den Seitenbetreiber erstellten Inhalte auf diesen Seiten unterliegen dem deutschen Urheberrecht. Die Vervielfältigung, Bearbeitung, Verbreitung und jede Art der Verwertung außerhalb der Grenzen des Urheberrechtes bedürfen der schriftlichen Zustimmung des jeweiligen Autors.</p>`
}

function defaultDatenschutz(): string {
  return `
<h2>1. Verantwortlicher</h2>
<p>Verantwortlicher für die Datenverarbeitung im Sinne der DSGVO ist:<br>
<strong>David Schrödinger</strong> · CustoSoft<br>
Badstubweg 3 · 87487 Wiggensbach<br>
E-Mail: <a href="mailto:custosoftsupportde@gmail.com">custosoftsupportde@gmail.com</a></p>

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

<h2>8. Drittanbieter-Dienste</h2>
<p>Wir nutzen folgende Drittanbieter für den Betrieb:</p>
<ul>
  <li><strong>Cloudflare</strong> (EU-Region Frankfurt) — Edge-Hosting, D1-Datenbank, R2-Objektspeicher. Cloudflare ist nach DSGVO Auftragsverarbeiter. Angemessenheitsbeschluss EU-US Data Privacy Framework vorhanden.</li>
  <li><strong>Resend</strong> — transaktionale E-Mails (Kaufbestätigung, Passwort-Reset). Keine Marketingmails.</li>
  <li><strong>Apple</strong> — Zahlungsabwicklung für In-App-Käufe. Wir erhalten ausschließlich anonymisierte Transaction-IDs, keine Zahlungsdaten.</li>
</ul>

<h2>9. Beschwerderecht</h2>
<p>Du hast das Recht, dich bei einer Datenschutz-Aufsichtsbehörde zu beschweren. Zuständig für Bayern ist das Bayerische Landesamt für Datenschutzaufsicht (BayLDA), Postfach 606, 91511 Ansbach, <a href="https://www.lda.bayern.de" target="_blank" rel="noopener">www.lda.bayern.de</a>.</p>

<p><em>Stand: 04.05.2026</em></p>`
}

function defaultAGB(): string {
  return `
<h2>1. Geltungsbereich und Anbieter</h2>
<p>Diese Allgemeinen Geschäftsbedingungen (AGB) gelten für alle Verträge zwischen</p>
<p><strong>David Schrödinger</strong> · CustoSoft<br>
Badstubweg 3 · 87487 Wiggensbach<br>
E-Mail: <a href="mailto:custosoftsupportde@gmail.com">custosoftsupportde@gmail.com</a></p>
<p>und Nutzern der iOS/iPadOS/macOS-App „CustoSoft" (nachfolgend „App").</p>

<h2>2. Vertragsschluss</h2>
<p>Die App kann kostenlos aus dem Apple App Store geladen werden. Kostenpflichtige Funktionen (In-App-Käufe und Abonnements) werden ausschließlich über den Apple App Store abgerechnet. Mit dem Kauf im App Store kommt der Kaufvertrag direkt zwischen dem Nutzer und Apple Inc. gemäß den Apple Media Services-Nutzungsbedingungen zustande. CustoSoft erbringt die gebuchte digitale Leistung (Freischaltung der Funktion) unverzüglich nach Bestätigung durch Apple.</p>

<h2>3. Leistungsumfang</h2>
<p>CustoSoft bietet folgende Funktionen — teils kostenlos, teils kostenpflichtig:</p>
<ul>
  <li><strong>Stempeluhr</strong>: Digitale Zeiterfassung, Pausen, Wochen-Statistik, Dynamic-Island-Live-Anzeige, CSV-Export</li>
  <li><strong>Wand-Stempeluhr</strong>: iPad im Kiosk-Modus, persönlicher PIN-Code für Mitarbeiter</li>
  <li><strong>Bewerbungsmanager</strong>: Erstellung von Bewerbungs-Links, Verwaltung eingehender Bewerbungen</li>
  <li><strong>Business Basic</strong>: Organisations-Verwaltung bis 10 Mitarbeiter-Slots inkl. Akten, Chat, Lohnauswertung</li>
  <li><strong>Business L</strong>: Wie Business Basic, bis 50 Mitarbeiter-Slots</li>
</ul>
<p>Der Anbieter behält sich vor, den Leistungsumfang im Rahmen technischer Weiterentwicklungen anzupassen, sofern dies dem Nutzer zumutbar ist.</p>

<h2>4. Preise und Zahlung</h2>
<p>Alle Preise werden im App Store in EUR angezeigt. Da der Anbieter Kleinunternehmer gemäß § 19 UStG ist, wird keine Mehrwertsteuer ausgewiesen. Die Abwicklung erfolgt vollständig über Apple; der Anbieter erhält keine Zahlungsdaten.</p>
<ul>
  <li><strong>Stempeluhr</strong>: 2,99 € alle 2 Wochen (14 Tage kostenlos testen)</li>
  <li><strong>Bewerbungsmanager</strong>: 16,99 € einmalig</li>
  <li><strong>Wand-Stempeluhr</strong>: 9,99 € einmalig</li>
  <li><strong>Business Basic</strong>: 49,00 €/Monat oder 469,00 €/Jahr (ca. 39,08 €/Monat)</li>
  <li><strong>Business L</strong>: 89,00 €/Monat oder 849,00 €/Jahr (ca. 70,75 €/Monat)</li>
</ul>

<h2>5. Abonnements und automatische Verlängerung</h2>
<p>Abonnements verlängern sich automatisch um den jeweiligen Zeitraum, sofern sie nicht spätestens 24 Stunden vor Ablauf des laufenden Zeitraums gekündigt werden. Kündigung und Verwaltung sind ausschließlich über iPhone-/iPad-Einstellungen → Apple-ID → Abonnements möglich.</p>

<h2>6. Org-Lizenzvererbung</h2>
<p>Inhaber einer Business-Lizenz können Mitarbeiter in eine Organisation einladen. Eingeladene Mitglieder erhalten während ihrer aktiven Mitgliedschaft automatisch Zugang zu den vom Organisations-Inhaber lizenzierten Funktionen. Mit dem Verlassen oder Ausschluss aus der Organisation erlischt dieser abgeleitete Zugang sofort. Die Mitgliedschaft begründet keinen eigenständigen Lizenzanspruch.</p>

<h2>7. Widerruf bei digitalen Inhalten</h2>
<p>Verbraucher haben grundsätzlich ein 14-tägiges Widerrufsrecht. Da die Freischaltung digitaler Inhalte unmittelbar nach dem Kauf beginnt, erlischt das Widerrufsrecht mit Beginn der Ausführung, sofern der Nutzer vor dem Kauf ausdrücklich zugestimmt hat (§ 356 Abs. 5 BGB). Refunds können direkt bei Apple über <a href="https://reportaproblem.apple.com" target="_blank" rel="noopener">reportaproblem.apple.com</a> beantragt werden. Details: <a href="/widerruf">Widerrufsbelehrung</a>.</p>

<h2>8. Verfügbarkeit</h2>
<p>Der Anbieter strebt eine hohe Verfügbarkeit an, übernimmt jedoch keine Gewähr für eine ununterbrochene Erreichbarkeit. Geplante Wartungen werden nach Möglichkeit angekündigt.</p>

<h2>9. Nutzerpflichten</h2>
<p>Der Nutzer verpflichtet sich, die App nicht für rechtswidrige Zwecke zu verwenden, keine automatisierten Massenzugriffe (Scraping, Bots) durchzuführen und Zugangsdaten sicher zu verwahren.</p>

<h2>10. Haftungsbeschränkung</h2>
<p>Der Anbieter haftet unbeschränkt für Vorsatz und grobe Fahrlässigkeit sowie bei Verletzung von Leben, Körper und Gesundheit. Bei leichter Fahrlässigkeit haftet der Anbieter nur bei Verletzung wesentlicher Vertragspflichten, begrenzt auf den typischerweise vorhersehbaren Schaden. Eine weitergehende Haftung ist ausgeschlossen.</p>

<h2>11. Datenschutz</h2>
<p>Informationen zur Verarbeitung personenbezogener Daten finden sich in unserer <a href="/datenschutz">Datenschutzerklärung</a>.</p>

<h2>12. Änderungen der AGB</h2>
<p>Der Anbieter behält sich vor, diese AGB mit einer Vorankündigungsfrist von mindestens 30 Tagen (per E-Mail oder In-App-Hinweis) zu ändern. Widerspricht der Nutzer nicht innerhalb dieser Frist, gelten die geänderten AGB als angenommen.</p>

<h2>13. Anwendbares Recht und Gerichtsstand</h2>
<p>Es gilt das Recht der Bundesrepublik Deutschland unter Ausschluss des UN-Kaufrechts (CISG). Für Verbraucher mit Wohnsitz in der EU gilt vorrangig das zwingende Verbraucherschutzrecht des Wohnsitzstaates.</p>

<p><em>Stand: 04.05.2026</em></p>`
}

function defaultWiderruf(): string {
  return `
<h2>Widerrufsbelehrung</h2>

<h3>Widerrufsrecht</h3>
<p>Als Verbraucher haben Sie das Recht, binnen 14 Tagen ohne Angabe von Gründen diesen Vertrag zu widerrufen. Die Widerrufsfrist beträgt 14 Tage ab dem Tag des Vertragsschlusses.</p>

<h3>Ausübung des Widerrufsrechts</h3>
<p>Um Ihr Widerrufsrecht auszuüben, müssen Sie uns</p>
<p><strong>David Schrödinger · CustoSoft</strong><br>
Badstubweg 3 · 87487 Wiggensbach<br>
E-Mail: <a href="mailto:custosoftsupportde@gmail.com">custosoftsupportde@gmail.com</a></p>
<p>mittels einer eindeutigen Erklärung (z.B. per E-Mail) über Ihren Entschluss, diesen Vertrag zu widerrufen, informieren. Sie können dafür das folgende Muster-Widerrufsformular verwenden, das jedoch nicht vorgeschrieben ist.</p>

<h3>Muster-Widerrufsformular</h3>
<p style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.12);padding:16px;border-radius:10px;font-size:13px;line-height:1.8">
An: David Schrödinger · CustoSoft · custosoftsupportde@gmail.com<br><br>
Hiermit widerrufe(n) ich/wir den von mir/uns abgeschlossenen Vertrag über den Kauf der folgenden digitalen Inhalte:<br>
— Datum des Vertragsabschlusses: ___________<br>
— Name des/der Verbraucher(s): ___________<br>
— Unterschrift (nur bei Mitteilung auf Papier): ___________<br>
— Datum: ___________
</p>

<h3>Folgen des Widerrufs</h3>
<p>Wenn Sie diesen Vertrag widerrufen, erstatten wir Ihnen alle Zahlungen, die wir von Ihnen erhalten haben, unverzüglich und spätestens binnen 14 Tagen. Da die Zahlung über Apple abgewickelt wurde, erfolgt die Rückerstattung über den Apple-Kundenservice.</p>

<h3>Vorzeitiges Erlöschen des Widerrufsrechts</h3>
<p>Das Widerrufsrecht erlischt vorzeitig, wenn</p>
<ul>
  <li>der Anbieter mit der Ausführung des Vertrags begonnen hat,</li>
  <li>der Verbraucher vor der Ausführung ausdrücklich zugestimmt hat, dass der Anbieter mit der Ausführung vor Ablauf der Widerrufsfrist beginnt, und</li>
  <li>der Verbraucher seine Kenntnis davon bestätigt hat, dass er durch seine Zustimmung sein Widerrufsrecht mit Beginn der Ausführung des Vertrags verliert (§ 356 Abs. 5 BGB).</li>
</ul>
<p>Da In-App-Käufe sofort nach Apple-Bestätigung freigeschaltet werden und der Nutzer im App Store durch Abschluss des Kaufvorgangs dieser sofortigen Ausführung zustimmt, erlischt das Widerrufsrecht in der Regel mit der Freischaltung der Funktion.</p>

<h3>Refunds direkt über Apple</h3>
<p>Da alle Zahlungen ausschließlich über den Apple App Store verarbeitet werden, können Rückerstattungen direkt bei Apple beantragt werden:<br>
<a href="https://reportaproblem.apple.com" target="_blank" rel="noopener">reportaproblem.apple.com</a></p>

<p><em>Stand: 04.05.2026</em></p>`
}
