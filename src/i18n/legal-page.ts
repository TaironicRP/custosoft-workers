// ─────────────────────────────────────────────────────────────────────────────
// Legal-page HTML wrapper (Impressum / Datenschutz / AGB / Widerruf chrome).
// Locale-aware via shared nav/footer.
// ─────────────────────────────────────────────────────────────────────────────

import { LOCALE_HTML_TAG, type Locale } from './locales'
import { commonNav, commonFooter } from './nav'
import { SHARED_STYLE } from './shared-style'

export function legalPageHtml(title: string, content: string, locale: Locale): string {
  const lang = LOCALE_HTML_TAG[locale]
  return `<!DOCTYPE html>
<html lang="${lang}"><head>
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
${commonNav(locale)}
<main class="legal">
  <h1>${title}</h1>
  <div class="legal-card">${content}</div>
</main>
${commonFooter(locale)}
</body></html>`
}
