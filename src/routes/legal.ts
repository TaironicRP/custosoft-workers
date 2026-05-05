// ── Legal Pages API (used by the iOS app) ───────────────────────────────────
//
// Locale resolution:
//   - `?locale=en` query param        (highest priority — explicit client wish)
//   - `Accept-Language` header        (first matching locale)
//   - falls back to 'de'              (development source language)
//
// Compatible with both the new (slug, locale) schema and the old slug-only
// schema. The migration script `scripts/update_legal_pages_locale.sql` adds
// the `locale` column; until it's run, the API still works (locale is just
// ignored).
// ─────────────────────────────────────────────────────────────────────────────

import { Hono } from 'hono'
import type { Context } from 'hono'
import type { Env } from '../types'
import { isLocale, type Locale } from '../i18n/locales'

const legal = new Hono<{ Bindings: Env }>()

// ── Helpers ──────────────────────────────────────────────────────────────────

function detectLocale(c: Context): Locale {
  const q = c.req.query('locale')
  if (q && isLocale(q)) return q
  const accept = c.req.header('Accept-Language') ?? ''
  for (const part of accept.split(',')) {
    const tag = part.trim().split(';')[0].toLowerCase()
    const code = tag.split('-')[0]
    if (isLocale(code)) return code
  }
  return 'de'
}

function buildLegalPageDto(row: any) {
  return {
    id: row.id,
    slug: row.slug,
    locale: row.locale ?? 'de',
    title: row.title,
    content: row.content,
    updatedAt: row.updated_at ?? row.updatedAt,
  }
}

// ── GET /legal — list all pages for the resolved locale ─────────────────────
legal.get('/', async (c) => {
  const db = c.env.DB
  const locale = detectLocale(c)

  // Try locale-aware lookup first (post-migration schema)
  try {
    const rows = await db
      .prepare(
        `SELECT id, slug, locale, title, updated_at
         FROM legal_pages
         WHERE locale = ?
         ORDER BY slug ASC`
      )
      .bind(locale)
      .all()
    if ((rows.results ?? []).length > 0) {
      return c.json(
        (rows.results ?? []).map((row: any) => ({
          id: row.id,
          slug: row.slug,
          locale: row.locale,
          title: row.title,
          updatedAt: row.updated_at,
        }))
      )
    }
    // Empty result for that locale → fall through to legacy/de fallback
  } catch {
    // Old schema (no `locale` column) — fall through
  }

  // Legacy / DE fallback
  const rows = await db
    .prepare(`SELECT id, slug, title, updated_at FROM legal_pages ORDER BY slug ASC`)
    .all()
  return c.json(
    (rows.results ?? []).map((row: any) => ({
      id: row.id,
      slug: row.slug,
      locale: 'de',
      title: row.title,
      updatedAt: row.updated_at,
    }))
  )
})

// ── GET /legal/:slug — single page in resolved locale ───────────────────────
legal.get('/:slug', async (c) => {
  const db = c.env.DB
  const slug = c.req.param('slug')
  const locale = detectLocale(c)

  // Try locale-aware lookup first
  try {
    const localeRow = await db
      .prepare(`SELECT * FROM legal_pages WHERE slug = ? AND locale = ?`)
      .bind(slug, locale)
      .first<any>()
    if (localeRow) return c.json(buildLegalPageDto(localeRow))

    // No row for the requested locale — fall back to German
    if (locale !== 'de') {
      const deRow = await db
        .prepare(`SELECT * FROM legal_pages WHERE slug = ? AND locale = 'de'`)
        .bind(slug)
        .first<any>()
      if (deRow) return c.json(buildLegalPageDto(deRow))
    }
  } catch {
    // Old schema — fall through
  }

  // Legacy lookup (pre-migration)
  const row = await db
    .prepare(`SELECT * FROM legal_pages WHERE slug = ?`)
    .bind(slug)
    .first<any>()
  if (!row) return c.json({ error: 'Page not found' }, 404)
  return c.json(buildLegalPageDto(row))
})

export default legal
