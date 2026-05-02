// ── Password / PIN Hashing via Web Crypto (PBKDF2-SHA256) ────────────────────
// Format: pbkdf2:sha256:100000:<salt_hex>:<hash_hex>
// Compatible across Cloudflare Workers (no Node.js bcrypt needed)

const ITERATIONS = 100_000
const KEY_LEN    = 32        // 256 bits

function hexFromBytes(buf: Uint8Array): string {
  return Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('')
}

function bytesFromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2)
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16)
  return bytes
}

export async function hashPassword(password: string): Promise<string> {
  const enc  = new TextEncoder()
  const salt = crypto.getRandomValues(new Uint8Array(16))

  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    keyMaterial, KEY_LEN * 8
  )

  return `pbkdf2:sha256:${ITERATIONS}:${hexFromBytes(salt)}:${hexFromBytes(new Uint8Array(bits))}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(':')
  if (parts.length !== 5 || parts[0] !== 'pbkdf2') return false

  const iterations = parseInt(parts[2])
  const salt       = bytesFromHex(parts[3])
  const expected   = parts[4]

  const enc         = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial, KEY_LEN * 8
  )
  const actual = hexFromBytes(new Uint8Array(bits))

  // Constant-time compare
  return timingSafeEqual(actual, expected)
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** Generate a cryptographically random 6-digit code */
export function randomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(3))
  const num   = ((bytes[0] << 16) | (bytes[1] << 8) | bytes[2]) % 1_000_000
  return num.toString().padStart(6, '0')
}

/** Generate a random URL-safe token (32 bytes = 64 hex chars) */
export function randomToken(): string {
  return hexFromBytes(crypto.getRandomValues(new Uint8Array(32)))
}

/** Generate a new UUID v4 */
export function uuid(): string {
  return crypto.randomUUID()
}

/** Short random invite code (8 uppercase chars) */
export function randomInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  return Array.from(bytes).map(b => chars[b % chars.length]).join('')
}
