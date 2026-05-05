// ─────────────────────────────────────────────────────────────────────────────
// i18n — supported locales for the public website
// ─────────────────────────────────────────────────────────────────────────────
//
// Add a new locale: append the code below, add entries to `strings.ts`, and
// implement a translation function in `legal.ts`. No other file needs to change.
// ─────────────────────────────────────────────────────────────────────────────

import type { Context } from 'hono'

/** Supported locales in priority order. The first one is the default. */
export const LOCALES = ['de', 'en'] as const
export type Locale = (typeof LOCALES)[number]

export const DEFAULT_LOCALE: Locale = 'de'

/** Human-readable label for the language switcher in the footer. */
export const LOCALE_LABEL: Record<Locale, string> = {
  de: 'Deutsch',
  en: 'English',
}

/** Native short tag (used inside <html lang="…">). */
export const LOCALE_HTML_TAG: Record<Locale, string> = {
  de: 'de',
  en: 'en',
}

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value)
}

/**
 * Detect the visitor's preferred locale.
 * Priority:
 *   1. Cookie `lang=…` (set by the language switcher)
 *   2. Path prefix `/de/` or `/en/`
 *   3. `Accept-Language` header (only the first match)
 *   4. DEFAULT_LOCALE
 */
export function detectLocale(c: Context): Locale {
  // 1. Cookie
  const cookieHeader = c.req.header('Cookie') ?? ''
  const cookieMatch = cookieHeader.match(/(?:^|;\s*)lang=([a-zA-Z-]+)/)
  if (cookieMatch && isLocale(cookieMatch[1])) return cookieMatch[1]

  // 2. Path prefix
  const path = c.req.path
  const seg = path.split('/').filter(Boolean)[0]
  if (seg && isLocale(seg)) return seg

  // 3. Accept-Language
  const accept = c.req.header('Accept-Language') ?? ''
  for (const part of accept.split(',')) {
    const tag = part.trim().split(';')[0].toLowerCase()
    const code = tag.split('-')[0] // 'en-US' -> 'en'
    if (isLocale(code)) return code
  }

  return DEFAULT_LOCALE
}

/**
 * Strip `/de/` or `/en/` prefix from a path.
 * Returns the bare path (e.g. `/impressum`) or `/` if the prefix was the whole thing.
 */
export function stripLocalePrefix(path: string): string {
  const m = path.match(/^\/([a-z]{2})(\/.*)?$/)
  if (m && isLocale(m[1])) return m[2] ?? '/'
  return path
}

/** Build a Set-Cookie value that persists the locale for one year. */
export function langCookie(locale: Locale): string {
  return `lang=${locale}; Path=/; Max-Age=31536000; SameSite=Lax`
}
