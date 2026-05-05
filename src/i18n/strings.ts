// ─────────────────────────────────────────────────────────────────────────────
// i18n — UI strings for the public website (Landing + Nav + Footer)
// ─────────────────────────────────────────────────────────────────────────────
//
// Each key has one entry per supported locale. Adding a new locale = add a
// translation for every key here. TypeScript will complain if any key is
// missing, so it's safe.
//
// Format placeholders:
//   {0}, {1}    — positional arguments (replaced at render time by `t()`)
// ─────────────────────────────────────────────────────────────────────────────

import type { Locale } from './locales'

export const STRINGS = {
  // ── Nav ────────────────────────────────────────────────────────────────────
  nav_start:        { de: 'Start',          en: 'Home' },
  nav_imprint:      { de: 'Impressum',      en: 'Imprint' },
  nav_privacy:      { de: 'Datenschutz',    en: 'Privacy' },
  nav_terms:        { de: 'AGB',            en: 'Terms' },

  // ── Footer ─────────────────────────────────────────────────────────────────
  footer_revocation: { de: 'Widerruf',      en: 'Right of Withdrawal' },
  footer_contact:    { de: 'Kontakt',       en: 'Contact' },
  footer_lang:       { de: 'Sprache',       en: 'Language' },

  // ── Landing — meta ─────────────────────────────────────────────────────────
  meta_title:       { de: 'CustoSoft — Die Team-App für Apple. Made in Germany.',
                      en: 'CustoSoft — The team app for Apple. Made in Germany.' },
  meta_description: { de: 'Stempeluhr, Akten, Chat, Bewerbungsmanager — nativ auf iOS, iPadOS & macOS. Jetzt als Beta-Tester bewerben und lebenslange Lizenz sichern.',
                      en: 'Punch clock, files, chat, recruitment — native on iOS, iPadOS & macOS. Apply as a beta tester and secure a lifetime license.' },
  meta_og_title:    { de: 'CustoSoft — Die App für dein Team.',
                      en: 'CustoSoft — The app for your team.' },
  meta_og_desc:     { de: 'Nativ in Swift. Nur Apple. Nur Deutschland. Jetzt Beta-Tester werden.',
                      en: 'Native Swift. Apple only. Currently Germany only. Become a beta tester now.' },

  // ── Landing — hero ─────────────────────────────────────────────────────────
  hero_badge:       { de: 'Beta-Programm — jetzt offen',
                      en: 'Beta program — open now' },
  hero_h1_line1:    { de: 'Die App',         en: 'The app' },
  hero_h1_line2:    { de: 'für dein',        en: 'for your' },
  hero_h1_em:       { de: 'Team.',           en: 'Team.' },
  hero_sub:         { de: 'Stempeluhr · Mitarbeiter-Akten · Team-Chat · Bewerbungsmanagement. Nativ in Swift. Datenschutz first. Made in Germany.',
                      en: 'Punch clock · Employee files · Team chat · Recruitment manager. Native Swift. Privacy first. Made in Germany.' },
  hero_avail_de:    { de: '🇩🇪 Nur Deutschland',
                      en: '🇩🇪 Currently Germany only' },
  hero_coming:      { de: 'Web · Android geplant',
                      en: 'Web · Android planned' },
  hero_cta_apply:   { de: '🧪 Jetzt Tester werden',
                      en: '🧪 Become a tester' },
  hero_cta_features:{ de: 'Features entdecken ↓',
                      en: 'Discover features ↓' },

  // Phone mockup
  phone_punch:      { de: 'Stempeluhr',      en: 'Punch clock' },
  phone_since:      { de: 'Seit',            en: 'Since' },
  phone_break:      { de: 'Pause',           en: 'Break' },
  phone_week:       { de: 'Woche',           en: 'Week' },
  phone_team_active:{ de: 'Team aktiv',      en: 'Team active' },
  phone_stamped:    { de: '⏱ Gestempelt',    en: '⏱ Clocked in' },
  phone_team_today: { de: 'TEAM HEUTE',      en: 'TEAM TODAY' },
  phone_active:     { de: '● Aktiv',         en: '● Active' },
  phone_paused:     { de: '● Pause',         en: '● On break' },

  // Beta counter
  beta_of:          { de: 'von',             en: 'of' },
  beta_spots:       { de: 'Beta-Plätzen vergeben',
                      en: 'beta seats taken' },
  beta_reward_short:{ de: '🎁 Belohnung: lebenslange Stempeluhr-Lizenz',
                      en: '🎁 Reward: lifetime punch-clock license' },

  // ── Landing — platforms section ────────────────────────────────────────────
  platforms_tag:    { de: 'Plattformen',     en: 'Platforms' },
  platforms_h2:     { de: 'Nativ. Kein Browser. Kein Kompromiss.',
                      en: 'Native. No browser. No compromise.' },
  platforms_sub:    { de: '100 % Swift für Apple-Geräte. Schneller, schöner, sicherer als jede Webwrapper-App. Zukünftig auch Web & Android.',
                      en: '100% Swift for Apple devices. Faster, prettier, safer than any web wrapper. Web & Android coming.' },
  plat_iphone_desc: { de: 'iOS 17+ · Dynamic Island · Lock Screen Widget · Face ID',
                      en: 'iOS 17+ · Dynamic Island · Lock Screen widget · Face ID' },
  plat_ipad_desc:   { de: 'iPadOS 17+ · Stage Manager · Wand-Stempeluhr-Kiosk · Multitasking',
                      en: 'iPadOS 17+ · Stage Manager · Wall-mount kiosk · Multitasking' },
  plat_mac_desc:    { de: 'macOS 14 Sonoma · Native Sidebar · Cmd+, Settings · Menüleiste',
                      en: 'macOS 14 Sonoma · Native sidebar · Cmd+, settings · Menu bar' },
  plat_web_desc:    { de: 'Browserbasierte Version. Gleiches Backend, alle Daten synchron.',
                      en: 'Browser-based version. Same backend, all data in sync.' },
  plat_android_desc:{ de: 'Nativ in Kotlin. Material You Design. Auf Augenhöhe mit der iOS-App.',
                      en: 'Native Kotlin. Material You design. On par with the iOS app.' },
  plat_planned:     { de: 'In Planung',      en: 'Planned' },

  // ── Landing — features ─────────────────────────────────────────────────────
  features_tag:     { de: 'Funktionen',      en: 'Features' },
  features_h2:      { de: 'Alles drin. Nichts Unnötiges.',
                      en: 'All in. Nothing extra.' },
  features_sub:     { de: 'Modular — kaufe nur was du brauchst. Jede Erweiterung wird sofort freigeschaltet, keine Wartezeit.',
                      en: 'Modular — buy only what you need. Every extension unlocks instantly, no waiting.' },

  feat_punch_h:     { de: 'Stempeluhr',      en: 'Punch clock' },
  feat_punch_p:     { de: 'Ein-Tap stempeln. Pausen, Wochen-Statistiken, Dynamic-Island-Live-Anzeige und CSV-Export für die Lohnbuchhaltung.',
                      en: 'One-tap clock-in. Breaks, weekly stats, live Dynamic Island display, and CSV export for payroll.' },
  feat_punch_tag:   { de: '2,99 €/Woche · jederzeit kündbar',
                      en: '€2.99/week · cancel anytime' },

  feat_recruit_h:   { de: 'Bewerbungsmanager', en: 'Recruitment manager' },
  feat_recruit_p:   { de: 'Stellenlinks erstellen, Bewerbungen sammeln, Status-Workflow von „Neu" bis „Eingestellt". Direkte Übernahme als Mitarbeiter.',
                      en: 'Create job links, collect applications, status workflow from “New” to “Hired”. Convert applicants directly into employees.' },
  feat_recruit_tag: { de: '9,99 € einmalig · Dauerlizenz',
                      en: '€9.99 one-time · lifetime license' },

  feat_wall_h:      { de: 'Wand-Stempeluhr', en: 'Wall punch clock' },
  feat_wall_p:      { de: 'iPad an die Wand. Mitarbeiter stempeln per persönlichem 7-stelligem Code. Vollbild-Kiosk, Hold-to-Exit Sperre.',
                      en: 'Mount an iPad on the wall. Employees clock in with a personal 7-digit code. Full-screen kiosk with hold-to-exit lock.' },
  feat_wall_tag:    { de: '14,99 € einmalig · Dauerlizenz',
                      en: '€14.99 one-time · lifetime license' },

  feat_chat_h:      { de: 'Team-Chat',       en: 'Team chat' },
  feat_chat_p:      { de: 'Echtzeit-Messaging mit Foto-Anhängen, Emoji-Picker, In-App Banner. Strikte Org-Isolation — kein Datenleck zwischen Firmen.',
                      en: 'Real-time messaging with photo attachments, emoji picker, in-app banners. Strict org isolation — no data leaks between companies.' },
  feat_chat_tag:    { de: 'Inklusive in Business-Paketen',
                      en: 'Included in Business plans' },

  feat_org_h:       { de: 'Organisations-Verwaltung',
                      en: 'Organisation management' },
  feat_org_p:       { de: '10 granulare Berechtigungen pro Mitarbeiter. Abteilungen, Positionen, Lohn-Auswertung mit Export. Mitglieder erben Stempeluhr & Akten vom Inhaber.',
                      en: '10 granular permissions per employee. Departments, positions, payroll analysis with export. Members inherit punch clock & files from the owner.' },
  feat_org_tag:     { de: 'Business Basic 49 €/Monat · Business L 89 €/Monat (50 Slots)',
                      en: 'Business Basic €49/mo · Business L €89/mo (50 slots)' },

  feat_files_h:     { de: 'Mitarbeiter-Akten',
                      en: 'Employee files' },
  feat_files_p:     { de: 'Digitale Personalakten mit Dokumenten-Upload. Nur für berechtigte Admins sichtbar. DSGVO-konform, EU-Server.',
                      en: 'Digital employee records with document upload. Visible only to authorised admins. GDPR-compliant, EU servers.' },
  feat_files_tag:   { de: 'Inklusive in Business-Paketen',
                      en: 'Included in Business plans' },

  // ── Landing — beta signup ─────────────────────────────────────────────────
  beta_tag:         { de: 'Beta-Programm',   en: 'Beta program' },
  beta_h2_l1:       { de: 'Werde einer der ersten',
                      en: 'Be one of the first' },
  beta_h2_l2:       { de: '100 Beta-Tester.', en: '100 beta testers.' },
  beta_reward_strong:{ de: 'Lebenslange Stempeluhr-Lizenz',
                      en: 'Lifetime punch-clock license' },
  beta_reward_sub:  { de: 'Kostenlos · Für immer freigeschaltet · Bei Release automatisch aktiviert',
                      en: 'Free · Unlocked forever · Auto-activated at launch' },
  form_first_name:  { de: 'VORNAME',         en: 'FIRST NAME' },
  form_first_name_ph:{de: 'z.B. David',      en: 'e.g. David' },
  form_email:       { de: 'E-MAIL *',        en: 'EMAIL *' },
  form_email_ph:    { de: 'deine@email.de',  en: 'your@email.com' },
  form_device:      { de: 'DEIN GERÄT',      en: 'YOUR DEVICE' },
  form_device_choose:{de: 'Bitte wählen …',  en: 'Please select …' },
  form_device_iphone:{de: 'iPhone',          en: 'iPhone' },
  form_device_ipad: { de: 'iPad',            en: 'iPad' },
  form_device_mac:  { de: 'Mac',             en: 'Mac' },
  form_device_multi:{ de: 'Mehrere Apple-Geräte',
                      en: 'Multiple Apple devices' },
  form_team:        { de: 'TEAMGRÖSSE (OPTIONAL)',
                      en: 'TEAM SIZE (OPTIONAL)' },
  form_team_solo:   { de: 'Nur ich',         en: 'Just me' },
  form_team_2_5:    { de: '2–5 Personen',    en: '2–5 people' },
  form_team_6_20:   { de: '6–20 Personen',   en: '6–20 people' },
  form_team_20p:    { de: 'Mehr als 20',     en: 'More than 20' },
  form_submit:      { de: '🚀 Jetzt bewerben — kostenlos',
                      en: '🚀 Apply now — free' },
  form_submitting:  { de: 'Wird registriert …',
                      en: 'Submitting …' },
  form_invalid_email:{de: 'Bitte gib eine gültige E-Mail-Adresse ein.',
                      en: 'Please enter a valid email address.' },
  form_network_err: { de: 'Netzwerkfehler. Bitte versuch es nochmal.',
                      en: 'Network error. Please try again.' },
  form_note:        { de: 'Kein Spam. Keine Weitergabe. Nur Beta-Updates und deine Lizenz-Aktivierung bei Release.',
                      en: 'No spam. No sharing. Only beta updates and your license activation at launch.' },
  form_success_h:   { de: 'Du bist dabei!',  en: "You're in!" },
  form_success_p:   { de: 'Wir haben dir eine Bestätigungsmail geschickt.<br>Du wirst als Erster informiert wenn es losgeht — und bekommst automatisch deine lebenslange Stempeluhr-Lizenz bei Release.',
                      en: "We've sent you a confirmation email.<br>You'll be the first to know when we launch — and you'll automatically get your lifetime punch-clock license at release." },
  form_success_spam:{ de: 'Schau auch in deinen Spam-Ordner.',
                      en: 'Check your spam folder too.' },

  // ── Landing — roadmap ─────────────────────────────────────────────────────
  roadmap_tag:      { de: 'Roadmap',         en: 'Roadmap' },
  roadmap_h2:       { de: 'Was noch kommt.', en: "What's coming." },
  roadmap_sub:      { de: 'CustoSoft wird weiter wachsen — hier ist der Plan.',
                      en: "CustoSoft keeps growing — here's the plan." },
  rm1_phase:        { de: 'Phase 1 — Live',  en: 'Phase 1 — Live' },
  rm1_h:            { de: 'iOS · iPadOS · macOS',
                      en: 'iOS · iPadOS · macOS' },
  rm1_p:            { de: 'Stempeluhr, Chat, Akten, Bewerbungsmanager, Wand-Stempeluhr. Cloudflare Edge, EU-Server.',
                      en: 'Punch clock, chat, files, recruitment manager, wall clock. Cloudflare Edge, EU servers.' },
  rm1_li1:          { de: 'App Store — TestFlight läuft',
                      en: 'App Store — TestFlight running' },
  rm1_li2:          { de: 'Push Notifications',
                      en: 'Push notifications' },
  rm1_li3:          { de: 'Business-Abos',   en: 'Business subscriptions' },

  rm2_phase:        { de: 'Phase 2 — In Planung',
                      en: 'Phase 2 — Planned' },
  rm2_h:            { de: 'Web-Version',     en: 'Web version' },
  rm2_p:            { de: 'Vollständige Web-App im Browser. Gleiches Backend, alle Daten synchron mit der Apple-App.',
                      en: 'Full web app in the browser. Same backend, all data in sync with the Apple app.' },
  rm2_li1:          { de: 'Alle Core-Features',
                      en: 'All core features' },
  rm2_li2:          { de: 'Desktop-optimiertes UI',
                      en: 'Desktop-optimized UI' },
  rm2_li3:          { de: 'Export & Reports', en: 'Export & reports' },

  rm3_phase:        { de: 'Phase 3 — Geplant',
                      en: 'Phase 3 — Planned' },
  rm3_h:            { de: 'Android (Kotlin)', en: 'Android (Kotlin)' },
  rm3_p:            { de: 'Nativ in Kotlin mit Jetpack Compose. Material You Design. Auf Augenhöhe mit der iOS-App — kein Wrapper.',
                      en: 'Native Kotlin with Jetpack Compose. Material You design. On par with the iOS app — no wrapper.' },
  rm3_li1:          { de: 'Stempeluhr, Chat, Akten',
                      en: 'Punch clock, chat, files' },
  rm3_li2:          { de: 'Material You · Android 12+',
                      en: 'Material You · Android 12+' },
  rm3_li3:          { de: 'Play Store',      en: 'Play Store' },

  rm4_phase:        { de: 'Langfristig',     en: 'Long term' },
  rm4_h:            { de: 'Enterprise & API',en: 'Enterprise & API' },
  rm4_p:            { de: 'Lohnbuchhaltungs-Integration, HR-Schnittstellen, Custom-Onboarding für größere Teams.',
                      en: 'Payroll integration, HR APIs, custom onboarding for larger teams.' },
  rm4_li1:          { de: 'DATEV-Export',    en: 'DATEV export' },
  rm4_li2:          { de: 'REST API für Dritte',
                      en: 'Public REST API' },
  rm4_li3:          { de: 'Whitelabel',      en: 'White label' },

  // ── Landing — FAQ ─────────────────────────────────────────────────────────
  faq_tag:          { de: 'FAQ',             en: 'FAQ' },
  faq_h2:           { de: 'Häufige Fragen.', en: 'Frequently asked.' },
  faq1_q:           { de: 'Was bekomme ich als Beta-Tester?',
                      en: 'What do I get as a beta tester?' },
  faq1_a:           { de: 'Eine <strong>lebenslange Stempeluhr-Lizenz</strong> — komplett kostenlos, für immer freigeschaltet, automatisch auf deinen Account bei Release aktiviert. Kein Abo, keine monatlichen Kosten.',
                      en: 'A <strong>lifetime punch-clock license</strong> — completely free, unlocked forever, automatically activated on your account at launch. No subscription, no monthly fees.' },
  faq2_q:           { de: 'Warum aktuell nur in Deutschland?',
                      en: 'Why Germany only for now?' },
  faq2_a:           { de: 'CustoSoft wird für den deutschen Markt entwickelt — Sprache, Rechtslage (Arbeitszeitgesetz, DSGVO), Lohnbuchhaltungs-Export. Weitere Länder folgen sobald Lokalisierungen fertig sind.',
                      en: 'CustoSoft is built for the German market — language, legal landscape (working-hours act, GDPR), payroll export. More countries follow as localisations are ready.' },
  faq3_q:           { de: 'Warum nur Apple-Geräte?',
                      en: 'Why Apple only?' },
  faq3_a:           { de: 'Wir haben uns bewusst für 100 % native Entwicklung entschieden — Swift auf Apple, Kotlin auf Android. Kein Cross-Platform-Kompromiss. Web & Android kommen nativ in separaten Phasen.',
                      en: "We deliberately chose 100% native development — Swift on Apple, Kotlin on Android. No cross-platform compromise. Web & Android arrive natively in separate phases." },
  faq4_q:           { de: 'Wo liegen meine Daten?',
                      en: 'Where is my data stored?' },
  faq4_a:           { de: 'Alle Daten liegen auf Cloudflare-Servern in der EU-Region Frankfurt. Kein US-Hosting, keine Drittanbieter-Analytics, kein Werbe-Tracking. Details in der <a href="{0}/datenschutz" style="color:#c594ff">Datenschutzerklärung</a>.',
                      en: 'All data lives on Cloudflare servers in the EU Frankfurt region. No US hosting, no third-party analytics, no ad tracking. Details in our <a href="{0}/privacy" style="color:#c594ff">Privacy Policy</a>.' },
  faq5_q:           { de: 'Kann ich die App auch ohne Abo nutzen?',
                      en: 'Can I use the app without a subscription?' },
  faq5_a:           { de: 'Ja — <strong>Bewerbungsmanager (9,99 €)</strong>, <strong>Wand-Stempeluhr (14,99 €)</strong> und <strong>Mehr Platz (4,99 €)</strong> sind Dauerlizenzen ohne Abo. Die Stempeluhr läuft als Wochen-Abo (2,99 €/Woche), jederzeit kündbar. Ohne Kauf steht ein kostenloser Bewerber-Modus zur Verfügung.',
                      en: 'Yes — the <strong>Recruitment manager (€9.99)</strong>, <strong>Wall clock (€14.99)</strong>, and <strong>More space (€4.99)</strong> are one-time lifetime licenses with no subscription. The Punch clock is a weekly subscription (€2.99/week), cancellable anytime. A free applicant-only mode is available without any purchase.' },

  // ── Beta-counter labels (passed to JS) ────────────────────────────────────
  beta_count_label_html: { de: 'von <strong>{0}</strong> Beta-Plätzen vergeben',
                           en: 'of <strong>{0}</strong> beta seats taken' },
} as const

export type StringKey = keyof typeof STRINGS

/** Look up a string for the given locale. Throws at compile time if `key` is unknown. */
export function t(key: StringKey, locale: Locale, ...args: string[]): string {
  let s: string = STRINGS[key][locale] ?? STRINGS[key]['de']
  args.forEach((a, i) => { s = s.replace(`{${i}}`, a) })
  return s
}
