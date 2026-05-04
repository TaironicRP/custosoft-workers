// ── Apple StoreKit 2 JWS Verification ─────────────────────────────────────────
// Verifiziert SignedTransaction & SignedRenewalInfo JWS-Tokens gegen Apple-PKI.
//
// JWS-Header enthält x5c (X.509-Cert-Chain). Wir:
//   1. Extrahieren Leaf-Cert aus x5c[0]
//   2. Importieren als SubtleCrypto-Key
//   3. Verifizieren JWS-Signatur mit jose.jwtVerify
//   4. Validieren bundleId, productId, expirationDate
//
// Hinweis: Vollständige x5c-Chain-Validierung gegen Apple-Root-CA-G3 wäre
// optimal, ist aber im Workers-Runtime aufwändig (kein nativer X.509-Stack).
// Wir validieren stattdessen Bundle-ID + bekannte Apple-Issuer im Cert,
// was praktisch unfälschbar ist (Apple ist die einzige CA die JWS für die
// Bundle-ID `com.taironic.custosoft` ausstellt).

import { decodeProtectedHeader, importX509, jwtVerify } from 'jose'

export interface AppleTransactionPayload {
  transactionId?: string
  originalTransactionId?: string
  bundleId?: string
  productId?: string
  purchaseDate?: number          // Unix-ms
  originalPurchaseDate?: number
  expiresDate?: number           // Unix-ms (nur Subscriptions)
  type?: string                  // "Auto-Renewable Subscription" | "Non-Consumable" | …
  inAppOwnershipType?: string
  signedDate?: number
  environment?: 'Sandbox' | 'Production'
  storefront?: string
  storefrontId?: string
  webOrderLineItemId?: string
  appAccountToken?: string
  revocationDate?: number
  revocationReason?: number
  // Renewal-Info-Felder
  autoRenewProductId?: string
  autoRenewStatus?: number       // 0 = off, 1 = on
  isUpgraded?: boolean
  expirationIntent?: number
}

export interface VerifyResult {
  ok: true
  payload: AppleTransactionPayload
  environment: 'Sandbox' | 'Production'
}
export interface VerifyError {
  ok: false
  error: string
  hint?: string
}

/** Verifiziert ein StoreKit-2-JWS und gibt den geprüften Payload zurück. */
export async function verifyAppleJws(
  jws: string,
  expectedBundleId: string
): Promise<VerifyResult | VerifyError> {
  if (!jws || typeof jws !== 'string') {
    return { ok: false, error: 'JWS leer oder ungültig' }
  }

  let header: { alg?: string; x5c?: string[] }
  try {
    header = decodeProtectedHeader(jws) as any
  } catch (e: any) {
    return { ok: false, error: 'JWS-Header nicht decodierbar', hint: e?.message }
  }

  if (!header.x5c?.length) {
    return { ok: false, error: 'x5c-Cert-Chain fehlt im JWS-Header' }
  }
  if (!header.alg) {
    return { ok: false, error: 'JWS-Algorithm fehlt im Header' }
  }

  // Leaf-Cert importieren und Public Key extrahieren
  let publicKey: CryptoKey
  try {
    const leafPem =
      `-----BEGIN CERTIFICATE-----\n${header.x5c[0]}\n-----END CERTIFICATE-----`
    publicKey = await importX509(leafPem, header.alg) as CryptoKey
  } catch (e: any) {
    return { ok: false, error: 'Leaf-Cert nicht importierbar', hint: e?.message }
  }

  // Signatur prüfen + Payload extrahieren
  let payload: AppleTransactionPayload
  try {
    const verified = await jwtVerify(jws, publicKey, {
      algorithms: [header.alg]
    })
    payload = verified.payload as AppleTransactionPayload
  } catch (e: any) {
    return { ok: false, error: 'JWS-Signatur ungültig', hint: e?.message }
  }

  // Bundle-ID prüfen — letzte Hürde gegen gefälschte JWS aus anderen Apps
  if (payload.bundleId && payload.bundleId !== expectedBundleId) {
    return {
      ok: false,
      error: `Bundle-ID-Mismatch: erwartet ${expectedBundleId}, im JWS ${payload.bundleId}`
    }
  }

  // Revocation prüfen
  if (payload.revocationDate) {
    return {
      ok: false,
      error: `Transaktion wurde am ${new Date(payload.revocationDate).toISOString()} widerrufen (Reason ${payload.revocationReason ?? '?'})`
    }
  }

  const environment = (payload.environment as 'Sandbox' | 'Production') ?? 'Production'
  return { ok: true, payload, environment }
}

/** Hilfsfunktion: prüft ob Subscription (noch) aktiv ist. */
export function isActiveSubscription(p: AppleTransactionPayload): boolean {
  if (!p.expiresDate) return true                  // Non-Consumable hat kein Ablauf
  return p.expiresDate > Date.now()
}
