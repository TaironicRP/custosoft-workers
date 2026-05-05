// ─────────────────────────────────────────────────────────────────────────────
// i18n — Default legal page bodies (Impressum, Datenschutz, AGB, Widerruf)
// ─────────────────────────────────────────────────────────────────────────────
//
// These are HTML fragments returned from the routes when the D1 `legal_pages`
// table has no entry for that slug. The Admin panel can override them — but
// the per-locale defaults below ship with every deploy.
//
// Adding a locale: implement each function for the new code in `Locale`.
// TypeScript will refuse to compile until you do.
// ─────────────────────────────────────────────────────────────────────────────

import type { Locale } from './locales'

/** Maps legal slug → human title shown in the page <h1> per locale. */
export const LEGAL_TITLES: Record<string, Record<Locale, string>> = {
  impressum:    { de: 'Impressum',         en: 'Imprint' },
  datenschutz:  { de: 'Datenschutzerklärung', en: 'Privacy Policy' },
  agb:          { de: 'AGB',               en: 'Terms of Service' },
  widerruf:     { de: 'Widerrufsbelehrung', en: 'Right of Withdrawal' },
}

/** Slug → URL path segment per locale (so /en/imprint vs /de/impressum). */
export const LEGAL_SLUGS: Record<Locale, Record<string, string>> = {
  de: {
    impressum:   'impressum',
    datenschutz: 'datenschutz',
    agb:         'agb',
    widerruf:    'widerruf',
  },
  en: {
    impressum:   'imprint',
    datenschutz: 'privacy',
    agb:         'terms',
    widerruf:    'withdrawal',
  },
}

/** Reverse-lookup: localized slug → canonical slug. */
export function canonicalSlug(localeSlug: string, locale: Locale): string | null {
  for (const [canon, loc] of Object.entries(LEGAL_SLUGS[locale])) {
    if (loc === localeSlug) return canon
  }
  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// IMPRESSUM
// (Stays German per § 5 TMG — German legal text. EN provides translation.)
// ─────────────────────────────────────────────────────────────────────────────

export function defaultImpressum(locale: Locale): string {
  return locale === 'en' ? impressumEn() : impressumDe()
}

function impressumDe(): string {
  return `
<h2>Angaben gemäß § 5 TMG</h2>
<p><strong>David Schrödinger</strong><br>
CustoSoft<br>
Badstubweg 3<br>
87487 Wiggensbach<br>
Deutschland</p>

<h2>Kontakt</h2>
<p>E-Mail: <a href="mailto:custosoftsupportde@gmail.com">custosoftsupportde@gmail.com</a><br>
Web: <a href="https://api.custosoft.de">api.custosoft.de</a></p>

<h2>Umsatzsteuer</h2>
<p>Gemäß § 19 UStG wird keine Umsatzsteuer berechnet (Kleinunternehmerregelung).</p>

<h2>Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV</h2>
<p>David Schrödinger, Anschrift wie oben.</p>

<h2>Streitschlichtung</h2>
<p>Die Europäische Kommission stellt eine Plattform zur Online-Streitbeilegung (OS) bereit:
<a href="https://ec.europa.eu/consumers/odr" target="_blank" rel="noopener">https://ec.europa.eu/consumers/odr</a>.<br>
Wir sind nicht bereit und nicht verpflichtet, an einem Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen.</p>

<h2>Haftung für Inhalte</h2>
<p>Als Diensteanbieter sind wir für eigene Inhalte auf diesen Seiten nach den allgemeinen Gesetzen verantwortlich (§ 7 Abs.1 TMG). Wir sind jedoch nicht verpflichtet, übermittelte oder gespeicherte fremde Informationen zu überwachen oder nach Umständen zu forschen, die auf eine rechtswidrige Tätigkeit hinweisen (§§ 8–10 TMG). Eine diesbezügliche Haftung ist jedoch erst ab dem Zeitpunkt der Kenntnis einer konkreten Rechtsverletzung möglich.</p>

<h2>Haftung für Links</h2>
<p>Unser Angebot enthält Links zu externen Websites Dritter, auf deren Inhalte wir keinen Einfluss haben. Deshalb können wir für diese fremden Inhalte auch keine Gewähr übernehmen. Rechtswidrige Inhalte waren zum Zeitpunkt der Verlinkung nicht erkennbar.</p>

<h2>Urheberrecht</h2>
<p>Die durch den Seitenbetreiber erstellten Inhalte auf diesen Seiten unterliegen dem deutschen Urheberrecht. Die Vervielfältigung, Bearbeitung, Verbreitung und jede Art der Verwertung außerhalb der Grenzen des Urheberrechtes bedürfen der schriftlichen Zustimmung des jeweiligen Autors.</p>`
}

function impressumEn(): string {
  return `
<p style="background:rgba(255,180,80,0.08);border:1px solid rgba(255,180,80,0.25);border-radius:10px;padding:14px 18px;font-size:13px;color:rgba(255,255,255,0.7);margin-bottom:24px">
<strong>Note:</strong> The legally binding version of this imprint is the German one (§ 5 TMG, German Telemedia Act). The translation below is provided for convenience.
<a href="/de/impressum" style="color:#7790ff">View German version</a>.</p>

<h2>Information pursuant to § 5 of the German Telemedia Act (TMG)</h2>
<p><strong>David Schrödinger</strong><br>
CustoSoft<br>
Badstubweg 3<br>
87487 Wiggensbach<br>
Germany</p>

<h2>Contact</h2>
<p>Email: <a href="mailto:custosoftsupportde@gmail.com">custosoftsupportde@gmail.com</a><br>
Web: <a href="https://api.custosoft.de">api.custosoft.de</a></p>

<h2>Sales tax</h2>
<p>No VAT is charged in accordance with § 19 of the German VAT Act (small-business rule).</p>

<h2>Responsible for content according to § 18(2) MStV</h2>
<p>David Schrödinger, address as above.</p>

<h2>EU online dispute resolution</h2>
<p>The European Commission provides a platform for online dispute resolution (ODR):
<a href="https://ec.europa.eu/consumers/odr" target="_blank" rel="noopener">https://ec.europa.eu/consumers/odr</a>.<br>
We are neither willing nor obliged to participate in dispute resolution proceedings before a consumer arbitration board.</p>

<h2>Liability for content</h2>
<p>As a service provider, we are responsible under general laws for our own content on these pages (§ 7(1) TMG). However, we are not obliged to monitor transmitted or stored third-party information or to investigate circumstances that indicate illegal activity (§§ 8–10 TMG). Liability in this regard is only possible from the point in time at which we become aware of a specific infringement.</p>

<h2>Liability for links</h2>
<p>Our offer contains links to external third-party websites whose content we cannot influence. We therefore cannot accept any liability for such third-party content. Illegal content was not identifiable at the time the link was created.</p>

<h2>Copyright</h2>
<p>The content on these pages created by the site operator is subject to German copyright law. Duplication, processing, distribution, and any form of exploitation beyond the limits of copyright require the written consent of the respective author.</p>`
}

// ─────────────────────────────────────────────────────────────────────────────
// DATENSCHUTZ / PRIVACY POLICY
// ─────────────────────────────────────────────────────────────────────────────

export function defaultDatenschutz(locale: Locale): string {
  return locale === 'en' ? datenschutzEn() : datenschutzDe()
}

function datenschutzDe(): string {
  return `
<h2>1. Verantwortlicher</h2>
<p>Verantwortlicher für die Datenverarbeitung im Sinne der DSGVO ist:<br>
<strong>David Schrödinger</strong> · CustoSoft<br>
Badstubweg 3 · 87487 Wiggensbach<br>
E-Mail: <a href="mailto:custosoftsupportde@gmail.com">custosoftsupportde@gmail.com</a></p>

<h2>2. Welche Daten wir verarbeiten</h2>
<p>Bei Nutzung der CustoSoft-App verarbeiten wir folgende Daten:</p>
<ul>
  <li><strong>Account-Daten:</strong> E-Mail-Adresse, Vor- und Nachname, optional Profilbild</li>
  <li><strong>Anmelde-Daten:</strong> Passwort-Hash (PBKDF2-SHA256), JWT-Token, letzter Login-Zeitstempel</li>
  <li><strong>Organisations-Daten:</strong> Name, Mitglieder, Rollen, Berechtigungen</li>
  <li><strong>Stempel-Daten:</strong> Ein-/Aus-Stempel-Zeiten, Pausen, optionale Notizen</li>
  <li><strong>Akten-Daten:</strong> Vom Nutzer angelegte Mitarbeiterakten, Dokumente</li>
  <li><strong>Chat-Daten:</strong> Nachrichten, Anhänge (verschlüsselt im Cloudflare R2 Storage)</li>
  <li><strong>Zahlungsdaten:</strong> Zahlungsabwicklung erfolgt vollständig über Apple — wir erhalten nur Transaction-IDs</li>
</ul>

<h2>3. Wo deine Daten gespeichert sind</h2>
<p>Alle Daten liegen auf Servern von <strong>Cloudflare</strong> (D1 Database, R2 Object Storage) in der Region Europa. Cloudflare ist nach DSGVO Auftragsverarbeiter. Es gibt keinen Datentransfer in Drittländer ohne Angemessenheitsbeschluss.</p>

<h2>4. Rechtsgrundlage</h2>
<p>Die Verarbeitung erfolgt zur Vertragserfüllung (Art. 6 Abs. 1 lit. b DSGVO) und ggf. zur Wahrung berechtigter Interessen (Art. 6 Abs. 1 lit. f DSGVO).</p>

<h2>5. Deine Rechte</h2>
<p>Du hast das Recht auf:</p>
<ul>
  <li>Auskunft (Art. 15 DSGVO)</li>
  <li>Berichtigung (Art. 16 DSGVO)</li>
  <li><strong>Löschung</strong> (Art. 17 DSGVO) — direkt in der App: Profil → Konto löschen</li>
  <li>Einschränkung der Verarbeitung (Art. 18 DSGVO)</li>
  <li>Datenübertragbarkeit (Art. 20 DSGVO)</li>
  <li>Widerspruch (Art. 21 DSGVO)</li>
</ul>

<h2>6. Speicherdauer</h2>
<p>Wir speichern deine Daten so lange dein Account aktiv ist. Nach Konto-Löschung werden alle persönlichen Daten innerhalb von 30 Tagen unwiderruflich gelöscht.</p>

<h2>7. Push-Notifications & Tracking</h2>
<p>Wir senden Push-Notifications nur für transaktionale Zwecke (z.B. neue Chat-Nachrichten). Wir nutzen <strong>kein Werbe-Tracking</strong>, keine Drittanbieter-Analytics, keine IDFA.</p>

<h2>8. Drittanbieter-Dienste</h2>
<p>Wir nutzen folgende Drittanbieter für den Betrieb:</p>
<ul>
  <li><strong>Cloudflare</strong> (EU-Region Frankfurt) — Edge-Hosting, D1-Datenbank, R2-Objektspeicher. Cloudflare ist nach DSGVO Auftragsverarbeiter. Angemessenheitsbeschluss EU-US Data Privacy Framework vorhanden.</li>
  <li><strong>Resend</strong> — transaktionale E-Mails (Kaufbestätigung, Passwort-Reset). Keine Marketingmails.</li>
  <li><strong>Apple</strong> — Zahlungsabwicklung für In-App-Käufe. Wir erhalten ausschließlich anonymisierte Transaction-IDs, keine Zahlungsdaten.</li>
</ul>

<h2>9. Beschwerderecht</h2>
<p>Du hast das Recht, dich bei einer Datenschutz-Aufsichtsbehörde zu beschweren. Zuständig für Bayern ist das Bayerische Landesamt für Datenschutzaufsicht (BayLDA), Postfach 606, 91511 Ansbach, <a href="https://www.lda.bayern.de" target="_blank" rel="noopener">www.lda.bayern.de</a>.</p>

<p><em>Stand: 04.05.2026</em></p>`
}

function datenschutzEn(): string {
  return `
<h2>1. Data Controller</h2>
<p>The data controller within the meaning of the GDPR is:<br>
<strong>David Schrödinger</strong> · CustoSoft<br>
Badstubweg 3 · 87487 Wiggensbach · Germany<br>
Email: <a href="mailto:custosoftsupportde@gmail.com">custosoftsupportde@gmail.com</a></p>

<h2>2. What data we process</h2>
<p>When you use the CustoSoft app, we process the following data:</p>
<ul>
  <li><strong>Account data:</strong> email address, first and last name, optional profile picture</li>
  <li><strong>Sign-in data:</strong> password hash (PBKDF2-SHA256), JWT token, last-login timestamp</li>
  <li><strong>Organisation data:</strong> name, members, roles, permissions</li>
  <li><strong>Punch data:</strong> clock-in/out times, breaks, optional notes</li>
  <li><strong>Files data:</strong> employee records and documents you create</li>
  <li><strong>Chat data:</strong> messages and attachments (encrypted in Cloudflare R2 storage)</li>
  <li><strong>Payment data:</strong> all payments are processed by Apple — we receive only anonymised transaction IDs</li>
</ul>

<h2>3. Where your data is stored</h2>
<p>All data is hosted by <strong>Cloudflare</strong> (D1 database, R2 object storage) in the European region. Cloudflare is a data processor under GDPR. No data is transferred to third countries without an adequacy decision.</p>

<h2>4. Legal basis</h2>
<p>Processing is performed to fulfil our contract with you (Art. 6(1)(b) GDPR) and, where applicable, on the basis of legitimate interests (Art. 6(1)(f) GDPR).</p>

<h2>5. Your rights</h2>
<p>You have the right to:</p>
<ul>
  <li>access (Art. 15 GDPR)</li>
  <li>rectification (Art. 16 GDPR)</li>
  <li><strong>erasure</strong> (Art. 17 GDPR) — directly in the app: Profile → Delete account</li>
  <li>restriction of processing (Art. 18 GDPR)</li>
  <li>data portability (Art. 20 GDPR)</li>
  <li>object (Art. 21 GDPR)</li>
</ul>

<h2>6. Retention period</h2>
<p>We store your data for as long as your account is active. After account deletion, all personal data is irreversibly removed within 30 days.</p>

<h2>7. Push notifications & tracking</h2>
<p>We send push notifications only for transactional purposes (e.g. new chat messages). We use <strong>no ad tracking</strong>, no third-party analytics, and no IDFA.</p>

<h2>8. Third-party services</h2>
<p>We use the following third-party services to operate CustoSoft:</p>
<ul>
  <li><strong>Cloudflare</strong> (EU Frankfurt region) — edge hosting, D1 database, R2 object storage. Cloudflare is a GDPR data processor. EU-US Data Privacy Framework adequacy decision in place.</li>
  <li><strong>Resend</strong> — transactional emails (purchase confirmation, password reset). No marketing emails.</li>
  <li><strong>Apple</strong> — payment processing for in-app purchases. We receive only anonymised transaction IDs, no payment details.</li>
</ul>

<h2>9. Right to lodge a complaint</h2>
<p>You have the right to lodge a complaint with a data protection supervisory authority. The competent authority for Bavaria is the Bavarian State Office for Data Protection Supervision (BayLDA), Postfach 606, 91511 Ansbach, <a href="https://www.lda.bayern.de" target="_blank" rel="noopener">www.lda.bayern.de</a>.</p>

<p><em>Last updated: 4 May 2026</em></p>`
}

// ─────────────────────────────────────────────────────────────────────────────
// AGB / TERMS OF SERVICE
// ─────────────────────────────────────────────────────────────────────────────

export function defaultAGB(locale: Locale): string {
  return locale === 'en' ? agbEn() : agbDe()
}

function agbDe(): string {
  return `
<h2>1. Geltungsbereich und Anbieter</h2>
<p>Diese Allgemeinen Geschäftsbedingungen (AGB) gelten für alle Verträge zwischen</p>
<p><strong>David Schrödinger</strong> · CustoSoft<br>
Badstubweg 3 · 87487 Wiggensbach<br>
E-Mail: <a href="mailto:custosoftsupportde@gmail.com">custosoftsupportde@gmail.com</a></p>
<p>und Nutzern der iOS/iPadOS/macOS-App „CustoSoft" (nachfolgend „App").</p>

<h2>2. Vertragsschluss</h2>
<p>Die App kann kostenlos aus dem Apple App Store geladen werden. Kostenpflichtige Funktionen (In-App-Käufe und Abonnements) werden ausschließlich über den Apple App Store abgerechnet. Mit dem Kauf im App Store kommt der Kaufvertrag direkt zwischen dem Nutzer und Apple Inc. gemäß den Apple Media Services-Nutzungsbedingungen zustande. CustoSoft erbringt die gebuchte digitale Leistung (Freischaltung der Funktion) unverzüglich nach Bestätigung durch Apple.</p>

<h2>3. Leistungsumfang</h2>
<p>CustoSoft bietet folgende Funktionen — teils kostenlos, teils kostenpflichtig:</p>
<ul>
  <li><strong>Stempeluhr</strong>: Digitale Zeiterfassung, Pausen, Wochen-Statistik, Dynamic-Island-Live-Anzeige, CSV-Export</li>
  <li><strong>Wand-Stempeluhr</strong>: iPad im Kiosk-Modus, persönlicher PIN-Code für Mitarbeiter</li>
  <li><strong>Bewerbungsmanager</strong>: Erstellung von Bewerbungs-Links, Verwaltung eingehender Bewerbungen</li>
  <li><strong>Business Basic</strong>: Organisations-Verwaltung bis 10 Mitarbeiter-Slots inkl. Akten, Chat, Lohnauswertung</li>
  <li><strong>Business L</strong>: Wie Business Basic, bis 50 Mitarbeiter-Slots</li>
</ul>
<p>Der Anbieter behält sich vor, den Leistungsumfang im Rahmen technischer Weiterentwicklungen anzupassen, sofern dies dem Nutzer zumutbar ist.</p>

<h2>4. Preise und Zahlung</h2>
<p>Alle Preise werden im App Store in EUR angezeigt. Da der Anbieter Kleinunternehmer gemäß § 19 UStG ist, wird keine Mehrwertsteuer ausgewiesen. Die Abwicklung erfolgt vollständig über Apple; der Anbieter erhält keine Zahlungsdaten.</p>
<ul>
  <li><strong>Stempeluhr</strong>: 2,99 € pro Woche (Wochen-Abo, jederzeit kündbar)</li>
  <li><strong>Mehr Platz</strong>: 4,99 € einmalig (Dauerlizenz)</li>
  <li><strong>Bewerbungsmanager</strong>: 9,99 € einmalig (Dauerlizenz)</li>
  <li><strong>Wand-Stempeluhr</strong>: 14,99 € einmalig (Dauerlizenz)</li>
  <li><strong>Business Basic</strong>: 49,00 €/Monat oder 469,00 €/Jahr (ca. 39,08 €/Monat)</li>
  <li><strong>Business L</strong>: 89,00 €/Monat oder 849,00 €/Jahr (ca. 70,75 €/Monat)</li>
</ul>

<h2>5. Abonnements und automatische Verlängerung</h2>
<p>Abonnements verlängern sich automatisch um den jeweiligen Zeitraum, sofern sie nicht spätestens 24 Stunden vor Ablauf des laufenden Zeitraums gekündigt werden. Kündigung und Verwaltung sind ausschließlich über iPhone-/iPad-Einstellungen → Apple-ID → Abonnements möglich.</p>

<h2>6. Org-Lizenzvererbung</h2>
<p>Inhaber einer Business-Lizenz können Mitarbeiter in eine Organisation einladen. Eingeladene Mitglieder erhalten während ihrer aktiven Mitgliedschaft automatisch Zugang zu den vom Organisations-Inhaber lizenzierten Funktionen. Mit dem Verlassen oder Ausschluss aus der Organisation erlischt dieser abgeleitete Zugang sofort. Die Mitgliedschaft begründet keinen eigenständigen Lizenzanspruch.</p>

<h2>7. Widerruf bei digitalen Inhalten</h2>
<p>Verbraucher haben grundsätzlich ein 14-tägiges Widerrufsrecht. Da die Freischaltung digitaler Inhalte unmittelbar nach dem Kauf beginnt, erlischt das Widerrufsrecht mit Beginn der Ausführung, sofern der Nutzer vor dem Kauf ausdrücklich zugestimmt hat (§ 356 Abs. 5 BGB). Refunds können direkt bei Apple über <a href="https://reportaproblem.apple.com" target="_blank" rel="noopener">reportaproblem.apple.com</a> beantragt werden. Details: <a href="/de/widerruf">Widerrufsbelehrung</a>.</p>

<h2>8. Verfügbarkeit</h2>
<p>Der Anbieter strebt eine hohe Verfügbarkeit an, übernimmt jedoch keine Gewähr für eine ununterbrochene Erreichbarkeit. Geplante Wartungen werden nach Möglichkeit angekündigt.</p>

<h2>9. Nutzerpflichten</h2>
<p>Der Nutzer verpflichtet sich, die App nicht für rechtswidrige Zwecke zu verwenden, keine automatisierten Massenzugriffe (Scraping, Bots) durchzuführen und Zugangsdaten sicher zu verwahren.</p>

<h2>10. Haftungsbeschränkung</h2>
<p>Der Anbieter haftet unbeschränkt für Vorsatz und grobe Fahrlässigkeit sowie bei Verletzung von Leben, Körper und Gesundheit. Bei leichter Fahrlässigkeit haftet der Anbieter nur bei Verletzung wesentlicher Vertragspflichten, begrenzt auf den typischerweise vorhersehbaren Schaden. Eine weitergehende Haftung ist ausgeschlossen.</p>

<h2>11. Datenschutz</h2>
<p>Informationen zur Verarbeitung personenbezogener Daten finden sich in unserer <a href="/de/datenschutz">Datenschutzerklärung</a>.</p>

<h2>12. Änderungen der AGB</h2>
<p>Der Anbieter behält sich vor, diese AGB mit einer Vorankündigungsfrist von mindestens 30 Tagen (per E-Mail oder In-App-Hinweis) zu ändern. Widerspricht der Nutzer nicht innerhalb dieser Frist, gelten die geänderten AGB als angenommen.</p>

<h2>13. Anwendbares Recht und Gerichtsstand</h2>
<p>Es gilt das Recht der Bundesrepublik Deutschland unter Ausschluss des UN-Kaufrechts (CISG). Für Verbraucher mit Wohnsitz in der EU gilt vorrangig das zwingende Verbraucherschutzrecht des Wohnsitzstaates.</p>

<p><em>Stand: 04.05.2026</em></p>`
}

function agbEn(): string {
  return `
<p style="background:rgba(255,180,80,0.08);border:1px solid rgba(255,180,80,0.25);border-radius:10px;padding:14px 18px;font-size:13px;color:rgba(255,255,255,0.7);margin-bottom:24px">
<strong>Note:</strong> The German version of these terms is the legally binding one (governed by German law). The translation below is provided for convenience.
<a href="/de/agb" style="color:#7790ff">View German version</a>.</p>

<h2>1. Scope and provider</h2>
<p>These Terms of Service apply to all contracts between</p>
<p><strong>David Schrödinger</strong> · CustoSoft<br>
Badstubweg 3 · 87487 Wiggensbach · Germany<br>
Email: <a href="mailto:custosoftsupportde@gmail.com">custosoftsupportde@gmail.com</a></p>
<p>and users of the iOS/iPadOS/macOS app "CustoSoft" (the "App").</p>

<h2>2. Conclusion of contract</h2>
<p>The App can be downloaded free of charge from the Apple App Store. Paid features (in-app purchases and subscriptions) are billed exclusively through the Apple App Store. By making a purchase in the App Store, the contract is concluded directly between the user and Apple Inc. under the Apple Media Services Terms and Conditions. CustoSoft delivers the booked digital service (feature unlock) immediately after Apple confirms the purchase.</p>

<h2>3. Scope of services</h2>
<p>CustoSoft offers the following features — partly free, partly paid:</p>
<ul>
  <li><strong>Punch clock:</strong> digital time tracking, breaks, weekly stats, Dynamic Island live display, CSV export</li>
  <li><strong>Wall punch clock:</strong> iPad in kiosk mode, personal PIN code for employees</li>
  <li><strong>Recruitment manager:</strong> create job links, manage incoming applications</li>
  <li><strong>Business Basic:</strong> organisation management with up to 10 employee slots including files, chat, payroll analysis</li>
  <li><strong>Business L:</strong> like Business Basic, up to 50 employee slots</li>
</ul>
<p>The provider reserves the right to adapt the scope of services as part of technical further development, provided this is reasonable for the user.</p>

<h2>4. Prices and payment</h2>
<p>All prices are shown in the App Store in EUR. Since the provider is a small business under § 19 of the German VAT Act, no VAT is shown. Payments are processed entirely by Apple; the provider receives no payment details.</p>
<ul>
  <li><strong>Punch clock:</strong> €2.99 per week (weekly subscription, cancel anytime)</li>
  <li><strong>More space:</strong> €4.99 one-time (lifetime license)</li>
  <li><strong>Recruitment manager:</strong> €9.99 one-time (lifetime license)</li>
  <li><strong>Wall punch clock:</strong> €14.99 one-time (lifetime license)</li>
  <li><strong>Business Basic:</strong> €49.00/month or €469.00/year (≈ €39.08/month)</li>
  <li><strong>Business L:</strong> €89.00/month or €849.00/year (≈ €70.75/month)</li>
</ul>

<h2>5. Subscriptions and auto-renewal</h2>
<p>Subscriptions renew automatically for the same period unless cancelled at least 24 hours before the end of the current period. Cancellation and management are only possible via iPhone/iPad Settings → Apple ID → Subscriptions.</p>

<h2>6. Organisation license inheritance</h2>
<p>Owners of a Business license can invite employees into an organisation. Invited members automatically receive access, during their active membership, to the features licensed by the organisation owner. When leaving or being removed from the organisation, this derived access immediately ends. Membership does not establish an independent license claim.</p>

<h2>7. Right of withdrawal for digital content</h2>
<p>Consumers generally have a 14-day right of withdrawal. Since digital content is unlocked immediately upon purchase, the right of withdrawal expires when execution begins, provided the user has expressly agreed to this prior to the purchase (§ 356(5) BGB). Refunds can be requested directly from Apple at <a href="https://reportaproblem.apple.com" target="_blank" rel="noopener">reportaproblem.apple.com</a>. Details: <a href="/en/withdrawal">Right of Withdrawal</a>.</p>

<h2>8. Availability</h2>
<p>The provider strives for high availability but does not guarantee uninterrupted access. Planned maintenance will be announced where possible.</p>

<h2>9. User obligations</h2>
<p>The user undertakes not to use the App for unlawful purposes, not to perform automated mass access (scraping, bots), and to keep credentials secure.</p>

<h2>10. Limitation of liability</h2>
<p>The provider is liable without limitation for intent and gross negligence and for injury to life, body, and health. In cases of slight negligence, the provider is liable only for the breach of essential contractual obligations, limited to the typically foreseeable damage. Further liability is excluded.</p>

<h2>11. Data protection</h2>
<p>Information on the processing of personal data can be found in our <a href="/en/privacy">Privacy Policy</a>.</p>

<h2>12. Changes to these Terms</h2>
<p>The provider reserves the right to amend these Terms with at least 30 days' advance notice (by email or in-app notice). If the user does not object within this period, the amended Terms are deemed accepted.</p>

<h2>13. Applicable law and jurisdiction</h2>
<p>The law of the Federal Republic of Germany applies, excluding the UN Convention on Contracts for the International Sale of Goods (CISG). For consumers resident in the EU, the mandatory consumer protection law of their country of residence takes precedence.</p>

<p><em>Last updated: 4 May 2026</em></p>`
}

// ─────────────────────────────────────────────────────────────────────────────
// WIDERRUFSBELEHRUNG / RIGHT OF WITHDRAWAL
// ─────────────────────────────────────────────────────────────────────────────

export function defaultWiderruf(locale: Locale): string {
  return locale === 'en' ? widerrufEn() : widerrufDe()
}

function widerrufDe(): string {
  return `
<h2>Widerrufsbelehrung</h2>

<h3>Widerrufsrecht</h3>
<p>Als Verbraucher haben Sie das Recht, binnen 14 Tagen ohne Angabe von Gründen diesen Vertrag zu widerrufen. Die Widerrufsfrist beträgt 14 Tage ab dem Tag des Vertragsschlusses.</p>

<h3>Ausübung des Widerrufsrechts</h3>
<p>Um Ihr Widerrufsrecht auszuüben, müssen Sie uns</p>
<p><strong>David Schrödinger · CustoSoft</strong><br>
Badstubweg 3 · 87487 Wiggensbach<br>
E-Mail: <a href="mailto:custosoftsupportde@gmail.com">custosoftsupportde@gmail.com</a></p>
<p>mittels einer eindeutigen Erklärung (z.B. per E-Mail) über Ihren Entschluss, diesen Vertrag zu widerrufen, informieren. Sie können dafür das folgende Muster-Widerrufsformular verwenden, das jedoch nicht vorgeschrieben ist.</p>

<h3>Muster-Widerrufsformular</h3>
<p style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.12);padding:16px;border-radius:10px;font-size:13px;line-height:1.8">
An: David Schrödinger · CustoSoft · custosoftsupportde@gmail.com<br><br>
Hiermit widerrufe(n) ich/wir den von mir/uns abgeschlossenen Vertrag über den Kauf der folgenden digitalen Inhalte:<br>
— Datum des Vertragsabschlusses: ___________<br>
— Name des/der Verbraucher(s): ___________<br>
— Unterschrift (nur bei Mitteilung auf Papier): ___________<br>
— Datum: ___________
</p>

<h3>Folgen des Widerrufs</h3>
<p>Wenn Sie diesen Vertrag widerrufen, erstatten wir Ihnen alle Zahlungen, die wir von Ihnen erhalten haben, unverzüglich und spätestens binnen 14 Tagen. Da die Zahlung über Apple abgewickelt wurde, erfolgt die Rückerstattung über den Apple-Kundenservice.</p>

<h3>Vorzeitiges Erlöschen des Widerrufsrechts</h3>
<p>Das Widerrufsrecht erlischt vorzeitig, wenn</p>
<ul>
  <li>der Anbieter mit der Ausführung des Vertrags begonnen hat,</li>
  <li>der Verbraucher vor der Ausführung ausdrücklich zugestimmt hat, dass der Anbieter mit der Ausführung vor Ablauf der Widerrufsfrist beginnt, und</li>
  <li>der Verbraucher seine Kenntnis davon bestätigt hat, dass er durch seine Zustimmung sein Widerrufsrecht mit Beginn der Ausführung des Vertrags verliert (§ 356 Abs. 5 BGB).</li>
</ul>
<p>Da In-App-Käufe sofort nach Apple-Bestätigung freigeschaltet werden und der Nutzer im App Store durch Abschluss des Kaufvorgangs dieser sofortigen Ausführung zustimmt, erlischt das Widerrufsrecht in der Regel mit der Freischaltung der Funktion.</p>

<h3>Refunds direkt über Apple</h3>
<p>Da alle Zahlungen ausschließlich über den Apple App Store verarbeitet werden, können Rückerstattungen direkt bei Apple beantragt werden:<br>
<a href="https://reportaproblem.apple.com" target="_blank" rel="noopener">reportaproblem.apple.com</a></p>

<p><em>Stand: 04.05.2026</em></p>`
}

function widerrufEn(): string {
  return `
<h2>Right of Withdrawal</h2>

<h3>Right of withdrawal</h3>
<p>As a consumer, you have the right to withdraw from this contract within 14 days without giving any reason. The withdrawal period is 14 days from the date of conclusion of the contract.</p>

<h3>Exercising the right of withdrawal</h3>
<p>To exercise your right of withdrawal, you must inform us</p>
<p><strong>David Schrödinger · CustoSoft</strong><br>
Badstubweg 3 · 87487 Wiggensbach · Germany<br>
Email: <a href="mailto:custosoftsupportde@gmail.com">custosoftsupportde@gmail.com</a></p>
<p>by means of a clear statement (e.g. by email) of your decision to withdraw from this contract. You may use the following model withdrawal form, but its use is not mandatory.</p>

<h3>Model withdrawal form</h3>
<p style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.12);padding:16px;border-radius:10px;font-size:13px;line-height:1.8">
To: David Schrödinger · CustoSoft · custosoftsupportde@gmail.com<br><br>
I/We hereby withdraw from the contract concluded by me/us for the purchase of the following digital content:<br>
— Date of contract conclusion: ___________<br>
— Name of consumer(s): ___________<br>
— Signature (only if notified on paper): ___________<br>
— Date: ___________
</p>

<h3>Consequences of withdrawal</h3>
<p>If you withdraw from this contract, we will refund all payments received from you without undue delay and no later than within 14 days. Since the payment was processed by Apple, the refund is issued via Apple Support.</p>

<h3>Early expiry of the right of withdrawal</h3>
<p>The right of withdrawal expires early when</p>
<ul>
  <li>the provider has begun performing the contract,</li>
  <li>the consumer has expressly consented prior to performance that the provider begins performance before the end of the withdrawal period, and</li>
  <li>the consumer has acknowledged that, by giving consent, they lose their right of withdrawal once performance begins (§ 356(5) BGB).</li>
</ul>
<p>Because in-app purchases are unlocked immediately after Apple confirmation, and the user agrees to this immediate execution by completing the purchase flow in the App Store, the right of withdrawal generally expires upon feature unlock.</p>

<h3>Refunds directly via Apple</h3>
<p>Since all payments are processed exclusively through the Apple App Store, refunds can be requested directly from Apple:<br>
<a href="https://reportaproblem.apple.com" target="_blank" rel="noopener">reportaproblem.apple.com</a></p>

<p><em>Last updated: 4 May 2026</em></p>`
}
