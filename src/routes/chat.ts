import { Hono } from 'hono'
import { requireAuth } from '../middleware/auth'
import type { Env, AppEnv } from '../types'
import { uploadToR2, parseFileUpload } from '../utils/r2'

const chat = new Hono<AppEnv>()

chat.use('*', requireAuth)

// GET /conversations
chat.get('/conversations', async (c) => {
  const user = c.get('user')
  const db = c.env.DB

  const conversations = await db
    .prepare(
      `SELECT
        conv.id,
        conv.title,
        conv.type,
        conv.org_id AS orgId,
        conv.is_info_channel AS isInfoChannel,
        conv.is_read_only AS isReadOnly,
        (SELECT COUNT(*) FROM conversation_members cm2 WHERE cm2.conversation_id = conv.id) AS memberCount,
        cm.last_read_at AS lastReadAt,
        (
          SELECT COUNT(*)
          FROM messages m2
          WHERE m2.conversation_id = conv.id
            AND m2.sent_at > COALESCE(cm.last_read_at, '1970-01-01T00:00:00Z')
        ) AS unreadCount,
        (
          SELECT json_object(
            'id', m.id,
            'conversationId', m.conversation_id,
            'senderId', m.sender_id,
            'senderName', u.display_name,
            'senderAvatarUrl', u.avatar_url,
            'body', m.body,
            'sentAt', m.sent_at,
            'isSystem', m.is_system,
            'attachmentUrl', m.attachment_url,
            'attachmentName', m.attachment_name,
            'attachmentType', m.attachment_type,
            'attachmentBytes', m.attachment_bytes
          )
          FROM messages m
          LEFT JOIN users u ON u.id = m.sender_id
          WHERE m.conversation_id = conv.id
          ORDER BY m.sent_at DESC
          LIMIT 1
        ) AS lastMessageJson
      FROM conversations conv
      INNER JOIN conversation_members cm ON cm.conversation_id = conv.id AND cm.user_id = ?
      ORDER BY COALESCE(
        (SELECT MAX(sent_at) FROM messages WHERE conversation_id = conv.id),
        conv.created_at
      ) DESC`
    )
    .bind(user.id)
    .all()

  const result = (conversations.results ?? []).map((row: any) => ({
    id: row.id,
    title: row.title,
    type: row.type,
    orgId: row.orgId,
    isInfoChannel: row.isInfoChannel === 1,
    isReadOnly: row.isReadOnly === 1,
    memberCount: row.memberCount,
    unreadCount: row.unreadCount,
    lastMessage: row.lastMessageJson ? JSON.parse(row.lastMessageJson) : null,
  }))

  return c.json(result)
})

// POST /conversations/group
chat.post('/conversations/group', async (c) => {
  const user = c.get('user')
  const db = c.env.DB
  const body = await c.req.json<{ title: string; memberIds: string[] }>()

  if (!body.title || !Array.isArray(body.memberIds)) {
    return c.json({ error: 'title and memberIds are required' }, 400)
  }

  const orgMember = await db
    .prepare(`SELECT org_id FROM org_members WHERE user_id = ? LIMIT 1`)
    .bind(user.id)
    .first<{ org_id: string }>()

  if (!orgMember) {
    return c.json({ error: 'You must be in an organisation to create a group' }, 403)
  }

  const convId = crypto.randomUUID()
  const now = `strftime('%Y-%m-%dT%H:%M:%SZ','now')`

  await db
    .prepare(
      `INSERT INTO conversations (id, title, type, org_id, is_info_channel, is_read_only, created_at)
       VALUES (?, ?, 'group', ?, 0, 0, strftime('%Y-%m-%dT%H:%M:%SZ','now'))`
    )
    .bind(convId, body.title.trim(), orgMember.org_id)
    .run()

  const allMemberIds = Array.from(new Set([user.id, ...body.memberIds]))
  for (const memberId of allMemberIds) {
    await db
      .prepare(
        `INSERT OR IGNORE INTO conversation_members (conversation_id, user_id, last_read_at)
         VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))`
      )
      .bind(convId, memberId)
      .run()
  }

  const conv = await db
    .prepare(`SELECT * FROM conversations WHERE id = ?`)
    .bind(convId)
    .first<any>()

  return c.json(
    {
      id: conv.id,
      title: conv.title,
      type: conv.type,
      orgId: conv.org_id,
      isInfoChannel: conv.is_info_channel === 1,
      isReadOnly: conv.is_read_only === 1,
      memberCount: allMemberIds.length,
      unreadCount: 0,
      lastMessage: null,
    },
    201
  )
})

// POST /conversations/request
chat.post('/conversations/request', async (c) => {
  const user = c.get('user')
  const db = c.env.DB
  const body = await c.req.json<{ userId: string; message?: string }>()

  if (!body.userId) {
    return c.json({ error: 'userId is required' }, 400)
  }

  if (body.userId === user.id) {
    return c.json({ error: 'Cannot send a DM request to yourself' }, 400)
  }

  const target = await db
    .prepare(`SELECT id, display_name FROM users WHERE id = ?`)
    .bind(body.userId)
    .first<{ id: string; display_name: string }>()

  if (!target) {
    return c.json({ error: 'User not found' }, 404)
  }

  // Check for existing DM between the two users
  const existing = await db
    .prepare(
      `SELECT c.id FROM conversations c
       INNER JOIN conversation_members cm1 ON cm1.conversation_id = c.id AND cm1.user_id = ?
       INNER JOIN conversation_members cm2 ON cm2.conversation_id = c.id AND cm2.user_id = ?
       WHERE c.type = 'dm'
       LIMIT 1`
    )
    .bind(user.id, body.userId)
    .first<{ id: string }>()

  if (existing) {
    return c.json({ error: 'A DM conversation already exists' }, 409)
  }

  const convId = crypto.randomUUID()

  await db
    .prepare(
      `INSERT INTO conversations (id, title, type, org_id, is_info_channel, is_read_only, is_pending, created_at)
       VALUES (?, NULL, 'dm', NULL, 0, 0, 1, strftime('%Y-%m-%dT%H:%M:%SZ','now'))`
    )
    .bind(convId)
    .run()

  await db
    .prepare(
      `INSERT INTO conversation_members (conversation_id, user_id, last_read_at)
       VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))`
    )
    .bind(convId, user.id)
    .run()

  await db
    .prepare(
      `INSERT INTO conversation_members (conversation_id, user_id, last_read_at)
       VALUES (?, ?, '1970-01-01T00:00:00Z')`
    )
    .bind(convId, body.userId)
    .run()

  if (body.message) {
    const msgId = crypto.randomUUID()
    await db
      .prepare(
        `INSERT INTO messages (id, conversation_id, sender_id, body, sent_at, is_system)
         VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'), 0)`
      )
      .bind(msgId, convId, user.id, body.message.trim())
      .run()
  }

  return c.json({ ok: true, conversationId: convId }, 201)
})

// GET /conversations/requests/incoming
chat.get('/conversations/requests/incoming', async (c) => {
  const user = c.get('user')
  const db = c.env.DB

  const requests = await db
    .prepare(
      `SELECT
        conv.id,
        conv.type,
        cm_sender.user_id AS senderId,
        u.display_name AS senderName,
        u.avatar_url AS senderAvatarUrl,
        (
          SELECT m.body FROM messages m
          WHERE m.conversation_id = conv.id
          ORDER BY m.sent_at ASC
          LIMIT 1
        ) AS firstMessage,
        conv.created_at AS createdAt
      FROM conversations conv
      INNER JOIN conversation_members cm_me ON cm_me.conversation_id = conv.id AND cm_me.user_id = ?
      INNER JOIN conversation_members cm_sender ON cm_sender.conversation_id = conv.id AND cm_sender.user_id != ?
      INNER JOIN users u ON u.id = cm_sender.user_id
      WHERE conv.type = 'dm' AND conv.is_pending = 1`
    )
    .bind(user.id, user.id)
    .all()

  return c.json(requests.results ?? [])
})

// GET /conversations/:id/messages
chat.get('/conversations/:id/messages', async (c) => {
  const user = c.get('user')
  const db = c.env.DB
  const convId = c.req.param('id')
  const page = Math.max(1, parseInt(c.req.query('page') ?? '1'))
  const pageSize = Math.min(100, Math.max(1, parseInt(c.req.query('pageSize') ?? '40')))
  const offset = (page - 1) * pageSize

  const member = await db
    .prepare(`SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?`)
    .bind(convId, user.id)
    .first()

  if (!member) {
    return c.json({ error: 'Not a member of this conversation' }, 403)
  }

  const messages = await db
    .prepare(
      `SELECT
        m.id,
        m.conversation_id AS conversationId,
        m.sender_id AS senderId,
        u.display_name AS senderName,
        u.avatar_url AS senderAvatarUrl,
        m.body,
        m.sent_at AS sentAt,
        m.is_system AS isSystem,
        m.attachment_url AS attachmentUrl,
        m.attachment_name AS attachmentName,
        m.attachment_type AS attachmentType,
        m.attachment_bytes AS attachmentBytes
      FROM messages m
      LEFT JOIN users u ON u.id = m.sender_id
      WHERE m.conversation_id = ?
      ORDER BY m.sent_at DESC
      LIMIT ? OFFSET ?`
    )
    .bind(convId, pageSize, offset)
    .all()

  // Update last_read_at
  await db
    .prepare(
      `UPDATE conversation_members
       SET last_read_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
       WHERE conversation_id = ? AND user_id = ?`
    )
    .bind(convId, user.id)
    .run()

  const result = (messages.results ?? []).map((m: any) => ({
    ...m,
    isSystem: m.isSystem === 1,
  }))

  return c.json({ page, pageSize, messages: result })
})

// POST /conversations/:id/send
chat.post('/conversations/:id/send', async (c) => {
  const user = c.get('user')
  const db = c.env.DB
  const convId = c.req.param('id')

  const member = await db
    .prepare(`SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?`)
    .bind(convId, user.id)
    .first()

  if (!member) {
    return c.json({ error: 'Not a member of this conversation' }, 403)
  }

  const conv = await db
    .prepare(`SELECT is_read_only FROM conversations WHERE id = ?`)
    .bind(convId)
    .first<{ is_read_only: number }>()

  if (!conv) {
    return c.json({ error: 'Conversation not found' }, 404)
  }

  if (conv.is_read_only) {
    return c.json({ error: 'This conversation is read-only' }, 403)
  }

  const body = await c.req.json<{
    body?: string
    attachmentUrl?: string
    attachmentName?: string
    attachmentType?: string
    attachmentBytes?: number
  }>()

  if (!body.body && !body.attachmentUrl) {
    return c.json({ error: 'body or attachmentUrl is required' }, 400)
  }

  const msgId = crypto.randomUUID()

  await db
    .prepare(
      `INSERT INTO messages (id, conversation_id, sender_id, body, sent_at, is_system, attachment_url, attachment_name, attachment_type, attachment_bytes)
       VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'), 0, ?, ?, ?, ?)`
    )
    .bind(
      msgId,
      convId,
      user.id,
      body.body ?? null,
      body.attachmentUrl ?? null,
      body.attachmentName ?? null,
      body.attachmentType ?? null,
      body.attachmentBytes ?? null
    )
    .run()

  // Update sender's last_read_at
  await db
    .prepare(
      `UPDATE conversation_members
       SET last_read_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
       WHERE conversation_id = ? AND user_id = ?`
    )
    .bind(convId, user.id)
    .run()

  // Activate pending DM if needed
  await db
    .prepare(`UPDATE conversations SET is_pending = 0 WHERE id = ? AND is_pending = 1`)
    .bind(convId)
    .run()

  const senderRow = await db
    .prepare(`SELECT display_name, avatar_url FROM users WHERE id = ?`)
    .bind(user.id)
    .first<{ display_name: string; avatar_url: string | null }>()

  const msg = await db
    .prepare(`SELECT * FROM messages WHERE id = ?`)
    .bind(msgId)
    .first<any>()

  return c.json(
    {
      id: msg.id,
      conversationId: msg.conversation_id,
      senderId: msg.sender_id,
      senderName: senderRow?.display_name ?? null,
      senderAvatarUrl: senderRow?.avatar_url ?? null,
      body: msg.body,
      sentAt: msg.sent_at,
      isSystem: false,
      attachmentUrl: msg.attachment_url,
      attachmentName: msg.attachment_name,
      attachmentType: msg.attachment_type,
      attachmentBytes: msg.attachment_bytes,
    },
    201
  )
})

// POST /conversations/:id/upload
chat.post('/conversations/:id/upload', async (c) => {
  const user = c.get('user')
  const db = c.env.DB
  const convId = c.req.param('id')

  const member = await db
    .prepare(`SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?`)
    .bind(convId, user.id)
    .first()

  if (!member) {
    return c.json({ error: 'Not a member of this conversation' }, 403)
  }

  let fileInfo: { url: string; name: string; type: string; bytes: number }
  try {
    const parsed = await parseFileUpload(c.req.raw)
    if (!parsed) return c.json({ error: 'No file in form-data' }, 400)
    const uploaded = await uploadToR2(c.env.UPLOADS, parsed.file, parsed.filename, parsed.contentType, `chat/${convId}`)
    fileInfo = { url: uploaded.url, name: uploaded.name, type: uploaded.type, bytes: uploaded.bytes }
  } catch (err) {
    return c.json({ error: 'File upload failed' }, 500)
  }

  const msgId = crypto.randomUUID()

  await db
    .prepare(
      `INSERT INTO messages (id, conversation_id, sender_id, body, sent_at, is_system, attachment_url, attachment_name, attachment_type, attachment_bytes)
       VALUES (?, ?, ?, NULL, strftime('%Y-%m-%dT%H:%M:%SZ','now'), 0, ?, ?, ?, ?)`
    )
    .bind(msgId, convId, user.id, fileInfo.url, fileInfo.name, fileInfo.type, fileInfo.bytes)
    .run()

  await db
    .prepare(
      `UPDATE conversation_members SET last_read_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
       WHERE conversation_id = ? AND user_id = ?`
    )
    .bind(convId, user.id)
    .run()

  return c.json(
    {
      id: msgId,
      conversationId: convId,
      senderId: user.id,
      body: null,
      sentAt: new Date().toISOString(),
      isSystem: false,
      attachmentUrl: fileInfo.url,
      attachmentName: fileInfo.name,
      attachmentType: fileInfo.type,
      attachmentBytes: fileInfo.bytes,
    },
    201
  )
})

// GET /conversations/:id/members
chat.get('/conversations/:id/members', async (c) => {
  const user = c.get('user')
  const db = c.env.DB
  const convId = c.req.param('id')

  const isMember = await db
    .prepare(`SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?`)
    .bind(convId, user.id)
    .first()

  if (!isMember) {
    return c.json({ error: 'Not a member of this conversation' }, 403)
  }

  const members = await db
    .prepare(
      `SELECT
        u.id,
        u.display_name AS displayName,
        u.avatar_url AS avatarUrl,
        u.position_title AS positionTitle,
        cm.joined_at AS joinedAt
      FROM conversation_members cm
      INNER JOIN users u ON u.id = cm.user_id
      WHERE cm.conversation_id = ?
      ORDER BY u.display_name`
    )
    .bind(convId)
    .all()

  return c.json(members.results ?? [])
})

// POST /conversations/:id/leave
chat.post('/conversations/:id/leave', async (c) => {
  const user = c.get('user')
  const db = c.env.DB
  const convId = c.req.param('id')

  const isMember = await db
    .prepare(`SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?`)
    .bind(convId, user.id)
    .first()

  if (!isMember) {
    return c.json({ error: 'Not a member of this conversation' }, 403)
  }

  await db
    .prepare(`DELETE FROM conversation_members WHERE conversation_id = ? AND user_id = ?`)
    .bind(convId, user.id)
    .run()

  // Post system message
  const msgId = crypto.randomUUID()
  const senderRow = await db
    .prepare(`SELECT display_name FROM users WHERE id = ?`)
    .bind(user.id)
    .first<{ display_name: string }>()

  await db
    .prepare(
      `INSERT INTO messages (id, conversation_id, sender_id, body, sent_at, is_system)
       VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'), 1)`
    )
    .bind(msgId, convId, user.id, `${senderRow?.display_name ?? 'A user'} has left the group.`)
    .run()

  return c.json({ ok: true })
})

// POST /conversations/:id/invite
chat.post('/conversations/:id/invite', async (c) => {
  const user = c.get('user')
  const db = c.env.DB
  const convId = c.req.param('id')
  const body = await c.req.json<{ userId: string }>()

  if (!body.userId) {
    return c.json({ error: 'userId is required' }, 400)
  }

  const isMember = await db
    .prepare(`SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?`)
    .bind(convId, user.id)
    .first()

  if (!isMember) {
    return c.json({ error: 'Not a member of this conversation' }, 403)
  }

  const target = await db
    .prepare(`SELECT id, display_name FROM users WHERE id = ?`)
    .bind(body.userId)
    .first<{ id: string; display_name: string }>()

  if (!target) {
    return c.json({ error: 'User not found' }, 404)
  }

  const alreadyMember = await db
    .prepare(`SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?`)
    .bind(convId, body.userId)
    .first()

  if (alreadyMember) {
    return c.json({ error: 'User is already a member' }, 409)
  }

  await db
    .prepare(
      `INSERT INTO conversation_members (conversation_id, user_id, last_read_at)
       VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))`
    )
    .bind(convId, body.userId)
    .run()

  // Post system message
  const inviterRow = await db
    .prepare(`SELECT display_name FROM users WHERE id = ?`)
    .bind(user.id)
    .first<{ display_name: string }>()

  const msgId = crypto.randomUUID()
  await db
    .prepare(
      `INSERT INTO messages (id, conversation_id, sender_id, body, sent_at, is_system)
       VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'), 1)`
    )
    .bind(
      msgId,
      convId,
      user.id,
      `${inviterRow?.display_name ?? 'Someone'} added ${target.display_name} to the group.`
    )
    .run()

  return c.json({ ok: true }, 201)
})

export default chat
