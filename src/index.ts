// ══════════════════════════════════════════════════════════════════════════════
// CustoSoft API · Cloudflare Workers · Hono · D1 · R2
// ══════════════════════════════════════════════════════════════════════════════

import { Hono }          from 'hono'
import { cors }          from 'hono/cors'
import { serveR2Object } from './utils/r2'
import type { Env }      from './types'

// ── Routes ────────────────────────────────────────────────────────────────────
import auth          from './routes/auth'
import org          from './routes/org'
import products      from './routes/products'
import chat          from './routes/chat'
import punch         from './routes/punch'
import files         from './routes/files'
import recruitment   from './routes/recruitment'
import terminal      from './routes/terminal'
import admin         from './routes/admin'
import legal         from './routes/legal'
import notifications from './routes/notifications'
import onboarding    from './routes/onboarding'
import support       from './routes/support'
import iap           from './routes/iap-notifications'
import webAdmin      from './routes/web-admin'
import webPublic     from './routes/web-public'
import { runSubscriptionLifecycle } from './cron/subscriptionLifecycle'

// ── App ───────────────────────────────────────────────────────────────────────
const app = new Hono<{ Bindings: Env }>()

// ── CORS — allow all origins in dev, specific origins in prod ─────────────────
app.use('*', async (c, next) => {
  const allowedOrigins = (c.env.ALLOWED_ORIGINS ?? '').split(',').map(s => s.trim())

  return cors({
    origin: (o) => allowedOrigins.includes(o) || o === '' ? o : allowedOrigins[0],
    allowMethods:  ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders:  ['Content-Type', 'Authorization', 'Accept'],
    exposeHeaders: ['Content-Length'],
    maxAge:        86400,
    credentials:   true,
  })(c, next)
})

// ── Public Website (Landing + Legal Pages) ───────────────────────────────────
app.route('/', webPublic)

// ── Health (machine endpoint, no HTML) ────────────────────────────────────────
app.get('/api', (c) => c.json({
  service: 'CustoSoft API',
  version: '2.0.0',
  runtime: 'Cloudflare Workers + D1 + R2',
  status:  'ok',
}))

app.get('/health', (c) => c.json({ ok: true, ts: new Date().toISOString() }))

// ── Web Admin UI — GET /admin ────────────────────────────────────────────────
app.route('/admin', webAdmin)

// ── R2 File Proxy — GET /uploads/<key> ───────────────────────────────────────
// Serves uploaded files directly from R2 with caching headers
app.get('/uploads/*', async (c) => {
  const key = c.req.path.replace(/^\/uploads\//, '')
  return serveR2Object(c.env.UPLOADS, key)
})

// ── API v1 Routes ─────────────────────────────────────────────────────────────
const v1 = new Hono<{ Bindings: Env }>()

v1.route('/auth',          auth)
v1.route('/org',           org)
v1.route('/orgs',          org)        // alias for search
v1.route('/products',      products)
v1.route('/conversations', chat)
v1.route('/punch',         punch)
v1.route('/files',         files)
v1.route('/recruitment',   recruitment)
v1.route('/terminal',      terminal)
v1.route('/admin',         admin)
v1.route('/legal',         legal)
v1.route('/notifications', notifications)
v1.route('/onboarding',    onboarding)
v1.route('/support',       support)
v1.route('/iap',           iap)        // Apple App Store Server Notifications V2

app.route('/api/v1', v1)

// ── Org search (GET /api/v1/orgs/search?q=) ──────────────────────────────────
v1.get('/orgs/search', async (c) => {
  const q = c.req.query('q') ?? ''
  if (q.length < 2) return c.json([])

  const rows = await c.env.DB.prepare(`
    SELECT o.id, o.name, o.logo_url,
           COUNT(m.id) as member_count
    FROM organisations o
    LEFT JOIN org_members m ON m.org_id = o.id AND m.is_active = 1
    WHERE o.name LIKE ?
    GROUP BY o.id
    LIMIT 20
  `).bind(`%${q}%`).all<any>()

  return c.json(rows.results.map(r => ({
    id: r.id, name: r.name, memberCount: r.member_count, logoUrl: r.logo_url,
  })))
})

// ── Org accept/decline invite ─────────────────────────────────────────────────
v1.post('/org/accept-invite', async (c) => {
  return c.json({ ok: true })   // implement pending_invites when needed
})
v1.post('/org/decline-invite', async (c) => {
  return new Response(null, { status: 204 })
})

// ── 404 fallback ──────────────────────────────────────────────────────────────
app.notFound((c) => c.json({ error: `Route ${c.req.method} ${c.req.path} nicht gefunden.` }, 404))

// ── Global Error Handler ──────────────────────────────────────────────────────
app.onError((err, c) => {
  console.error(`[ERROR] ${c.req.method} ${c.req.path}:`, err)
  return c.json({ error: 'Interner Serverfehler.' }, 500)
})

export default {
  fetch: app.fetch,
  async scheduled(_event: unknown, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }): Promise<void> {
    ctx.waitUntil(runSubscriptionLifecycle(env))
  },
}
