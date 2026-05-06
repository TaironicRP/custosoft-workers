// ════════════════════════════════════════════════════════════════════════════
//  apns.ts — Apple Push Notification Service Sender
//
//  Authentifizierung via .p8-Token (kein Cert nötig, modernes Setup):
//   1. JWT mit ES256 (P-256 ECDSA) gegen den `.p8`-Private-Key signieren
//   2. JWT als Bearer-Token in den HTTP/2-Request an api.push.apple.com
//   3. apns-topic = Bundle-ID, payload im standard "aps"-Format
//
//  JWT wird gecached (max 50 min, Apple empfiehlt < 60 min). Ohne Caching
//  würde jeder Push einen neuen JWT generieren — das ist langsam und Apple
//  rate-limited bei zu vielen Connection-Resets.
// ════════════════════════════════════════════════════════════════════════════

interface ApnsConfig {
  /** Apple Developer Team-ID (10 Zeichen) */
  teamId:     string
  /** APNS Auth-Key-ID (10 Zeichen, vom .p8-File) */
  keyId:      string
  /** PEM-encoded EC Private Key — Inhalt der .p8-Datei */
  privateKey: string
  /** App-Bundle-ID, z.B. com.taironic.custosoft */
  bundleId:   string
  /** Production endpoint oder Sandbox (für TestFlight/dev nicht relevant —
   *  TestFlight nutzt Production, Sandbox ist nur für lokale Xcode-Builds). */
  environment: 'production' | 'sandbox'
}

export interface ApnsPayload {
  /** Notification-Titel (wird auf Lock-Screen + Dynamic Island gezeigt) */
  title:    string
  /** Body-Text (Vorschau der Nachricht) */
  body:     string
  /** Optional: Subtitle (kleiner Untertitel zwischen title und body) */
  subtitle?: string
  /** Badge-Number (Icon-Counter). null = nicht ändern, 0 = clearn */
  badge?:   number | null
  /** Sound — 'default' für Standard, oder Datei-Name. null = stumm */
  sound?:   string | null
  /** Custom Data fürs App-Routing (Conversation-ID etc.) */
  data?:    Record<string, any>
  /** Thread-ID — gruppiert Nachrichten desselben Threads im Lock-Screen */
  threadId?: string
  /** Collapse-ID — neuere Push überschreiben ältere mit gleicher ID */
  collapseId?: string
}

export interface ApnsResult {
  ok:         boolean
  status:     number
  error?:     string
  /** Apple gibt manchmal "Unregistered" zurück — Token ist tot. */
  isInvalid:  boolean
}

// ── JWT-Cache (modul-weit, lebt für die Dauer der Worker-Instanz) ──────────
let cachedToken: { jwt: string; expiresAt: number } | null = null
const TOKEN_TTL_MS = 50 * 60 * 1000   // 50 Min — Apple max ist 1h

/// Generiert oder reused einen signierten JWT für APNS-Auth.
async function getApnsJwt(cfg: ApnsConfig): Promise<string> {
  const now = Date.now()
  if (cachedToken && cachedToken.expiresAt > now + 60_000) {
    return cachedToken.jwt
  }

  const header  = { alg: 'ES256', kid: cfg.keyId, typ: 'JWT' }
  const payload = { iss: cfg.teamId, iat: Math.floor(now / 1000) }

  const headerB64  = base64UrlEncode(new TextEncoder().encode(JSON.stringify(header)))
  const payloadB64 = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)))
  const signingInput = `${headerB64}.${payloadB64}`

  const key = await importP8PrivateKey(cfg.privateKey)
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: { name: 'SHA-256' } },
    key,
    new TextEncoder().encode(signingInput),
  )
  const jwt = `${signingInput}.${base64UrlEncode(new Uint8Array(sig))}`

  cachedToken = { jwt, expiresAt: now + TOKEN_TTL_MS }
  return jwt
}

/// PEM-Format des .p8 → CryptoKey für ECDSA-Signing
async function importP8PrivateKey(pem: string): Promise<CryptoKey> {
  const cleaned = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '')
  const der = base64ToArrayBuffer(cleaned)
  return crypto.subtle.importKey(
    'pkcs8',
    der,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  )
}

// ── Push-Send ────────────────────────────────────────────────────────────────

/// Schickt einen Push an genau einen Device-Token.
/// Liefert ein ApnsResult — bei isInvalid=true sollte der Caller den Token
/// aus der DB löschen.
export async function sendApnsPush(
  cfg:    ApnsConfig,
  token:  string,
  payload: ApnsPayload,
): Promise<ApnsResult> {
  const jwt = await getApnsJwt(cfg)

  const aps: any = {
    alert: {
      title:    payload.title,
      body:     payload.body,
      ...(payload.subtitle ? { subtitle: payload.subtitle } : {}),
    },
    'mutable-content': 1,
  }
  if (payload.badge !== undefined) aps.badge = payload.badge
  if (payload.sound !== undefined) aps.sound = payload.sound ?? 'default'
  else                              aps.sound = 'default'
  if (payload.threadId)             aps['thread-id'] = payload.threadId

  const body = { aps, ...(payload.data ?? {}) }

  const host = cfg.environment === 'sandbox'
    ? 'api.sandbox.push.apple.com'
    : 'api.push.apple.com'

  const headers: Record<string, string> = {
    'authorization': `bearer ${jwt}`,
    'apns-topic':    cfg.bundleId,
    'apns-push-type': 'alert',
    'apns-priority': '10',
    'content-type':  'application/json',
  }
  if (payload.collapseId) headers['apns-collapse-id'] = payload.collapseId

  try {
    const res = await fetch(`https://${host}/3/device/${token}`, {
      method: 'POST',
      headers,
      body:   JSON.stringify(body),
    })

    if (res.ok) return { ok: true, status: res.status, isInvalid: false }

    let reason = ''
    try {
      const j = await res.json<{ reason?: string }>()
      reason = j?.reason ?? ''
    } catch { /* no body */ }

    // Tokens markieren wir als „invalid" und sollten gelöscht werden
    const isInvalid =
      res.status === 410 ||                           // gone
      reason === 'Unregistered' ||
      reason === 'BadDeviceToken' ||
      reason === 'DeviceTokenNotForTopic'

    return { ok: false, status: res.status, error: reason || `HTTP ${res.status}`, isInvalid }
  } catch (e: any) {
    return { ok: false, status: 0, error: e?.message ?? 'fetch failed', isInvalid: false }
  }
}

/// Sammeltreiber: schickt an mehrere Tokens parallel und löscht ungültige
/// aus der DB. Ergebnis: Anzahl erfolgreicher Sendungen.
export async function sendApnsToUsers(
  db:        D1Database,
  cfg:       ApnsConfig,
  userIds:   string[],
  payload:   ApnsPayload,
): Promise<{ sent: number; failed: number; cleaned: number }> {
  if (userIds.length === 0) return { sent: 0, failed: 0, cleaned: 0 }

  // Tokens für die User holen (nur ios+mac — web kommt später via Web Push)
  const placeholders = userIds.map(() => '?').join(',')
  const rows = await db.prepare(
    `SELECT id, user_id, token, environment FROM device_tokens
     WHERE user_id IN (${placeholders}) AND platform IN ('ios', 'mac')`
  ).bind(...userIds).all<{ id: number; user_id: string; token: string; environment: string }>()

  const tokens = rows.results ?? []
  if (tokens.length === 0) return { sent: 0, failed: 0, cleaned: 0 }

  let sent = 0, failed = 0, cleaned = 0
  const toDelete: number[] = []

  // Parallel — Workers haben ein subrequests-limit von 50 pro Request,
  // bei mehr Tokens batchen wir in 25er-Gruppen.
  const BATCH = 25
  for (let i = 0; i < tokens.length; i += BATCH) {
    const batch = tokens.slice(i, i + BATCH)
    const results = await Promise.all(
      batch.map(t => sendApnsPush(
        { ...cfg, environment: t.environment === 'sandbox' ? 'sandbox' : 'production' },
        t.token,
        payload,
      ))
    )
    results.forEach((r, idx) => {
      if (r.ok) sent++
      else {
        failed++
        if (r.isInvalid) toDelete.push(batch[idx].id)
      }
    })
  }

  // Tote Tokens entfernen
  if (toDelete.length > 0) {
    const dPlaceholders = toDelete.map(() => '?').join(',')
    await db.prepare(`DELETE FROM device_tokens WHERE id IN (${dPlaceholders})`)
      .bind(...toDelete).run()
    cleaned = toDelete.length
  }

  return { sent, failed, cleaned }
}

// ── Base64 / URL-safe Encoding ──────────────────────────────────────────────

function base64UrlEncode(bytes: Uint8Array | ArrayBuffer): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let s = ''
  for (let i = 0; i < arr.byteLength; i++) s += String.fromCharCode(arr[i])
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64)
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return arr.buffer
}
