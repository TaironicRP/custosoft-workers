// ─────────────────────────────────────────────────────────────────────────────
// i18n — Locale-aware navigation, footer, and language switcher
// ─────────────────────────────────────────────────────────────────────────────

import { LOCALES, LOCALE_LABEL, type Locale } from './locales'
import { LEGAL_SLUGS } from './legal'
import { t } from './strings'

/**
 * Build the sticky top navigation. All links point inside the current locale
 * (so /de/impressum or /en/imprint, not the bare slug).
 */
export function commonNav(locale: Locale): string {
  const slugs = LEGAL_SLUGS[locale]
  const base = `/${locale}`
  return `<nav class="nav"><div class="nav-inner">
    <a class="brand" href="${base}/"><div class="logo">CS</div><div class="name">CustoSoft</div></a>
    <div class="nav-links">
      <a href="${base}/">${t('nav_start', locale)}</a>
      <a href="${base}/${slugs.impressum}">${t('nav_imprint', locale)}</a>
      <a href="${base}/${slugs.datenschutz}">${t('nav_privacy', locale)}</a>
      <a href="${base}/${slugs.agb}">${t('nav_terms', locale)}</a>
    </div>
  </div></nav>`
}

/**
 * Footer with legal links, contact, and language switcher.
 * The switcher submits to /lang/:code which sets a cookie and redirects back.
 */
export function commonFooter(locale: Locale): string {
  const slugs = LEGAL_SLUGS[locale]
  const base = `/${locale}`

  // Language switcher buttons
  const switcher = LOCALES.map(loc => {
    const isCurrent = loc === locale
    const style = isCurrent
      ? 'color:#c594ff;font-weight:700'
      : 'color:rgba(255,255,255,0.65)'
    return `<a href="/lang/${loc}" style="${style}">${LOCALE_LABEL[loc]}</a>`
  }).join('<span style="opacity:.3">·</span>')

  return `<div class="footer">
    <div style="margin-bottom:14px">
      © 2026 CustoSoft · David Schroedinger ·
      <a href="${base}/${slugs.impressum}">${t('nav_imprint', locale)}</a>·
      <a href="${base}/${slugs.datenschutz}">${t('nav_privacy', locale)}</a>·
      <a href="${base}/${slugs.agb}">${t('nav_terms', locale)}</a>·
      <a href="${base}/${slugs.widerruf}">${t('footer_revocation', locale)}</a>·
      <a href="mailto:taironic.media@gmail.com">${t('footer_contact', locale)}</a>
    </div>
    <div style="display:flex;align-items:center;justify-content:center;gap:10px;font-size:12px;opacity:.7">
      <span>🌐 ${t('footer_lang', locale)}:</span>${switcher}
    </div>
  </div>`
}
