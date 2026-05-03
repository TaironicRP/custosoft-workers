// ─────────────────────────────────────────────────────────────────────────────
// Chat — frisch neu geschrieben.
//
// Tabellen die genutzt werden (existieren bereits):
//   conversations          (id INTEGER, title, type, org_id, ...)
//   conversation_members   (conversation_id, user_id, last_read_at)
//   messages               (id INTEGER, conversation_id, sender_id, sender_name,
//                           body, sent_at, is_system, attachment_*)
//
// Master-Regel: STRIKTE ORG-ISOLATION. User können nur mit Mitgliedern derselben
// Org chatten. Conversations gehören IMMER zu genau einer Org (org_id != NULL).
//
// Routes (alle requireAuth):
//   GET  /conversations                         — Threads des Users (PaginatedResponse)
//   POST /conversations                         — Body {otherUserId} → DM lazy create
//   GET  /conversations/:id/messages?afterId=N  — Messages, optional nur "neuer als N"
//   POST /conversations/:id/messages            — Body {body} → sendet, gibt Message
//   POST /conversations/:id/read                — last_read_at = now()
// ─────────────────────────────────────────────────────────────────────────────

import { Hono } from 'hono'
import { requireAuth } from '../middleware/auth'
import type { AppEnv } from '../types'
import { uploadToR2, parseFileUpload } from '../utils/r2'

const chat = new Hono<AppEnv>()
chat.use('*', requireAuth)

// ─── Helpers ────────────────────────────────────────────────────────────────

function buildName(first: string | null | undefined, last: string | null | undefined, email: string): string {
  return (`${first ?? ''} ${last ?? ''}`.trim()) || email
}

async function getActiveOrg(db: D1Database, userId: string): Promise<number | null> {
  const row = await db
    .prepare(`SELECT org_id FROM org_members WHERE user_id = ? AND is_active = 1 LIMIT 1`)
    .bind(userId)
    .first<{ org_id: number }>()
  return row?.org_id ?? null
}

async function ensureMember(db: D1Database, convId: string | number, userId: string): Promise<boolean> {
  const row = await db
    .prepare(`SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?`)
    .bind(convId, userId)
    .first()
  return !!row
}

interface ConvDto {
  id:              number
  title:           string
  type:            string
  orgId:           number | null
  isInfoChannel:   boolean
  isReadOnly:      boolean
  memberCount:     number
  unreadCount:     number
  lastMessage:     any | null
}

async function buildConvDto(db: D1Database, convId: number, userId: string): Promise<ConvDto | null> {
  const conv = await db.prepare(`SELECT * FROM conversations WHERE id = ?`).bind(convId).first<any>()
  if (!conv) return null

  const cm = await db
    .prepare(`SELECT last_read_at FROM conversation_members WHERE conversation_id = ? AND user_id = ?`)
    .bind(convId, userId)
    .first<{ last_read_at: string | null }>()
  const lastReadAt = cm?.last_read_at ?? '1970-01-01T00:00:00Z'

  const counts = await db
    .prepare(`SELECT
                (SELECT COUNT(*) FROM conversation_members WHERE conversation_id = ?) AS members,
                (SELECT COUNT(*) FROM messages WHERE conversation_id = ? AND sent_at > ? AND sender_id != ?) AS unread`)
    .bind(convId, convId, lastReadAt, userId)
    .first<{ members: number; unread: number }>()

  const last = await db
    .prepare(`SELECT * FROM messages WHERE conversation_id = ? ORDER BY sent_at DESC LIMIT 1`)
    .bind(convId)
    .first<any>()

  // Bei DM: title für den User = Name des ANDEREN Members
  let displayTitle = conv.title
  if (conv.type === 'DirectMessage') {
    const other = await db
      .prepare(`SELECT u.first_name, u.last_name, u.email
                FROM conversation_members cm
                INNER JOIN users u ON u.id = cm.user_id
                WHERE cm.conversation_id = ? AND cm.user_id != ?
                LIMIT 1`)
      .bind(convId, userId)
      .first<{ first_name: string | null; last_name: string | null; email: string }>()
    if (other) displayTitle = buildName(other.first_name, other.last_name, other.email)
  }

  return {
    id:             Number(conv.id),
    title:          displayTitle,
    type:           conv.type,
    orgId:          conv.org_id,
    isInfoChannel:  conv.is_info_channel === 1,
    isReadOnly:     conv.is_read_only === 1,
    memberCount:    counts?.members ?? 0,
    unreadCount:    counts?.unread ?? 0,
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

// ─── GET /conversations ─────────────────────────────────────────────────────
// Liste aller Threads des Users, sortiert nach letzter Aktivität DESC.
// Returns: PaginatedResponse-Shape { items, totalCount, page, pageSize }

chat.get('/', async (c) => {
  try {
    const userId = c.get('userId') as string
    const db = c.env.DB

    // ── Auto-Dedup: doppelte SupportThreads aufräumen (alle bis auf ältesten) ──
    const supportDupes = await db
      .prepare(
        `SELECT c.id FROM conversations c
         INNER JOIN conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = ?
         WHERE c.type = 'SupportThread'
         ORDER BY c.created_at ASC`
      )
      .bind(userId)
      .all<{ id: number }>()
    const supportRows = supportDupes.results ?? []
    if (supportRows.length > 1) {
      const keep = Number(supportRows[0].id)
      for (let i = 1; i < supportRows.length; i++) {
        const dup = Number(supportRows[i].id)
        await db.prepare(`UPDATE messages SET conversation_id = ? WHERE conversation_id = ?`).bind(keep, dup).run()
        await db.prepare(`DELETE FROM conversation_members WHERE conversation_id = ?`).bind(dup).run()
        await db.prepare(`DELETE FROM conversations WHERE id = ?`).bind(dup).run()
      }
    }

    // ── SICHERHEIT: aktuelle aktive Org bestimmen, Org-fremde Conversations
    //    werden NIE zurückgegeben (auch nicht alte Membership-Reste).
    const myOrg = await db
      .prepare(`SELECT org_id FROM org_members WHERE user_id = ? AND is_active = 1 LIMIT 1`)
      .bind(userId)
      .first<{ org_id: number }>()
    const myOrgId = myOrg?.org_id ?? null

    // Org-Filter: zeige nur Conversations die
    //   (a) zu meiner aktuellen aktiven Org gehören (org_id = myOrgId), ODER
    //   (b) Support-Threads sind (org_id = NULL, type='SupportThread')
    // Ohne Org → nur Support sichtbar.
    let sql: string
    let bindings: any[]
    if (myOrgId !== null) {
      sql = `
        SELECT c.id FROM conversations c
        INNER JOIN conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = ?
        WHERE (c.org_id = ? OR c.type = 'SupportThread')
        ORDER BY COALESCE(
          (SELECT MAX(sent_at) FROM messages WHERE conversation_id = c.id),
          c.created_at
        ) DESC
      `
      bindings = [userId, myOrgId]
    } else {
      sql = `
        SELECT c.id FROM conversations c
        INNER JOIN conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = ?
        WHERE c.type = 'SupportThread'
        ORDER BY COALESCE(
          (SELECT MAX(sent_at) FROM messages WHERE conversation_id = c.id),
          c.created_at
        ) DESC
      `
      bindings = [userId]
    }

    const rows = await db.prepare(sql).bind(...bindings).all<{ id: number }>()

    const items: ConvDto[] = []
    for (const r of rows.results ?? []) {
      const dto = await buildConvDto(db, Number(r.id), userId)
      if (dto) items.push(dto)
    }

    return c.json({
      items,
      totalCount: items.length,
      page:       1,
      pageSize:   items.length,
    })
  } catch (e: any) {
    console.error('[GET /conversations]', e?.message ?? e, e?.stack)
    return c.json({ error: `Konversationen konnten nicht geladen werden: ${e?.message ?? 'unbekannt'}` }, 500)
  }
})

// ─── POST /conversations ────────────────────────────────────────────────────
// Body: { otherUserId } → erstellt oder findet einen 1:1-DM.
// Strikte Org-Isolation: beide User MÜSSEN aktiv in derselben Org sein.

chat.post('/', async (c) => {
  try {
    const userId = c.get('userId') as string
    const db = c.env.DB
    const body = await c.req.json<{ otherUserId?: string; targetUserId?: string }>().catch(() => ({}))
    const otherId = (body.otherUserId ?? body.targetUserId ?? '').trim()

    if (!otherId)            return c.json({ error: 'otherUserId fehlt.' }, 400)
    if (otherId === userId)  return c.json({ error: 'Du kannst dir nicht selbst schreiben.' }, 400)

    const other = await db
      .prepare(`SELECT id, first_name, last_name, email FROM users WHERE id = ?`)
      .bind(otherId)
      .first<{ id: string; first_name: string | null; last_name: string | null; email: string }>()
    if (!other) return c.json({ error: 'Nutzer nicht gefunden.' }, 404)

    // Master-Grenze: gleiche aktive Org
    const myOrg    = await getActiveOrg(db, userId)
    const otherOrg = await getActiveOrg(db, otherId)
    if (!myOrg || !otherOrg || myOrg !== otherOrg) {
      return c.json({ error: 'Chats sind nur innerhalb derselben Organisation möglich.' }, 403)
    }

    // Existierenden DM zwischen den beiden suchen
    const existing = await db
      .prepare(`
        SELECT c.id FROM conversations c
        INNER JOIN conversation_members cm1 ON cm1.conversation_id = c.id AND cm1.user_id = ?
        INNER JOIN conversation_members cm2 ON cm2.conversation_id = c.id AND cm2.user_id = ?
        WHERE c.type = 'DirectMessage' AND c.org_id = ?
        LIMIT 1
      `)
      .bind(userId, otherId, myOrg)
      .first<{ id: number }>()

    let convId: number
    if (existing) {
      convId = Number(existing.id)
    } else {
      const otherName = buildName(other.first_name, other.last_name, other.email)
      const ins = await db
        .prepare(`INSERT INTO conversations (title, type, org_id, is_info_channel, is_read_only)
                  VALUES (?, 'DirectMessage', ?, 0, 0)`)
        .bind(otherName, myOrg)
        .run()
      convId = Number(ins.meta.last_row_id)

      const now = new Date().toISOString()
      await db
        .prepare(`INSERT OR IGNORE INTO conversation_members (conversation_id, user_id, last_read_at)
                  VALUES (?, ?, ?)`)
        .bind(convId, userId, now)
        .run()
      await db
        .prepare(`INSERT OR IGNORE INTO conversation_members (conversation_id, user_id, last_read_at)
                  VALUES (?, ?, '1970-01-01T00:00:00Z')`)
        .bind(convId, otherId)
        .run()
    }

    const dto = await buildConvDto(db, convId, userId)
    if (!dto) return c.json({ error: 'Conversation konnte nicht gebaut werden.' }, 500)
    return c.json(dto, existing ? 200 : 201)
  } catch (e: any) {
    console.error('[POST /conversations]', e?.message ?? e, e?.stack)
    return c.json({ error: `Chat konnte nicht erstellt werden: ${e?.message ?? 'unbekannt'}` }, 500)
  }
})

// ─── POST /conversations/group ──────────────────────────────────────────────
// Erstellt eine OrgGroup-Konversation. Body: { title, memberUserIds[] }
// Strikte Org-Isolation: alle Member müssen in derselben aktiven Org sein.
// Permissions: Owner ist immer erlaubt, sonst can_create_groups muss true sein.

chat.post('/group', async (c) => {
  try {
    const userId = c.get('userId') as string
    const userRow = c.get('userRow') as any
    const db = c.env.DB
    const body = await c.req.json<{ title?: string; memberUserIds?: string[] }>().catch(() => ({}))
    const title = (body.title ?? '').trim()
    const memberIds = Array.isArray(body.memberUserIds) ? body.memberUserIds : []

    if (!title) return c.json({ error: 'Titel ist Pflicht.' }, 400)

    // Eigene Org + Permission prüfen
    const me = await db
      .prepare(`SELECT org_id, role, can_create_groups FROM org_members
                WHERE user_id = ? AND is_active = 1 LIMIT 1`)
      .bind(userId)
      .first<{ org_id: number; role: string; can_create_groups: number }>()
    if (!me) return c.json({ error: 'Du musst in einer Organisation sein um Gruppen zu erstellen.' }, 403)
    if (me.role !== 'Owner' && me.can_create_groups !== 1) {
      return c.json({ error: 'Keine Berechtigung Chat-Gruppen zu erstellen.' }, 403)
    }

    // Alle ausgewählten Mitglieder müssen in derselben Org aktiv sein
    for (const uid of memberIds) {
      if (uid === userId) continue
      const m = await db
        .prepare(`SELECT 1 FROM org_members WHERE user_id = ? AND org_id = ? AND is_active = 1`)
        .bind(uid, me.org_id)
        .first()
      if (!m) {
        return c.json({ error: 'Alle Mitglieder müssen in deiner Organisation sein.' }, 403)
      }
    }

    // Gruppe anlegen
    const ins = await db
      .prepare(`INSERT INTO conversations (title, type, org_id, is_info_channel, is_read_only)
                VALUES (?, 'OrgGroup', ?, 0, 0)`)
      .bind(title, me.org_id)
      .run()
    const convId = Number(ins.meta.last_row_id)

    // Ersteller + alle ausgewählten Mitglieder hinzufügen
    const allIds = Array.from(new Set([userId, ...memberIds]))
    const now = new Date().toISOString()
    for (const uid of allIds) {
      await db
        .prepare(`INSERT OR IGNORE INTO conversation_members (conversation_id, user_id, last_read_at)
                  VALUES (?, ?, ?)`)
        .bind(convId, uid, uid === userId ? now : '1970-01-01T00:00:00Z')
        .run()
    }

    // System-Message: "X hat die Gruppe erstellt"
    const senderName = (`${userRow?.first_name ?? ''} ${userRow?.last_name ?? ''}`.trim()) || userRow?.email || 'Jemand'
    await db
      .prepare(`INSERT INTO messages (conversation_id, sender_id, sender_name, body, is_system)
                VALUES (?, ?, ?, ?, 1)`)
      .bind(convId, userId, senderName, `${senderName} hat die Gruppe „${title}" erstellt.`)
      .run()

    const dto = await buildConvDto(db, convId, userId)
    if (!dto) return c.json({ error: 'Gruppe nicht gefunden nach Erstellung.' }, 500)
    return c.json(dto, 201)
  } catch (e: any) {
    console.error('[POST /conversations/group]', e?.message ?? e, e?.stack)
    return c.json({ error: `Gruppe konnte nicht erstellt werden: ${e?.message ?? 'unbekannt'}` }, 500)
  }
})

// ─── GET /conversations/:id/messages ────────────────────────────────────────
// Optional ?afterId=N → nur Messages mit id > N (für Polling-Sync).
// Sonst: letzte 100 Messages, ASC sortiert (älteste zuerst, neueste unten).
// Returns: { items: Message[] } — KEINE Pagination, einfach.

chat.get('/:id/messages', async (c) => {
  try {
    const userId = c.get('userId') as string
    const db = c.env.DB
    const convId = c.req.param('id')

    if (!(await ensureMember(db, convId, userId))) {
      return c.json({ error: 'Du bist kein Mitglied dieses Chats.' }, 403)
    }

    const afterIdRaw = c.req.query('afterId')
    const afterId = afterIdRaw ? parseInt(afterIdRaw) : 0
    const limit = Math.min(200, parseInt(c.req.query('limit') ?? '100'))

    let sql: string
    let bindings: any[]
    if (afterId > 0) {
      // Nur neuere Messages — für Polling-Sync
      sql = `SELECT * FROM messages
             WHERE conversation_id = ? AND id > ?
             ORDER BY sent_at ASC LIMIT ?`
      bindings = [convId, afterId, limit]
    } else {
      // Erste Ladung: die letzten N Messages, in ASC-Reihenfolge
      // (DESC + LIMIT, dann clientseitig wieder umkehren wäre aufwendiger;
      // wir machen subquery-Trick)
      sql = `SELECT * FROM (
               SELECT * FROM messages
               WHERE conversation_id = ?
               ORDER BY sent_at DESC LIMIT ?
             ) ORDER BY sent_at ASC`
      bindings = [convId, limit]
    }

    const rows = await db.prepare(sql).bind(...bindings).all<any>()
    const items = (rows.results ?? []).map((m: any) => ({
      id:              m.id,
      conversationId:  m.conversation_id,
      senderId:        m.sender_id,
      senderName:      m.sender_name,
      senderAvatarUrl: null,
      body:            m.body,
      sentAt:          m.sent_at,
      isSystem:        m.is_system === 1,
      attachmentUrl:   m.attachment_url,
      attachmentName:  m.attachment_name,
      attachmentType:  m.attachment_type,
      attachmentBytes: m.attachment_bytes,
    }))

    // last_read_at automatisch nachziehen wenn user aktiv liest
    if (afterId === 0) {
      await db
        .prepare(`UPDATE conversation_members
                  SET last_read_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
                  WHERE conversation_id = ? AND user_id = ?`)
        .bind(convId, userId)
        .run()
    }

    return c.json({ items })
  } catch (e: any) {
    console.error('[GET /conversations/:id/messages]', e?.message ?? e, e?.stack)
    return c.json({ error: `Nachrichten konnten nicht geladen werden: ${e?.message ?? 'unbekannt'}` }, 500)
  }
})

// ─── POST /conversations/:id/messages ───────────────────────────────────────
// Body: { body: string } → speichert + gibt komplette Message zurück.

chat.post('/:id/messages', async (c) => {
  try {
    const userId = c.get('userId') as string
    const db = c.env.DB
    const convId = c.req.param('id')

    if (!(await ensureMember(db, convId, userId))) {
      return c.json({ error: 'Du bist kein Mitglied dieses Chats.' }, 403)
    }

    const conv = await db
      .prepare(`SELECT is_read_only FROM conversations WHERE id = ?`)
      .bind(convId)
      .first<{ is_read_only: number }>()
    if (!conv) return c.json({ error: 'Chat nicht gefunden.' }, 404)
    if (conv.is_read_only === 1) {
      return c.json({ error: 'Dieser Chat ist nur lesbar.' }, 403)
    }

    const body = await c.req.json<{
      body?: string
      attachmentUrl?: string
      attachmentName?: string
      attachmentType?: string
      attachmentBytes?: number
    }>().catch(() => ({}))
    const text = (body.body ?? '').trim()
    const hasAttachment = !!body.attachmentUrl
    if (!text && !hasAttachment) {
      return c.json({ error: 'Nachricht darf nicht leer sein.' }, 400)
    }

    const senderRow = await db
      .prepare(`SELECT first_name, last_name, email FROM users WHERE id = ?`)
      .bind(userId)
      .first<{ first_name: string | null; last_name: string | null; email: string }>()
    const senderName = buildName(senderRow?.first_name, senderRow?.last_name, senderRow?.email ?? 'Unbekannt')

    const ins = await db
      .prepare(`INSERT INTO messages
                  (conversation_id, sender_id, sender_name, body, is_system,
                   attachment_url, attachment_name, attachment_type, attachment_bytes)
                VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)`)
      .bind(
        convId, userId, senderName, text,
        body.attachmentUrl  ?? null,
        body.attachmentName ?? null,
        body.attachmentType ?? null,
        body.attachmentBytes ?? null
      )
      .run()
    const newId = Number(ins.meta.last_row_id)

    // Sender's last_read_at gleich nachziehen
    await db
      .prepare(`UPDATE conversation_members
                SET last_read_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
                WHERE conversation_id = ? AND user_id = ?`)
      .bind(convId, userId)
      .run()

    const row = await db.prepare(`SELECT * FROM messages WHERE id = ?`).bind(newId).first<any>()
    if (!row) return c.json({ error: 'Message nach Insert nicht gefunden.' }, 500)

    return c.json({
      id:              row.id,
      conversationId:  row.conversation_id,
      senderId:        row.sender_id,
      senderName:      row.sender_name,
      senderAvatarUrl: null,
      body:            row.body,
      sentAt:          row.sent_at,
      isSystem:        row.is_system === 1,
      attachmentUrl:   row.attachment_url,
      attachmentName:  row.attachment_name,
      attachmentType:  row.attachment_type,
      attachmentBytes: row.attachment_bytes,
    }, 201)
  } catch (e: any) {
    console.error('[POST /conversations/:id/messages]', e?.message ?? e, e?.stack)
    return c.json({ error: `Nachricht senden fehlgeschlagen: ${e?.message ?? 'unbekannt'}` }, 500)
  }
})

// Alias für Kompatibilität (alte iOS-App nutzt /send)
chat.post('/:id/send', async (c) => {
  try {
    const userId = c.get('userId') as string
    const db = c.env.DB
    const convId = c.req.param('id')

    if (!(await ensureMember(db, convId, userId))) {
      return c.json({ error: 'Du bist kein Mitglied dieses Chats.' }, 403)
    }

    const body = await c.req.json<{ body?: string }>().catch(() => ({}))
    const text = (body.body ?? '').trim()
    if (!text) return c.json({ error: 'Nachricht darf nicht leer sein.' }, 400)

    const senderRow = await db
      .prepare(`SELECT first_name, last_name, email FROM users WHERE id = ?`)
      .bind(userId)
      .first<{ first_name: string | null; last_name: string | null; email: string }>()
    const senderName = buildName(senderRow?.first_name, senderRow?.last_name, senderRow?.email ?? 'Unbekannt')

    const ins = await db
      .prepare(`INSERT INTO messages (conversation_id, sender_id, sender_name, body, is_system)
                VALUES (?, ?, ?, ?, 0)`)
      .bind(convId, userId, senderName, text)
      .run()
    const newId = Number(ins.meta.last_row_id)

    await db
      .prepare(`UPDATE conversation_members
                SET last_read_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
                WHERE conversation_id = ? AND user_id = ?`)
      .bind(convId, userId)
      .run()

    const row = await db.prepare(`SELECT * FROM messages WHERE id = ?`).bind(newId).first<any>()
    if (!row) return c.json({ error: 'Message nach Insert nicht gefunden.' }, 500)

    return c.json({
      id:              row.id,
      conversationId:  row.conversation_id,
      senderId:        row.sender_id,
      senderName:      row.sender_name,
      senderAvatarUrl: null,
      body:            row.body,
      sentAt:          row.sent_at,
      isSystem:        row.is_system === 1,
      attachmentUrl:   null,
      attachmentName:  null,
      attachmentType:  null,
      attachmentBytes: null,
    }, 201)
  } catch (e: any) {
    console.error('[POST /conversations/:id/send]', e?.message ?? e)
    return c.json({ error: `Nachricht senden fehlgeschlagen: ${e?.message ?? 'unbekannt'}` }, 500)
  }
})

// ─── POST /conversations/:id/upload ─────────────────────────────────────────
// Multipart-Form: { file } → upload zu R2 → returns { attachmentUrl, attachmentName, attachmentType, attachmentBytes }
// Speichert NICHT direkt eine Message — Client kann erst Anhang hochladen,
// dann mit `attachmentUrl` per POST /messages senden.

chat.post('/:id/upload', async (c) => {
  try {
    const userId = c.get('userId') as string
    const db = c.env.DB
    const convId = c.req.param('id')

    if (!(await ensureMember(db, convId, userId))) {
      return c.json({ error: 'Du bist kein Mitglied dieses Chats.' }, 403)
    }

    const parsed = await parseFileUpload(c.req.raw)
    if (!parsed) return c.json({ error: 'Keine Datei im Form-Data.' }, 400)

    const uploaded = await uploadToR2(
      c.env.UPLOADS,
      parsed.file,
      parsed.filename,
      parsed.contentType,
      `chat/${convId}/${Date.now()}`
    )

    const isImage = (parsed.contentType ?? '').startsWith('image/')
    return c.json({
      attachmentUrl:   uploaded.url,
      attachmentName:  parsed.filename,
      attachmentType:  isImage ? 'image' : 'file',
      attachmentBytes: parsed.file.byteLength,
    })
  } catch (e: any) {
    console.error('[POST /conversations/:id/upload]', e?.message ?? e)
    return c.json({ error: `Upload fehlgeschlagen: ${e?.message ?? 'unbekannt'}` }, 500)
  }
})

// ─── POST /messages mit Anhang erweitert ────────────────────────────────────
// Bereits implementiert oben — wir erweitern den Body um attachment_*

// ─── DELETE /conversations/:id ──────────────────────────────────────────────
// Entfernt den User aus dem Thread. Wenn niemand mehr drin ist, wird der Thread
// (und alle Messages) cascade-gelöscht.
//
// Für DMs: anderer User behält den Chat erstmal — sein last_read_at bleibt
// stehen, beim nächsten Aufruf wird der DM neu lazy-erstellt wenn jemand
// schreibt. Klares "Chat verlassen"-Verhalten.

chat.delete('/:id', async (c) => {
  try {
    const userId = c.get('userId') as string
    const db = c.env.DB
    const convId = c.req.param('id')

    if (!(await ensureMember(db, convId, userId))) {
      return c.json({ error: 'Du bist kein Mitglied dieses Chats.' }, 403)
    }

    // Membership entfernen
    await db
      .prepare(`DELETE FROM conversation_members WHERE conversation_id = ? AND user_id = ?`)
      .bind(convId, userId)
      .run()

    // Bleibt jemand übrig?
    const rest = await db
      .prepare(`SELECT COUNT(*) AS n FROM conversation_members WHERE conversation_id = ?`)
      .bind(convId)
      .first<{ n: number }>()

    if ((rest?.n ?? 0) === 0) {
      // Alleine → komplett löschen (messages cascaded via FK)
      await db.prepare(`DELETE FROM conversations WHERE id = ?`).bind(convId).run()
    }

    return c.json({ ok: true })
  } catch (e: any) {
    console.error('[DELETE /conversations/:id]', e?.message ?? e)
    return c.json({ error: `Chat konnte nicht gelöscht werden: ${e?.message ?? 'unbekannt'}` }, 500)
  }
})

// ─── POST /conversations/:id/read ───────────────────────────────────────────

chat.post('/:id/read', async (c) => {
  try {
    const userId = c.get('userId') as string
    const db = c.env.DB
    const convId = c.req.param('id')

    if (!(await ensureMember(db, convId, userId))) {
      return c.json({ error: 'Du bist kein Mitglied dieses Chats.' }, 403)
    }

    await db
      .prepare(`UPDATE conversation_members
                SET last_read_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
                WHERE conversation_id = ? AND user_id = ?`)
      .bind(convId, userId)
      .run()

    return c.json({ ok: true })
  } catch (e: any) {
    console.error('[POST /conversations/:id/read]', e?.message ?? e)
    return c.json({ error: `Markieren fehlgeschlagen: ${e?.message ?? 'unbekannt'}` }, 500)
  }
})

export default chat
