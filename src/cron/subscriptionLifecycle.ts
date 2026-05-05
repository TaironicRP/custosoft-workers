// src/cron/subscriptionLifecycle.ts
// Täglich ausgeführt: Abgelaufene Subscriptions deaktivieren + Ablauf-Warnungen senden.

import type { Env } from '../types'
import {
  sendEmail,
  subscriptionExpiringSoonHtml,
  subscriptionExpiringSoonText,
  subscriptionEndedHtml,
  subscriptionEndedText,
} from '../utils/email'

export async function runSubscriptionLifecycle(env: Env): Promise<void> {
  const db   = env.DB
  const now  = new Date().toISOString()
  const in3d = new Date(Date.now() + 3 * 24 * 60 * 60_000).toISOString()

  let expiredCount = 0
  let warnedCount  = 0

  // ── 1. Abgelaufene Subscriptions deaktivieren ─────────────────────────────
  const expired = await db.prepare(`
    SELECT ue.id, ue.user_id, ue.product, ue.expires_at,
           u.email, u.first_name, u.last_name
    FROM user_extensions ue
    JOIN users u ON u.id = ue.user_id
    WHERE ue.is_active = 1 AND ue.expires_at IS NOT NULL AND ue.expires_at < ?
  `).bind(now).all<any>()

  for (const row of expired.results ?? []) {
    // Deaktivieren
    await db.prepare(`UPDATE user_extensions SET is_active = 0 WHERE id = ?`)
      .bind(row.id).run()

    // Duplikat-Check: gleiche Notification schon in letzten 48 h?
    const dup = await db.prepare(`
      SELECT id FROM subscription_notifications
      WHERE user_id = ? AND type = 'SubscriptionExpired' AND ref_id = ?
        AND created_at > datetime('now', '-48 hours')
    `).bind(row.user_id, String(row.id)).first()
    if (dup) continue

    // In-App Notification
    const productName = String(row.product)
    await db.prepare(`
      INSERT INTO subscription_notifications (user_id, title, body, type, ref_id)
      VALUES (?, ?, ?, 'SubscriptionExpired', ?)
    `).bind(
      row.user_id,
      `Abo abgelaufen: ${productName}`,
      `Dein Zugang für ${productName} ist abgelaufen. Erneut abonnieren im Shop.`,
      String(row.id),
    ).run()

    // E-Mail
    try {
      const name = `${row.first_name ?? ''} ${row.last_name ?? ''}`.trim() || row.email
      await sendEmail({
        to:       row.email,
        toName:   name,
        subject:  `Dein ${productName}-Abo ist abgelaufen`,
        text:     subscriptionEndedText(name, productName, row.expires_at),
        html:     subscriptionEndedHtml(name, productName, row.expires_at),
        from:     env.FROM_EMAIL,
        fromName: env.FROM_NAME,
        apiKey:   env.RESEND_API_KEY,
      })
    } catch (err) {
      console.error(`[subscriptionLifecycle] E-Mail (expired) fehlgeschlagen für user ${row.user_id}:`, err)
    }

    expiredCount++
  }

  // ── 2. Bald ablaufende Subscriptions warnen (innerhalb 3 Tage) ───────────
  const expiringSoon = await db.prepare(`
    SELECT ue.id, ue.user_id, ue.product, ue.expires_at,
           u.email, u.first_name, u.last_name
    FROM user_extensions ue
    JOIN users u ON u.id = ue.user_id
    WHERE ue.is_active = 1 AND ue.expires_at IS NOT NULL
      AND ue.expires_at > ? AND ue.expires_at < ?
  `).bind(now, in3d).all<any>()

  for (const row of expiringSoon.results ?? []) {
    // Duplikat-Check: gleiche Warnung schon in letzten 24 h?
    const dup = await db.prepare(`
      SELECT id FROM subscription_notifications
      WHERE user_id = ? AND type = 'SubscriptionExpiringSoon' AND ref_id = ?
        AND created_at > datetime('now', '-24 hours')
    `).bind(row.user_id, String(row.id)).first()
    if (dup) continue

    const productName = String(row.product)
    const expiresAt   = new Date(row.expires_at)
    const daysLeft    = Math.max(0, Math.ceil((expiresAt.getTime() - Date.now()) / (24 * 60 * 60_000)))

    await db.prepare(`
      INSERT INTO subscription_notifications (user_id, title, body, type, ref_id)
      VALUES (?, ?, ?, 'SubscriptionExpiringSoon', ?)
    `).bind(
      row.user_id,
      `Abo läuft bald ab`,
      `Dein ${productName}-Abo läuft in ${daysLeft} Tag${daysLeft !== 1 ? 'en' : ''} ab.`,
      String(row.id),
    ).run()

    try {
      const name = `${row.first_name ?? ''} ${row.last_name ?? ''}`.trim() || row.email
      await sendEmail({
        to:       row.email,
        toName:   name,
        subject:  `Dein ${productName}-Abo läuft in ${daysLeft} Tagen ab`,
        text:     subscriptionExpiringSoonText(name, productName, daysLeft, row.expires_at),
        html:     subscriptionExpiringSoonHtml(name, productName, daysLeft, row.expires_at),
        from:     env.FROM_EMAIL,
        fromName: env.FROM_NAME,
        apiKey:   env.RESEND_API_KEY,
      })
    } catch (err) {
      console.error(`[subscriptionLifecycle] E-Mail (expiringSoon) fehlgeschlagen für user ${row.user_id}:`, err)
    }

    warnedCount++
  }

  console.log(`[subscriptionLifecycle] Erledigt — Abgelaufen: ${expiredCount}, Warnung gesendet: ${warnedCount}`)
}
