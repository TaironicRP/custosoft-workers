import { Hono } from 'hono'
import type { Env } from '../types'

const legal = new Hono<{ Bindings: Env }>()

// No auth required for legal pages

function buildLegalPageDto(row: any) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    content: row.content,
    updatedAt: row.updated_at ?? row.updatedAt,
  }
}

// GET /legal
legal.get('/', async (c) => {
  const db = c.env.DB

  const rows = await db
    .prepare(`SELECT id, slug, title, updated_at FROM legal_pages ORDER BY slug ASC`)
    .all()

  return c.json(
    (rows.results ?? []).map((row: any) => ({
      id: row.id,
      slug: row.slug,
      title: row.title,
      updatedAt: row.updated_at,
    }))
  )
})

// GET /legal/:slug
legal.get('/:slug', async (c) => {
  const db = c.env.DB
  const slug = c.req.param('slug')

  const row = await db
    .prepare(`SELECT * FROM legal_pages WHERE slug = ?`)
    .bind(slug)
    .first<any>()

  if (!row) {
    return c.json({ error: 'Page not found' }, 404)
  }

  return c.json(buildLegalPageDto(row))
})

export default legal
