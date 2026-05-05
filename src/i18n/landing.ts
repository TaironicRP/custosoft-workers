// ─────────────────────────────────────────────────────────────────────────────
// i18n — Marketing landing page, locale-aware
// ─────────────────────────────────────────────────────────────────────────────
//
// One function: buildLandingHtml(locale) → full HTML response.
// All visible text comes from `strings.ts`, all routing through `nav.ts`.
// Style/animations are locale-independent and inlined here.
// ─────────────────────────────────────────────────────────────────────────────

import { LOCALE_HTML_TAG, type Locale } from './locales'
import { commonNav, commonFooter } from './nav'
import { t } from './strings'
import { SHARED_STYLE } from './shared-style'

export function buildLandingHtml(locale: Locale): string {
  const lang = LOCALE_HTML_TAG[locale]
  const base = `/${locale}`

  return `<!DOCTYPE html>
<html lang="${lang}"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${t('meta_title', locale)}</title>
<meta name="description" content="${t('meta_description', locale)}">
<meta property="og:title" content="${t('meta_og_title', locale)}">
<meta property="og:description" content="${t('meta_og_desc', locale)}">
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
${commonNav(locale)}

<!-- ═══ HERO ═══════════════════════════════════════════════════════════════ -->
<div class="hero-wrap">
  <div class="orb orb1"></div>
  <div class="orb orb2"></div>
  <div class="orb orb3"></div>
  <div class="hero-inner">
    <div class="hero-text">
      <div class="badge"><span class="dot"></span>${t('hero_badge', locale)}</div>
      <h1>${t('hero_h1_line1', locale)}<br>${t('hero_h1_line2', locale)}<br><em>${t('hero_h1_em', locale)}</em></h1>
      <p class="sub">${t('hero_sub', locale)}</p>
      <div class="platform-strip">
        <span class="plat-badge"><span class="ico"></span> iOS 17+</span>
        <span class="plat-badge"><span class="ico"></span> iPadOS 17+</span>
        <span class="plat-badge"><span class="ico"></span> macOS 14+</span>
        <span class="avail-badge">${t('hero_avail_de', locale)}</span>
        <span class="coming-badge">${t('hero_coming', locale)}</span>
      </div>
      <div class="hero-cta-row">
        <a href="#beta" class="cta cta-primary">${t('hero_cta_apply', locale)}</a>
        <a href="#features" class="cta cta-secondary">${t('hero_cta_features', locale)}</a>
      </div>
    </div>

    <div class="phone-wrap">
      <div class="phone">
        <div class="phone-side-btn"></div><div class="phone-side-btn2"></div>
        <div class="phone-vol"></div><div class="phone-vol2"></div>
        <div class="phone-screen">
          <div class="p-nav"><span class="p-title">${t('phone_punch', locale)}</span><span class="p-time">09:41</span></div>
          <div class="p-row">
            <div class="p-card"><div class="p-label">${t('phone_since', locale)}</div><div class="p-val green">07:38 h</div></div>
            <div class="p-card"><div class="p-label">${t('phone_break', locale)}</div><div class="p-val amber">0:23 h</div></div>
          </div>
          <div class="p-row">
            <div class="p-card"><div class="p-label">${t('phone_week', locale)}</div><div class="p-val">31:12 h</div></div>
            <div class="p-card"><div class="p-label">${t('phone_team_active', locale)}</div><div class="p-val">7/12</div></div>
          </div>
          <div class="p-stamp-btn">${t('phone_stamped', locale)}</div>
          <div class="p-members">
            <div class="p-label">${t('phone_team_today', locale)}</div>
            <div class="p-member"><div class="p-av">DK</div><span class="p-name">Davina K.</span><span class="p-status">${t('phone_active', locale)}</span></div>
            <div class="p-member"><div class="p-av" style="background:linear-gradient(135deg,#0fbf73,#0080cc)">MR</div><span class="p-name">Max R.</span><span class="p-status">${t('phone_active', locale)}</span></div>
            <div class="p-member"><div class="p-av" style="background:linear-gradient(135deg,#ff7030,#dd3355)">LP</div><span class="p-name">Lisa P.</span><span class="p-status" style="color:#ffb733">${t('phone_paused', locale)}</span></div>
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
    <span class="spots-label">${t('beta_of', locale)} <strong>100</strong> ${t('beta_spots', locale)}</span>
    <div class="beta-progress"><div class="beta-progress-fill"></div></div>
    <span style="font-size:13px;color:rgba(255,255,255,.5)">${t('beta_reward_short', locale)}</span>
  </div>
</div>

<!-- ═══ PLATFORM ════════════════════════════════════════════════════════════ -->
<div class="section" id="platform">
  <div class="section-head">
    <div class="tag">${t('platforms_tag', locale)}</div>
    <h2>${t('platforms_h2', locale)}</h2>
    <p>${t('platforms_sub', locale)}</p>
  </div>
  <div class="platform-cards">
    <div class="plat-card">
      <span class="p-icon"></span>
      <h3>iPhone</h3>
      <div class="p-desc">${t('plat_iphone_desc', locale)}</div>
    </div>
    <div class="plat-card">
      <span class="p-icon"></span>
      <h3>iPad</h3>
      <div class="p-desc">${t('plat_ipad_desc', locale)}</div>
    </div>
    <div class="plat-card">
      <span class="p-icon"></span>
      <h3>Mac</h3>
      <div class="p-desc">${t('plat_mac_desc', locale)}</div>
    </div>
    <div class="plat-card coming">
      <span class="p-icon">🌐</span>
      <h3>Web</h3>
      <div class="p-desc">${t('plat_web_desc', locale)}</div>
      <div class="coming-tag">${t('plat_planned', locale)}</div>
    </div>
    <div class="plat-card coming">
      <span class="p-icon">🤖</span>
      <h3>Android</h3>
      <div class="p-desc">${t('plat_android_desc', locale)}</div>
      <div class="coming-tag">${t('plat_planned', locale)}</div>
    </div>
  </div>
</div>

<!-- ═══ FEATURES ════════════════════════════════════════════════════════════ -->
<div class="section" id="features">
  <div class="section-head">
    <div class="tag">${t('features_tag', locale)}</div>
    <h2>${t('features_h2', locale)}</h2>
    <p>${t('features_sub', locale)}</p>
  </div>
  <div class="features-grid">
    <div class="feat fc1">
      <span class="f-icon">⏱</span>
      <h3>${t('feat_punch_h', locale)}</h3>
      <p>${t('feat_punch_p', locale)}</p>
      <span class="f-tag">${t('feat_punch_tag', locale)}</span>
    </div>
    <div class="feat fc2">
      <span class="f-icon">📋</span>
      <h3>${t('feat_recruit_h', locale)}</h3>
      <p>${t('feat_recruit_p', locale)}</p>
      <span class="f-tag">${t('feat_recruit_tag', locale)}</span>
    </div>
    <div class="feat fc3">
      <span class="f-icon">🪧</span>
      <h3>${t('feat_wall_h', locale)}</h3>
      <p>${t('feat_wall_p', locale)}</p>
      <span class="f-tag">${t('feat_wall_tag', locale)}</span>
    </div>
    <div class="feat fc4">
      <span class="f-icon">💬</span>
      <h3>${t('feat_chat_h', locale)}</h3>
      <p>${t('feat_chat_p', locale)}</p>
      <span class="f-tag">${t('feat_chat_tag', locale)}</span>
    </div>
    <div class="feat fc5">
      <span class="f-icon">🏢</span>
      <h3>${t('feat_org_h', locale)}</h3>
      <p>${t('feat_org_p', locale)}</p>
      <span class="f-tag">${t('feat_org_tag', locale)}</span>
    </div>
    <div class="feat fc6">
      <span class="f-icon">📁</span>
      <h3>${t('feat_files_h', locale)}</h3>
      <p>${t('feat_files_p', locale)}</p>
      <span class="f-tag">${t('feat_files_tag', locale)}</span>
    </div>
  </div>
</div>

<!-- ═══ BETA SIGNUP ══════════════════════════════════════════════════════════ -->
<div class="section" id="beta">
  <div class="beta-section">
    <div class="section-head" style="margin-bottom:16px">
      <div class="tag">${t('beta_tag', locale)}</div>
      <h2>${t('beta_h2_l1', locale)}<br>${t('beta_h2_l2', locale)}</h2>
    </div>
    <div class="reward-box">
      <span class="r-icon">🎁</span>
      <div class="r-text">
        <strong>${t('beta_reward_strong', locale)}</strong>
        <span>${t('beta_reward_sub', locale)}</span>
      </div>
    </div>

    <div class="beta-form" id="betaFormWrap">
      <div class="form-row">
        <div class="form-field">
          <label>${t('form_first_name', locale)}</label>
          <input type="text" id="bf-name" placeholder="${t('form_first_name_ph', locale)}" autocomplete="given-name">
        </div>
        <div class="form-field">
          <label>${t('form_email', locale)}</label>
          <input type="email" id="bf-email" placeholder="${t('form_email_ph', locale)}" autocomplete="email" required>
        </div>
      </div>
      <div class="form-row">
        <div class="form-field">
          <label>${t('form_device', locale)}</label>
          <select id="bf-device">
            <option value="">${t('form_device_choose', locale)}</option>
            <option value="iphone">${t('form_device_iphone', locale)}</option>
            <option value="ipad">${t('form_device_ipad', locale)}</option>
            <option value="mac">${t('form_device_mac', locale)}</option>
            <option value="multiple">${t('form_device_multi', locale)}</option>
          </select>
        </div>
        <div class="form-field">
          <label>${t('form_team', locale)}</label>
          <select id="bf-team">
            <option value="">${t('form_team_solo', locale)}</option>
            <option value="2-5">${t('form_team_2_5', locale)}</option>
            <option value="6-20">${t('form_team_6_20', locale)}</option>
            <option value="20+">${t('form_team_20p', locale)}</option>
          </select>
        </div>
      </div>
      <button class="form-submit" id="betaSubmit" type="button" data-default-label="${t('form_submit', locale)}">${t('form_submit', locale)}</button>
      <div class="form-error" id="betaError"></div>
      <p class="form-note">${t('form_note', locale)}</p>
    </div>

    <div class="form-success" id="betaSuccess">
      <div class="success-icon">🎉</div>
      <h3>${t('form_success_h', locale)}</h3>
      <p>${t('form_success_p', locale)}</p>
      <p style="margin-top:16px;font-size:12px;opacity:.5">${t('form_success_spam', locale)}</p>
    </div>
  </div>
</div>

<!-- ═══ ROADMAP ══════════════════════════════════════════════════════════════ -->
<div class="section">
  <div class="section-head">
    <div class="tag">${t('roadmap_tag', locale)}</div>
    <h2>${t('roadmap_h2', locale)}</h2>
    <p>${t('roadmap_sub', locale)}</p>
  </div>
  <div class="roadmap">
    <div class="rm-card active">
      <div class="rm-dot done"></div>
      <div class="rm-phase">${t('rm1_phase', locale)}</div>
      <h4>${t('rm1_h', locale)}</h4>
      <p>${t('rm1_p', locale)}</p>
      <ul><li>${t('rm1_li1', locale)}</li><li>${t('rm1_li2', locale)}</li><li>${t('rm1_li3', locale)}</li></ul>
    </div>
    <div class="rm-card next">
      <div class="rm-dot soon"></div>
      <div class="rm-phase">${t('rm2_phase', locale)}</div>
      <h4>${t('rm2_h', locale)}</h4>
      <p>${t('rm2_p', locale)}</p>
      <ul><li>${t('rm2_li1', locale)}</li><li>${t('rm2_li2', locale)}</li><li>${t('rm2_li3', locale)}</li></ul>
    </div>
    <div class="rm-card">
      <div class="rm-dot later"></div>
      <div class="rm-phase">${t('rm3_phase', locale)}</div>
      <h4>${t('rm3_h', locale)}</h4>
      <p>${t('rm3_p', locale)}</p>
      <ul><li>${t('rm3_li1', locale)}</li><li>${t('rm3_li2', locale)}</li><li>${t('rm3_li3', locale)}</li></ul>
    </div>
    <div class="rm-card">
      <div class="rm-dot later"></div>
      <div class="rm-phase">${t('rm4_phase', locale)}</div>
      <h4>${t('rm4_h', locale)}</h4>
      <p>${t('rm4_p', locale)}</p>
      <ul><li>${t('rm4_li1', locale)}</li><li>${t('rm4_li2', locale)}</li><li>${t('rm4_li3', locale)}</li></ul>
    </div>
  </div>
</div>

<!-- ═══ FAQ ══════════════════════════════════════════════════════════════════ -->
<div class="section">
  <div class="section-head">
    <div class="tag">${t('faq_tag', locale)}</div>
    <h2>${t('faq_h2', locale)}</h2>
  </div>
  <div class="faq">
    <div class="faq-item">
      <div class="faq-q">${t('faq1_q', locale)}</div>
      <div class="faq-a"><p>${t('faq1_a', locale)}</p></div>
    </div>
    <div class="faq-item">
      <div class="faq-q">${t('faq2_q', locale)}</div>
      <div class="faq-a"><p>${t('faq2_a', locale)}</p></div>
    </div>
    <div class="faq-item">
      <div class="faq-q">${t('faq3_q', locale)}</div>
      <div class="faq-a"><p>${t('faq3_a', locale)}</p></div>
    </div>
    <div class="faq-item">
      <div class="faq-q">${t('faq4_q', locale)}</div>
      <div class="faq-a"><p>${t('faq4_a', locale, base)}</p></div>
    </div>
    <div class="faq-item">
      <div class="faq-q">${t('faq5_q', locale)}</div>
      <div class="faq-a"><p>${t('faq5_a', locale)}</p></div>
    </div>
  </div>
</div>

${commonFooter(locale)}

<script>
// ── Beta-Counter (locale-aware label via data-attr) ─────────────────────────
(function() {
  var el   = document.getElementById('betaCount');
  var fill = document.querySelector('.beta-progress-fill');
  var lbl  = document.querySelector('.spots-label');
  var labelTpl = ${JSON.stringify(t('beta_count_label_html', locale, '__N__'))};
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
    if (lbl)  lbl.innerHTML = labelTpl.replace('__N__', String(limit));
  }
  fetch('/beta-count')
    .then(function(r) { return r.json(); })
    .then(function(d) { setTimeout(function() { animateTo(d.count || 0, d.limit || 100); }, 400); })
    .catch(function() { animateTo(0, 100); });
})();

document.querySelectorAll('a[href^="#"]').forEach(function(a) {
  a.addEventListener('click', function(e) {
    var id = a.getAttribute('href').slice(1);
    var el = document.getElementById(id);
    if (el) { e.preventDefault(); el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  });
});

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

document.getElementById('betaSubmit').addEventListener('click', function() {
  var email = document.getElementById('bf-email').value.trim();
  var name  = document.getElementById('bf-name').value.trim();
  var device = document.getElementById('bf-device').value;
  var team   = document.getElementById('bf-team').value;
  var errEl  = document.getElementById('betaError');
  var btn = this;
  var defaultLabel = btn.getAttribute('data-default-label');
  var msgInvalid   = ${JSON.stringify(t('form_invalid_email', locale))};
  var msgNetwork   = ${JSON.stringify(t('form_network_err', locale))};
  var msgSubmit    = ${JSON.stringify(t('form_submitting', locale))};
  errEl.style.display = 'none';
  if (!email || email.indexOf('@') < 0) {
    errEl.textContent = msgInvalid;
    errEl.style.display = 'block';
    return;
  }
  btn.disabled = true;
  btn.textContent = msgSubmit;
  fetch('/beta-signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email, firstName: name, device: device, teamSize: team })
  }).then(function(r) { return r.json(); }).then(function(data) {
    if (data.ok) {
      document.getElementById('betaFormWrap').style.display = 'none';
      document.getElementById('betaSuccess').style.display = 'block';
    } else {
      errEl.textContent = data.error || msgNetwork;
      errEl.style.display = 'block';
      btn.disabled = false;
      btn.textContent = defaultLabel;
    }
  }).catch(function() {
    errEl.textContent = msgNetwork;
    errEl.style.display = 'block';
    btn.disabled = false;
    btn.textContent = defaultLabel;
  });
});
</script>
</body></html>`
}
