// ── Support Channel ─────────────────────────────────────────────────────────
//
// Jeder User hat genau EINEN persönlichen Support-Thread mit dem CustoSoft-Team.
// Type: 'SupportThread'. Mitglieder: der User selbst + (lazy) alle SuperAdmins
// die antworten. Ein Thread = eine Conversation-Row mit type='SupportThread'.
//
// Routes:
//   GET  /support/me              — eigener Thread (lazy-create), gibt Conversation
//   POST /support/me/start        — startet/erweitert eigenen Thread, liefert Welcome-Bot
//   GET  /support/threads         — SuperAdmin: alle offenen Threads (Inbox)
//   POST /support/threads/:id/claim — SuperAdmin tritt einem Thread bei
//
// Messages werden über bestehende Chat-Routen verschickt (POST /conversations/:id/send).

import { Hono } from 'hono'
import { requireAuth, requireStaff } from '../middleware/auth'
import type { AppEnv } from '../types'

const support = new Hono<AppEnv>()
support.use('*', requireAuth)

const SUPPORT_TYPE = 'SupportThread'

async function findOrCreateThread(db: D1Database, userId: string): Promise<number> {
  // ALLE existierenden SupportThreads des Users laden, sortiert nach created_at ASC
  const rows = await db
    .prepare(
      `SELECT c.id, c.created_at FROM conversations c
       INNER JOIN conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = ?
       WHERE c.type = ?
       ORDER BY c.created_at ASC`
    )
    .bind(userId, SUPPORT_TYPE)
    .all<{ id: number; created_at: string }>()

  const all = rows.results ?? []
  if (all.length > 0) {
    // Ältesten behalten, alle anderen aufräumen (Duplikat-Cleanup)
    const keep = Number(all[0].id)
    for (let i = 1; i < all.length; i++) {
      const dup = Number(all[i].id)
      // Messages zum keep-Thread mergen, dann Duplikat löschen
      await db
        .prepare(`UPDATE messages SET conversation_id = ? WHERE conversation_id = ?`)
        .bind(keep, dup)
        .run()
      await db
        .prepare(`DELETE FROM conversation_members WHERE conversation_id = ?`)
        .bind(dup)
        .run()
      await db.prepare(`DELETE FROM conversations WHERE id = ?`).bind(dup).run()
    }
    return keep
  }

  // Neu anlegen — Title = "CustoSoft Support" (org_id = null, kein org-bound)
  const ins = await db
    .prepare(
      `INSERT INTO conversations (title, type, org_id, is_info_channel, is_read_only)
       VALUES ('CustoSoft Support', ?, NULL, 0, 0)`
    )
    .bind(SUPPORT_TYPE)
    .run()
  const newId = Number(ins.meta.last_row_id)

  await db
    .prepare(
      `INSERT OR IGNORE INTO conversation_members (conversation_id, user_id, last_read_at)
       VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))`
    )
    .bind(newId, userId)
    .run()

  return newId
}

async function buildConvDto(db: D1Database, convId: number, userId: string) {
  const conv = await db.prepare(`SELECT * FROM conversations WHERE id = ?`).bind(convId).first<any>()
  if (!conv) return null

  const cm = await db
    .prepare(`SELECT last_read_at FROM conversation_members WHERE conversation_id = ? AND user_id = ?`)
    .bind(convId, userId)
    .first<{ last_read_at: string | null }>()
  const lastReadAt = cm?.last_read_at ?? '1970-01-01T00:00:00Z'

  const unreadRow = await db
    .prepare(`SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ? AND sent_at > ?`)
    .bind(convId, lastReadAt)
    .first<{ n: number }>()

  const last = await db
    .prepare(`SELECT * FROM messages WHERE conversation_id = ? ORDER BY sent_at DESC LIMIT 1`)
    .bind(convId)
    .first<any>()

  return {
    id:             conv.id,
    title:          conv.title,
    type:           conv.type,
    orgId:          conv.org_id,
    isInfoChannel:  conv.is_info_channel === 1,
    isReadOnly:     conv.is_read_only === 1,
    memberCount:    1,
    unreadCount:    unreadRow?.n ?? 0,
    lastMessage: last
      ? {
          id:              last.id,
          conversationId:  last.conversation_id,
          senderId:        last.sender_id,
          senderName:      last.sender_name,
          senderAvatarUrl: null,
          body:            last.body,
          sentAt:          last.sent_at,
          isSystem:        last.is_system === 1,
          attachmentUrl:   last.attachment_url,
          attachmentName:  last.attachment_name,
          attachmentType:  last.attachment_type,
          attachmentBytes: last.attachment_bytes,
        }
      : null,
  }
}

// ─── GET /support/me — eigener Thread (lazy create wenn nötig)

support.get('/me', async (c) => {
  try {
    const userId = c.get('userId') as string
    const db = c.env.DB
    const convId = await findOrCreateThread(db, userId)
    const dto = await buildConvDto(db, convId, userId)
    if (!dto) return c.json({ error: 'Support-Thread nicht verfügbar.' }, 500)
    return c.json(dto)
  } catch (e: any) {
    console.error('[GET /support/me]', e?.message ?? e)
    return c.json({ error: `Support nicht erreichbar: ${e?.message ?? 'unbekannt'}` }, 500)
  }
})

// ─── POST /support/me/start — Welcome-Bot-Nachricht + Auswahl-Trigger
//     Body: { kind: 'bug' | 'feedback' | 'live' }
//     Side-Effect: Postet eine System-Begrüßung mit Hinweis je Kategorie.

support.post('/me/start', async (c) => {
  try {
    const userId = c.get('userId') as string
    const userRow = c.get('userRow') as any
    const db = c.env.DB
    const body = await c.req.json<{ kind?: string; message?: string }>().catch(() => ({}))
    const kind = (body.kind ?? 'live').toLowerCase()
    const userName = (`${userRow?.first_name ?? ''} ${userRow?.last_name ?? ''}`.trim()) || userRow?.email || 'Du'

    const convId = await findOrCreateThread(db, userId)

    // Optionale erste User-Nachricht direkt mit speichern
    if (body.message?.trim()) {
      await db
        .prepare(
          `INSERT INTO messages (conversation_id, sender_id, sender_name, body, is_system)
           VALUES (?, ?, ?, ?, 0)`
        )
        .bind(convId, userId, userName, body.message.trim())
        .run()
    }

    // Welcome-Bot-Reply (System-Message, von "CustoSoft Bot")
    const greeting = (() => {
      switch (kind) {
        case 'bug':
          return '👋 Hi! Du möchtest einen Bug melden? Beschreib den Fehler bitte so genau wie möglich — was hast du gemacht, was hat NICHT funktioniert? Ein Screenshot hilft uns enorm. Unser Team meldet sich gleich!'
        case 'feedback':
          return '👋 Schön dass du Feedback gibst! Erzähl uns was wir besser machen können — Feature-Wünsche, Kritik, Lob — alles ist willkommen. Wir lesen jede Nachricht.'
        case 'live':
        default:
          return '👋 Hi! Ich bin der CustoSoft Bot 🤖. Schreib einfach was du brauchst — ein Mitarbeiter aus unserem Team meldet sich gleich live bei dir. Wenn niemand in den nächsten 60 Sekunden antwortet, kümmern wir uns innerhalb von 24h darum.'
      }
    })()

    await db
      .prepare(
        `INSERT INTO messages (conversation_id, sender_id, sender_name, body, is_system)
         VALUES (?, ?, ?, ?, 1)`
      )
      .bind(convId, 'system-bot', 'CustoSoft Bot', greeting)
      .run()

    const dto = await buildConvDto(db, convId, userId)
    return c.json(dto, 201)
  } catch (e: any) {
    console.error('[POST /support/me/start]', e?.message ?? e)
    return c.json({ error: `Support-Start fehlgeschlagen: ${e?.message ?? 'unbekannt'}` }, 500)
  }
})

// ─── GET /support/threads — SuperAdmin-Inbox: alle offenen Support-Threads

support.get('/threads', requireStaff, async (c) => {
  try {
    const db = c.env.DB
    const rows = await db
      .prepare(
        `SELECT
          c.id,
          c.title,
          c.type,
          c.created_at AS createdAt,
          (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS messageCount,
          (
            SELECT json_object(
              'id', m.id,
              'senderId', m.sender_id,
              'senderName', m.sender_name,
              'body', m.body,
              'sentAt', m.sent_at,
              'isSystem', m.is_system
            )
            FROM messages m
            WHERE m.conversation_id = c.id
            ORDER BY m.sent_at DESC
            LIMIT 1
          ) AS lastJson,
          (
            SELECT u.email FROM users u
            INNER JOIN conversation_members cm ON cm.user_id = u.id AND cm.conversation_id = c.id
            WHERE u.app_role IS NULL OR (u.app_role != 'SuperAdmin' AND u.app_role != 'Staff')
            LIMIT 1
          ) AS userEmail,
          (
            SELECT COALESCE(u.first_name || ' ' || u.last_name, u.email) FROM users u
            INNER JOIN conversation_members cm ON cm.user_id = u.id AND cm.conversation_id = c.id
            WHERE u.app_role IS NULL OR (u.app_role != 'SuperAdmin' AND u.app_role != 'Staff')
            LIMIT 1
          ) AS userName
        FROM conversations c
        WHERE c.type = ?
        ORDER BY (SELECT MAX(sent_at) FROM messages WHERE conversation_id = c.id) DESC NULLS LAST,
                 c.created_at DESC`
      )
      .bind(SUPPORT_TYPE)
      .all<any>()

    const items = (rows.results ?? []).map((r: any) => ({
      id:           r.id,
      userEmail:    r.userEmail ?? '',
      userName:     (r.userName ?? '').trim() || r.userEmail || '?',
      messageCount: r.messageCount ?? 0,
      createdAt:    r.createdAt,
      lastMessage:  r.lastJson ? JSON.parse(r.lastJson) : null,
    }))

    return c.json({ items })
  } catch (e: any) {
    console.error('[GET /support/threads]', e?.message ?? e)
    return c.json({ error: `Inbox nicht verfügbar: ${e?.message ?? 'unbekannt'}` }, 500)
  }
})

// ─── POST /support/threads/:id/claim — SuperAdmin tritt dem Thread bei

support.post('/threads/:id/claim', requireStaff, async (c) => {
  try {
    const adminId = c.get('userId') as string
    const adminRow = c.get('userRow') as any
    const db = c.env.DB
    const convId = c.req.param('id')

    const conv = await db
      .prepare(`SELECT * FROM conversations WHERE id = ? AND type = ?`)
      .bind(convId, SUPPORT_TYPE)
      .first<any>()
    if (!conv) return c.json({ error: 'Support-Thread nicht gefunden.' }, 404)

    await db
      .prepare(
        `INSERT OR IGNORE INTO conversation_members (conversation_id, user_id, last_read_at)
         VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))`
      )
      .bind(convId, adminId)
      .run()

    // System-Message: Admin ist gejoint
    const adminName = (`${adminRow?.first_name ?? ''} ${adminRow?.last_name ?? ''}`.trim())
      || adminRow?.email || 'Support-Team'
    await db
      .prepare(
        `INSERT INTO messages (conversation_id, sender_id, sender_name, body, is_system)
         VALUES (?, ?, ?, ?, 1)`
      )
      .bind(convId, 'system-bot', 'CustoSoft Bot',
            `${adminName} ist dem Chat beigetreten und hilft dir live. 👋`)
      .run()

    return c.json({ ok: true })
  } catch (e: any) {
    console.error('[POST /support/threads/:id/claim]', e?.message ?? e)
    return c.json({ error: `Beitritt fehlgeschlagen: ${e?.message ?? 'unbekannt'}` }, 500)
  }
})

export default support
