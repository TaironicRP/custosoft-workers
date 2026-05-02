// ── JWT Helpers (jose — works natively in Cloudflare Workers) ─────────────────
import { SignJWT, jwtVerify, type JWTPayload } from 'jose'

export interface CustoPayload extends JWTPayload {
  sub:    string   // userId
  email:  string
  role:   string   // app_role or 'user'
}

/** Sign a new access token */
export async function signToken(
  payload: Omit<CustoPayload, 'iat' | 'exp'>,
  secret: string,
  expiresIn = '720h'    // 30 days — matches iOS session
): Promise<string> {
  const key = new TextEncoder().encode(secret)
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .setIssuer('CustoSoftAPI')
    .setAudience('CustoSoftApp')
    .sign(key)
}

/** Verify and decode a token — throws on invalid/expired */
export async function verifyToken(token: string, secret: string): Promise<CustoPayload> {
  const key = new TextEncoder().encode(secret)
  const { payload } = await jwtVerify(token, key, {
    issuer:   'CustoSoftAPI',
    audience: 'CustoSoftApp',
  })
  return payload as CustoPayload
}

/** Extract bearer token from Authorization header */
export function extractBearer(authHeader: string | null): string | null {
  if (!authHeader?.startsWith('Bearer ')) return null
  return authHeader.slice(7).trim() || null
}
