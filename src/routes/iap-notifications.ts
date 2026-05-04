// ── Apple App Store Server Notifications V2 — /api/v1/iap/notifications ──────
// Apple sendet hierhin signierte Events bei:
//   • SUBSCRIBED               (neu gekauft)
//   • DID_RENEW                (Renewal lief durch)
//   • EXPIRED                  (Abo ausgelaufen, kein Renewal)
//   • REFUND                   (User hat zurückerstattet bekommen)
//   • REVOKE                   (Family-Sharing entzogen)
//   • DID_FAIL_TO_RENEW        (Karte abgelaufen etc.)
//   • DID_CHANGE_RENEWAL_PREF  (Plan-Wechsel)
//
// URL muss in App Store Connect → App Information → App Store Server
// Notifications eingetragen sein:
//   Production:  https://api.custosoft.de/api/v1/iap/notifications
//   Sandbox:     https://api.custosoft.de/api/v1/iap/notifications/sandbox

import { Hono }            from 'hono'
import type { AppEnv, Env } from '../types'
import { verifyAppleJws }  from '../utils/apple-iap'

const iap = new Hono<AppEnv>()

interface SignedNotificationBody {
  signedPayload: string   // JWS containing notificationType + data
}

interface NotificationPayload {
  notificationType: string
  subtype?: string
  notificationUUID?: string
  data?: {
    appAppleId?: number
    bundleId?: string
    bundleVersion?: string
    environment?: 'Sandbox' | 'Production'
    signedTransactionInfo?: string
    signedRenewalInfo?: string
  }
  version?: string
  signedDate?: number
}

function expectedBundleId(env: Env): string {
  return env.APPLE_CLIENT_ID || 'com.taironic.custosoft'
}

/** Mark einen User-Extension-Datensatz als inaktiv (refund/revoke/expired). */
async function deactivateByTransactionId(env: Env, txId: string, reason: string) {
  await env.DB.prepare(
    `UPDATE user_extensions
        SET is_active = 0, expires_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
      WHERE apple_transaction_id = ?`
  ).bind(txId).run()
  console.log(`[iap] Deactivated tx=${txId} reason=${reason}`)
}

/** Verlängere das ExpiresAt eines bestehenden Abos. */
async function extendByTransactionId(env: Env, txId: string, expiresAtMs: number) {
  const expiresIso = new Date(expiresAtMs).toISOString()
  await env.DB.prepare(
    `UPDATE user_extensions
        SET is_active = 1, expires_at = ?
      WHERE apple_transaction_id = ?`
  ).bind(expiresIso, txId).run()
  console.log(`[iap] Extended tx=${txId} until ${expiresIso}`)
}

async function handleNotification(env: Env, body: SignedNotificationBody): Promise<{ ok: boolean; status?: number; error?: string }> {
  if (!body.signedPayload) return { ok: false, status: 400, error: 'signedPayload missing' }

  // 1) Outer JWS verifizieren — enthält notificationType + signedTransactionInfo
  const outer = await verifyAppleJws(body.signedPayload, expectedBundleId(env))
  if (!outer.ok) return { ok: false, status: 400, error: `outer JWS: ${outer.error}` }

  const notif = outer.payload as unknown as NotificationPayload
  const type     = notif.notificationType
  const subtype  = notif.subtype
  const txInfoJws = notif.data?.signedTransactionInfo

  console.log(`[iap] notification type=${type} subtype=${subtype ?? '-'} env=${notif.data?.environment ?? '-'}`)

  if (!txInfoJws) {
    return { ok: true }   // Manche Test-Pings haben keinen TX. Nicht failen.
  }

  // 2) Inner JWS verifizieren — enthält originalTransactionId, expiresDate, etc.
  const inner = await verifyAppleJws(txInfoJws, expectedBundleId(env))
  if (!inner.ok) return { ok: false, status: 400, error: `inner JWS: ${inner.error}` }

  const tx = inner.payload
  const txId = tx.transactionId ?? tx.originalTransactionId
  if (!txId) return { ok: true }   // nichts zu tun

  // 3) Anhand notificationType handeln
  switch (type) {
    case 'SUBSCRIBED':
    case 'DID_RENEW':
    case 'OFFER_REDEEMED':
      if (tx.expiresDate) await extendByTransactionId(env, txId, tx.expiresDate)
      break

    case 'DID_CHANGE_RENEWAL_PREF':
    case 'DID_CHANGE_RENEWAL_STATUS':
      // Keine Aktion auf user_extensions — Apple verlängert oder nicht.
      // Renewal-Status nur loggen.
      break

    case 'EXPIRED':
    case 'GRACE_PERIOD_EXPIRED':
    case 'DID_FAIL_TO_RENEW':
      await deactivateByTransactionId(env, txId, type)
      break

    case 'REFUND':
    case 'REVOKE':
    case 'CONSUMPTION_REQUEST':
      await deactivateByTransactionId(env, txId, type)
      break

    case 'TEST':
      console.log('[iap] TEST notification — ok')
      break

    default:
      console.log(`[iap] Unhandled notification type=${type}`)
  }

  return { ok: true }
}

// Production
iap.post('/notifications', async (c) => {
  const body = await c.req.json<SignedNotificationBody>().catch(() => null)
  if (!body) return c.json({ error: 'invalid body' }, 400)
  const result = await handleNotification(c.env, body)
  if (!result.ok) return c.json({ error: result.error }, (result.status as 400 | 500) ?? 400)
  return c.json({ ok: true })
})

// Sandbox (gleiche Logik, eigene URL nur damit Apple beide getrennt eintragen kann)
iap.post('/notifications/sandbox', async (c) => {
  const body = await c.req.json<SignedNotificationBody>().catch(() => null)
  if (!body) return c.json({ error: 'invalid body' }, 400)
  const result = await handleNotification(c.env, body)
  if (!result.ok) return c.json({ error: result.error }, (result.status as 400 | 500) ?? 400)
  return c.json({ ok: true })
})

// Health-Probe (ASC pingt manchmal mit GET)
iap.get('/notifications', (c) => c.json({ ok: true, endpoint: 'apple-iap-notifications-v2' }))

export default iap
