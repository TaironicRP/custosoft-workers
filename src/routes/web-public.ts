// ── Public Website — Marketing-Seiten + Legal (Apple Pflicht) ────────────────
//
// Locale-aware. URL pattern: /:locale/...
// Legacy bare URLs (/, /impressum, …) redirect to the user's preferred locale.
// All view templates live under src/i18n/ — this file only does routing.
// ─────────────────────────────────────────────────────────────────────────────

import { Hono }     from 'hono'
import type { Env, AppEnv } from '../types'
import { sendEmail } from '../utils/email'
import {
  detectLocale, isLocale, langCookie, type Locale,
} from '../i18n/locales'
import {
  LEGAL_TITLES, LEGAL_SLUGS, canonicalSlug,
  defaultImpressum, defaultDatenschutz, defaultAGB, defaultWiderruf,
} from '../i18n/legal'
import { buildLandingHtml }   from '../i18n/landing'
import { legalPageHtml }      from '../i18n/legal-page'
import { commonNav, commonFooter } from '../i18n/nav'
import { SHARED_STYLE }       from '../i18n/shared-style'
import { t }                  from '../i18n/strings'

const webPublic = new Hono<AppEnv>()

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Load a locale-specific legal-page override from D1.
 *
 * Looks up `legal_pages WHERE slug = ? AND locale = ?` first. If the column
 * `locale` doesn't exist yet (pre-migration), falls back to a slug-only
 * lookup — but **only** for the development locale (`de`). Other locales
 * fall through to the in-code default in `legal.ts`, so a German DB
 * override never bleeds into `/en/privacy`.
 */
async function loadLegal(env: Env, slug: string, locale: Locale) {
  // Try locale-aware lookup (post-migration schema)
  try {
    const row = await env.DB
      .prepare('SELECT title, content FROM legal_pages WHERE slug = ? AND locale = ?')
      .bind(slug, locale).first<{ title: string; content: string }>()
    if (row) return row
  } catch {
    // `locale` column not present yet — old schema. Continue with legacy path.
  }
  // Legacy path: a single row per slug is treated as the German source.
  if (locale === 'de') {
    return env.DB.prepare('SELECT title, content FROM legal_pages WHERE slug = ?')
      .bind(slug).first<{ title: string; content: string }>()
  }
  return null
}

/** Render a legal page for the given canonical slug + locale. */
async function renderLegal(c: any, canonical: 'impressum' | 'datenschutz' | 'agb' | 'widerruf', locale: Locale) {
  const p = await loadLegal(c.env, canonical, locale)
  const title = LEGAL_TITLES[canonical][locale]
  let content = p?.content
  if (!content) {
    switch (canonical) {
      case 'impressum':   content = defaultImpressum(locale);   break
      case 'datenschutz': content = defaultDatenschutz(locale); break
      case 'agb':         content = defaultAGB(locale);         break
      case 'widerruf':    content = defaultWiderruf(locale);    break
    }
  }
  return c.html(legalPageHtml(title, content!, locale))
}

// ── Root: detect locale & redirect to /<locale>/ ─────────────────────────────
webPublic.get('/', (c) => {
  const locale = detectLocale(c)
  return c.redirect(`/${locale}/`, 302)
})

// ── Language switcher: /lang/:code → set cookie + redirect to localised path ──
webPublic.get('/lang/:code', (c) => {
  const code = c.req.param('code')
  if (!isLocale(code)) return c.redirect('/', 302)
  const referer = c.req.header('Referer') || `/${code}/`
  // Replace any /xx/ prefix in the Referer with /:code/ to keep the user on
  // the same page in the new language.
  const localised = referer.replace(/(\/(?:de|en))(\/|$)/, `/${code}$2`)
  c.header('Set-Cookie', langCookie(code))
  return c.redirect(localised, 302)
})

// ── Legacy redirects (keep old URLs working / SEO) ───────────────────────────
webPublic.get('/impressum',   (c) => c.redirect(`/${detectLocale(c)}/${LEGAL_SLUGS[detectLocale(c)].impressum}`,   302))
webPublic.get('/datenschutz', (c) => c.redirect(`/${detectLocale(c)}/${LEGAL_SLUGS[detectLocale(c)].datenschutz}`, 302))
webPublic.get('/agb',         (c) => c.redirect(`/${detectLocale(c)}/${LEGAL_SLUGS[detectLocale(c)].agb}`,         302))
webPublic.get('/widerruf',    (c) => c.redirect(`/${detectLocale(c)}/${LEGAL_SLUGS[detectLocale(c)].widerruf}`,    302))

// ── Localised landing — /:locale/ ────────────────────────────────────────────
webPublic.get('/:locale/', (c) => {
  const code = c.req.param('locale')
  if (!isLocale(code)) return c.redirect('/', 302)
  return c.html(buildLandingHtml(code))
})

// ── Localised legal — /:locale/:slug ─────────────────────────────────────────
webPublic.get('/:locale/:slug', async (c) => {
  const code = c.req.param('locale')
  const slug = c.req.param('slug')
  if (!isLocale(code)) return c.redirect('/', 302)
  const canonical = canonicalSlug(slug, code)
  if (canonical) {
    return renderLegal(c, canonical as 'impressum' | 'datenschutz' | 'agb' | 'widerruf', code)
  }
  // Unknown slug — 404 page using the legal wrapper for consistent chrome
  return c.html(legalPageHtml('404', '<p>Page not found.</p>', code), 404)
})

// ── Live Beta-Counter (locale-independent JSON) ──────────────────────────────
webPublic.get('/beta-count', async (c) => {
  try {
    const row = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM beta_signups').first<{ n: number }>()
    return c.json({ count: row?.n ?? 0, limit: 100 })
  } catch {
    return c.json({ count: 0, limit: 100 })
  }
})

// ── Beta-Tester Signup (POST, returns JSON) ──────────────────────────────────
webPublic.post('/beta-signup', async (c) => {
  const locale = detectLocale(c)
  let body: { email?: string; firstName?: string; device?: string; teamSize?: string; message?: string }
  try { body = await c.req.json() } catch {
    return c.json({ error: locale === 'en' ? 'Invalid request.' : 'Ungültige Anfrage.' }, 400)
  }

  const email = (body.email ?? '').trim().toLowerCase()
  if (!email || !email.includes('@') || !email.includes('.')) {
    return c.json({ error: t('form_invalid_email', locale) }, 400)
  }

  const existing = await c.env.DB
    .prepare('SELECT id FROM beta_signups WHERE email = ?').bind(email).first()
  if (existing) {
    return c.json({
      ok: true,
      alreadyRegistered: true,
      message: locale === 'en'
        ? "You're already on our beta list! We'll be in touch."
        : 'Du bist bereits auf unserer Beta-Liste! Wir melden uns.',
    })
  }

  await c.env.DB.prepare(
    'INSERT INTO beta_signups (email, first_name, device, team_size, message) VALUES (?, ?, ?, ?, ?)'
  ).bind(email, body.firstName ?? null, body.device ?? null, body.teamSize ?? null, body.message ?? null).run()

  // Confirmation email — localised
  try {
    const greet = body.firstName ? body.firstName : (locale === 'en' ? 'Hey' : 'Hey')
    const isEn = locale === 'en'
    await sendEmail({
      to: email, toName: body.firstName ?? '',
      subject: isEn
        ? "You're on the CustoSoft beta list! 🎉"
        : 'Du bist auf der CustoSoft Beta-Liste! 🎉',
      text: isEn
        ? `${greet}!\n\nYou're now officially on our CustoSoft beta list.\n\nReward at launch: lifetime punch-clock license — free, forever.\n\nWe'll be in touch as the beta launch approaches.\n\nUntil then,\nDavid — CustoSoft`
        : `${greet}!\n\nDu bist jetzt offiziell auf unserer Beta-Liste für CustoSoft.\n\nBelohnung bei Release: Lebenslange Stempeluhr-Lizenz — kostenlos, für immer.\n\nWir melden uns sobald der Beta-Start näher rückt.\n\nBis dann,\nDavid — CustoSoft`,
      html: `<div style="font-family:-apple-system,sans-serif;max-width:520px;margin:0 auto;background:#0a0a14;color:#fff;padding:40px 32px;border-radius:16px">
        <div style="background:linear-gradient(135deg,#7733dd,#3355ff);border-radius:12px;padding:20px;text-align:center;margin-bottom:28px">
          <span style="font-size:32px">🎉</span>
          <h1 style="margin:8px 0 4px;font-size:22px">${isEn ? "You're in!" : 'Du bist dabei!'}</h1>
          <p style="margin:0;opacity:0.8;font-size:14px">${isEn ? 'CustoSoft beta program' : 'CustoSoft Beta-Programm'}</p>
        </div>
        <p style="font-size:16px;line-height:1.6;color:rgba(255,255,255,0.85)">${isEn ? 'Hey' : 'Hey'}${body.firstName ? ' ' + body.firstName : ''},</p>
        <p style="font-size:15px;line-height:1.7;color:rgba(255,255,255,0.75)">${isEn
          ? "you're officially on our beta list. As soon as we launch, you'll be the first to know."
          : 'du bist offiziell auf unserer Beta-Liste. Sobald es losgeht, bekommst du als Erster Bescheid.'}</p>
        <div style="background:rgba(120,60,255,0.15);border:1px solid rgba(120,60,255,0.4);border-radius:12px;padding:20px;margin:24px 0">
          <div style="font-size:12px;color:#c594ff;font-weight:700;letter-spacing:1px;margin-bottom:8px">${isEn ? 'YOUR REWARD AT LAUNCH' : 'DEINE BELOHNUNG BEI RELEASE'}</div>
          <div style="font-size:18px;font-weight:700">${isEn ? '⏱ Lifetime punch-clock license' : '⏱ Lebenslange Stempeluhr-Lizenz'}</div>
          <div style="font-size:13px;color:rgba(255,255,255,0.6);margin-top:4px">${isEn ? 'Free · Unlocked forever' : 'Kostenlos · Für immer freigeschaltet'}</div>
        </div>
        <p style="font-size:13px;color:rgba(255,255,255,0.45);margin-top:28px">${isEn ? 'Questions? Just reply to this email.' : 'Fragen? Antworte einfach auf diese Mail.'}<br>custosoftsupportde@gmail.com</p>
      </div>`,
      from: c.env.FROM_EMAIL, fromName: c.env.FROM_NAME,
      apiKey: c.env.RESEND_API_KEY,
    })
  } catch (e: any) {
    console.error('[beta-signup] email failed:', e?.message)
  }

  const count = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM beta_signups').first<{ n: number }>()
  return c.json({
    ok: true,
    message: locale === 'en' ? 'Successfully registered! Confirmation email on the way.' : 'Erfolgreich registriert! Bestätigungsmail unterwegs.',
    totalSignups: count?.n ?? 0,
  })
})

// ── Public apply page (job link landing) — locale-aware ──────────────────────
webPublic.get('/apply/:code', async (c) => {
  const code = c.req.param('code')
  const locale = detectLocale(c)
  const link = await c.env.DB.prepare(`
    SELECT jl.*, o.name AS org_name, op.title AS position_title
    FROM job_links jl
    INNER JOIN organisations o ON o.id = jl.org_id
    LEFT JOIN org_positions op ON op.id = jl.position_id
    WHERE jl.code = ? AND jl.is_active = 1
  `).bind(code).first<any>()

  if (!link) {
    const msg = locale === 'en'
      ? 'This application URL is no longer active.'
      : 'Diese Bewerbungs-URL ist nicht (mehr) aktiv.'
    return c.html(legalPageHtml(locale === 'en' ? 'Application' : 'Bewerbung', `<p>${msg}</p>`, locale))
  }

  return c.html(applyPageHtml({
    orgName:   link.org_name,
    title:     link.title,
    description: link.description ?? '',
    position:  link.position_title ?? '',
    code:      link.code,
  }, locale))
})

export default webPublic

// ─────────────────────────────────────────────────────────────────────────────
// Apply page (kept inline here — small, single-purpose template).
// ─────────────────────────────────────────────────────────────────────────────

function applyPageHtml(p: { orgName: string; title: string; description: string; position: string; code: string }, locale: Locale): string {
  const lang = locale === 'en' ? 'en' : 'de'
  const labelTitle = locale === 'en' ? 'Application' : 'Bewerbung'
  const ctaLabel   = locale === 'en' ? 'Apply directly in the app' : 'Direkt in der App bewerben'
  const needApp    = locale === 'en'
    ? "You need the CustoSoft app. <a href='https://apps.apple.com/de/app/custosoft' style='color:#7790ff'>Get it on the App Store</a>"
    : "Du brauchst die CustoSoft-App. <a href='https://apps.apple.com/de/app/custosoft' style='color:#7790ff'>Im App Store laden</a>"

  return `<!DOCTYPE html>
<html lang="${lang}"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${labelTitle} · ${p.orgName}</title>
<style>${SHARED_STYLE}
.apply-card{background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.12);border-radius:24px;padding:36px;max-width:680px;margin:40px auto}
.apply-card h1{font-size:30px;margin-bottom:8px}
.apply-card .meta{color:rgba(255,255,255,0.55);font-size:14px;margin-bottom:24px}
.apply-card .desc{color:rgba(255,255,255,0.75);margin-bottom:28px;line-height:1.7}
.cta{display:inline-block;padding:14px 28px;background:linear-gradient(135deg,#7733dd,#3355ff);color:#fff;border-radius:12px;font-weight:600;text-decoration:none}
</style></head>
<body>
${commonNav(locale)}
<main>
  <div class="apply-card">
    <h1>${p.title}</h1>
    <div class="meta">${p.orgName}${p.position ? ' · ' + p.position : ''}</div>
    <div class="desc">${p.description.replace(/\n/g, '<br>')}</div>
    <a class="cta" href="custosoft://apply/${p.code}">${ctaLabel}</a>
    <p style="margin-top:20px;font-size:13px;color:rgba(255,255,255,0.40)">${needApp}</p>
  </div>
</main>
${commonFooter(locale)}
</body></html>`
}
