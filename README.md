# CustoSoft API · Cloudflare Workers Backend

[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com)
[![D1 Database](https://img.shields.io/badge/Cloudflare-D1-0051C3?logo=cloudflare&logoColor=white)](https://developers.cloudflare.com/d1/)
[![R2 Storage](https://img.shields.io/badge/Cloudflare-R2-F38020?logo=cloudflare&logoColor=white)](https://developers.cloudflare.com/r2/)
[![Hono](https://img.shields.io/badge/Hono-4.x-E36002?logo=hono&logoColor=white)](https://hono.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![License](https://img.shields.io/badge/License-Proprietary-red.svg)](LICENSE)

> Production backend for the **CustoSoft** iOS · iPad · Mac App.
> Vollständige Migration vom alten ASP.NET-Stack auf das **Cloudflare Edge** —
> globale Latenz, Apple-ATS-konform, kostenlos im Free-Tier.

**Live API**: <https://custosoft-api.davidschroedinger.workers.dev>
**Live Web Admin**: <https://custosoft-api.davidschroedinger.workers.dev/admin>

---

## Versions-Info

| Komponente        | Version | Apple Build  |
|-------------------|---------|--------------|
| iOS App           | `1.0`   | `1`          |
| Backend (Workers) | `2.0.0` | —            |
| D1 Schema         | `v3`    | —            |

> Erste öffentliche Apple-App-Version: **`1.0` Build `1`** — niedrigste valide Version im App-Store-Universum.

---

## Was ist drin?

| Bereich                | Lösung |
|-----------------------|--------|
| **API-Routing**       | [Hono](https://hono.dev) (4.x, edge-optimiert) |
| **Datenbank**         | [Cloudflare D1](https://developers.cloudflare.com/d1) (SQLite-kompatibel) |
| **File-Storage**      | [Cloudflare R2](https://developers.cloudflare.com/r2) (S3-kompatibel) |
| **Auth**              | JWT (HS256) via [`jose`](https://github.com/panva/jose) + Apple Sign In |
| **Password-Hashing**  | PBKDF2-SHA256 100k iter via Web-Crypto |
| **E-Mail**            | [Resend](https://resend.com) (3.000 Mails/Monat free) |
| **Apple IAP**         | StoreKit 2 JWS-Verification |
| **Web-UI**            | Single-Page Glass-Admin + Marketing-Site |

---

## Architektur

```
                                              ┌─────────────────────┐
                                              │   iOS / iPad / Mac  │
                                              │       App (1.0)     │
                                              └──────────┬──────────┘
                                                         │ HTTPS
                                                         ▼
┌────────────────────────────────────────────────────────────────────────┐
│                Cloudflare Workers (custosoft-api)                      │
│  ┌──────────┐  ┌────────────┐  ┌───────────┐  ┌─────────────────────┐ │
│  │  Hono    │  │  Auth      │  │  Routes   │  │  Email · Resend     │ │
│  │  Router  │  │ Middleware │  │  (12 sub) │  │  Push · APNs (TBD)  │ │
│  └──────────┘  └────────────┘  └───────────┘  └─────────────────────┘ │
└─────────┬──────────────────────────┬────────────────┬────────────────┘
          │                          │                │
          ▼                          ▼                ▼
   ┌─────────────┐           ┌──────────────┐   ┌──────────────┐
   │ D1 Database │           │  R2 Bucket   │   │   Resend     │
   │ custosoft-db│           │   uploads    │   │ Email Service│
   └─────────────┘           └──────────────┘   └──────────────┘
```

---

## API-Endpunkte (Auszug)

### Auth · `/api/v1/auth`
- `POST /login`              — Email + Passwort Login
- `POST /register`           — Account anlegen + Verifizierungs-Mail
- `POST /apple`              — Sign In with Apple (JWT-Verifizierung gegen Apple-Public-Keys)
- `POST /verify-email`       — 6-stelliger Code aus Mail
- `POST /forgot` / `/reset`  — Passwort-Reset
- `GET  /me`                 — Aktuelles Profil
- `DELETE /me/delete`        — DSGVO-Löschung

### Produkte / IAP · `/api/v1/products`
- `GET  /`                    — Alle aktiven Produkte (12)
- `GET  /my`                  — Eigene aktive Lizenzen
- `POST /purchase`            — Apple-IAP-Receipt einlösen + Bestätigungs-Mail

### Chat · `/api/v1/conversations`
- `GET  /`                    — Liste der Conversations
- `POST /group`               — Gruppe erstellen
- `GET  /:id/messages`        — Nachrichten paginiert
- `POST /:id/send`            — Nachricht senden
- `POST /:id/upload`          — Datei-Anhang (multipart) → R2

### Stempeluhr · `/api/v1/punch`
- `GET  /status`              — Aktueller Status
- `POST /in` / `/out`         — Ein-/Aus-Stempeln
- `POST /pause` / `/resume`   — Pause-Steuerung
- `GET  /stats?period=week`   — Statistiken
- `GET  /team`                — Org-Team-Übersicht

### Akten · `/api/v1/files`
- `GET  /?userId=`            — Mitarbeiterakten lesen (Visibility-aware)
- `POST /`                    — Akte anlegen
- `POST /:id/upload`          — Datei-Anhang → R2
- `PATCH /:id`                — Archivieren / Wiederherstellen

### Bewerbungsmanager · `/api/v1/recruitment`
- `GET  /links` · `POST /links`             — Stellen-Links verwalten
- `GET  /applications`                       — Bewerbungs-Inbox
- `POST /public/submit`                      — Public Submit ohne Auth
- `POST /public/:id/upload`                  — CV / Anhang Upload

### Wand-Stempeluhr · `/api/v1/terminal`
- `PUT  /me/pin`              — PIN setzen
- `GET  /members`             — Kiosk-Member-Liste
- `POST /punch/in|out|pause|resume` — PIN-basiert stempeln

### Admin · `/api/v1/admin` (Staff only)
- `GET  /stats`               — Dashboard-KPIs
- `GET  /users` · `:id/full`  — User mit allen Lizenzen, Grants, Orders
- `POST /users/:id/block`     — Sperren / Entsperren
- `POST /users/:id/notify`    — Push-Benachrichtigung
- `POST /users/:id/grant`     — Lizenz manuell vergeben (Support-Fälle)
- `POST /users/:id/grant-trial` — Trial verlängern
- `GET  /licenses` · `DELETE /:id/revoke`
- `GET  /grants`              — Audit-Log manueller Vergaben
- `GET  /orders`              — Bestellhistorie
- `GET  /legal` · `PUT /:slug` — Rechtstext-Editor (Apple-Pflicht)

### Public Website
- `GET  /`                    — Landing Page
- `GET  /impressum` `/agb` `/datenschutz` `/widerruf`
- `GET  /apply/:code`         — Public Bewerbungs-Form

---

## Produkt-Katalog

| Slug                     | Name                       | Preis              | Apple Product ID                                    |
|-------------------------|---------------------------|-------------------|-----------------------------------------------------|
| `PunchClock`            | Stempeluhr                 | 2,99 € / 2 Wochen | `de.custosoft.app.punchclock`                       |
| `MoreSpace`             | Mehr Platz                 | 4,99 € einmalig   | `de.custosoft.app.morespace`                        |
| `Recruitment`           | Bewerbungsmanager          | 16,99 € einmalig  | `de.custosoft.app.recruitment`                      |
| `TerminalMode`          | Wand-Stempeluhr            | 9,99 € einmalig   | `de.custosoft.app.terminalmode`                     |
| `BusinessBasic`         | Business Basic (10 Slots)  | 49,00 € / Monat   | `de.custosoft.app.business.basic.monthly`           |
| `BusinessBasicYearly`   | Business Basic Jährlich    | 469,00 € / Jahr   | `de.custosoft.app.business.basic.yearly`            |
| `BusinessL`             | Business L (50 Slots)      | 89,00 € / Monat   | `de.custosoft.app.business.l.monthly`               |
| `BusinessLYearly`       | Business L Jährlich        | 849,00 € / Jahr   | `de.custosoft.app.business.l.yearly`                |
| `BusinessMAX`           | Business MAX (unbegrenzt)  | 149,00 € / Monat  | `de.custosoft.app.business.max.monthly`             |
| `BusinessMAXYearly`     | Business MAX Jährlich      | 1.429,00 € / Jahr | `de.custosoft.app.business.max.yearly`              |
| `AllInOne`              | Premium MAX                | 69,00 € / Monat   | `de.custosoft.app.allinone.monthly`                 |
| `AllInOneYearly`        | Premium MAX Jährlich       | 659,00 € / Jahr   | `de.custosoft.app.allinone.yearly`                  |

→ Jährliche Subscriptions = **20 % Rabatt** gegenüber Monthly · Stempeluhr hat 14 Tage Trial.

---

## Datenmodell (D1)

27 Tabellen — gemeinsamer Cluster für Auth, Org-Verwaltung, Stempeluhr, Akten, Chat, Bewerbungen, Admin.

```
users · organisations · org_members · org_invite_codes
└── conversations · conversation_members · messages
└── punch_entries · pause_entries
└── employee_files · org_positions · org_departments · employee_profiles
└── job_links · job_applications · job_application_attachments
└── products · user_extensions · orders · managed_grants
└── subscription_notifications · push_tokens · legal_pages
└── email_verification_tokens · password_reset_tokens · terminal_pins
```

Vollständiges Schema in [`schema.sql`](./schema.sql).

---

## Lokale Entwicklung

```bash
# 1. Klonen
git clone git@github.com:TaironicRP/custosoft-workers.git
cd custosoft-workers

# 2. Dependencies
npm install

# 3. Wrangler einloggen
wrangler login

# 4. D1-Datenbank erstellen
wrangler d1 create custosoft-db
# → ID in wrangler.toml eintragen

# 5. Schema einspielen
npm run db:init

# 6. R2-Bucket
wrangler r2 bucket create custosoft-uploads

# 7. Secrets setzen
wrangler secret put JWT_SECRET           # 64+ random chars
wrangler secret put RESEND_API_KEY       # re_...
wrangler secret put APPLE_CLIENT_ID      # com.taironic.custosoft
wrangler secret put APPLE_TEAM_ID
wrangler secret put APPLE_KEY_ID
wrangler secret put APPLE_PRIVATE_KEY
wrangler secret put APPLE_IAP_SHARED_SECRET

# 8. Lokal starten (simulierte D1 + R2)
npm run dev
# → http://localhost:8787

# 9. Deploy (Cloudflare Edge global)
npm run deploy
```

### Scripts

| Befehl              | Zweck |
|--------------------|-------|
| `npm run dev`       | Workers lokal starten (Miniflare) |
| `npm run deploy`    | Production-Deploy auf Cloudflare |
| `npm run db:init`   | Schema in D1 einspielen |
| `npm run db:migrate`| Migration vom alten SQLite/ASP.NET-Backend |
| `npm run lint`      | TypeScript Type-Check |
| `npm run types`     | Wrangler-Type-Bindings generieren |

---

## Deployment-Workflow

```bash
git push origin main          # Code-Backup auf GitHub
npm run deploy                # Push zu Cloudflare Workers
                              # ↓
                              # Live in ~12 Sekunden auf 300+ PoPs
```

---

## Lokalisierung der Public Website

Die Marketing-Seite (`/`), Impressum, Datenschutz, AGB, Widerruf und die
Bewerbungs-Apply-Page sind mehrsprachig. Aktuell **Deutsch + Englisch**.

URL-Schema: `/:locale/...` — z.B. `/en/`, `/de/imprint`, `/en/privacy`.
Footer enthält einen Sprachschalter, der einen Cookie setzt.

**Neue Sprache hinzufügen** (FR, ES, IT, …): siehe [`I18N.md`](I18N.md).

**Custom Domain** (optional): in Cloudflare Dashboard → Workers → custosoft-api → Domains → `api.custosoft.de` hinzufügen.

---

## Sicherheit

- **JWT-Token**: HS256 mit 256-bit Secret, 30 Tage gültig
- **Password-Hashing**: PBKDF2-SHA256 mit 100.000 Iterationen + 16-byte Salt
- **Auth-Middleware**: zentralisiert in `src/middleware/auth.ts` (`requireAuth`, `requireStaff`, `requireOrgMember`)
- **CORS**: Whitelist via `ALLOWED_ORIGINS` Environment Variable
- **HTML-Escaping**: alle Email-Templates schützen gegen XSS
- **Apple Sign In**: Identity-Token wird gegen Apple's Public-Keys verifiziert
- **CSP** auf Web-Pages: implizit über Cloudflare Security-Headers

### DSGVO-Compliance
- Daten in EU-Region (Cloudflare Frankfurt)
- DELETE `/auth/me/delete` löscht Account + Cascade-Daten
- Kein User-Tracking, kein Analytics, kein IDFA
- Auftragsverarbeiter-Vereinbarung mit Cloudflare nach Art. 28 DSGVO

---

## Apple App Store Vorbereitung

### Required:
- ✅ HTTPS-Endpoint (ATS-konform via Cloudflare TLS)
- ✅ Impressum, AGB, Datenschutz, Widerrufsbelehrung als Public-URL
- ✅ Account-Löschung in App + Backend
- ✅ Sign In with Apple Support
- ✅ Demo-Account für App-Review:
  ```
  Email:    review@custosoft.de
  Passwort: AppReview2026!
  ```

### App Store Connect TODO:
- [ ] 12 In-App-Käufe mit obigen IDs anlegen
- [ ] Auto-Renewable Subscription Group für Yearly/Monthly Pairs
- [ ] Introductory Offer "14 Days Free" für PunchClock
- [ ] Privacy Disclosure ausfüllen
- [ ] Screenshots iPhone / iPad / Mac

---

## Stack-Vergleich

| | Vorher (ASP.NET / Strato) | Jetzt (Cloudflare Workers) |
|--|--|--|
| Hosting       | Strato VPS (~10 €/Monat) | Cloudflare Edge **(0 €)** |
| HTTPS         | manuell (Let's Encrypt + nginx) | automatisch |
| Deploy-Zeit   | rsync + dotnet publish (~5 Min) | `npm run deploy` (12 Sek) |
| Latenz        | nur Frankfurt | global ~300 PoPs |
| Datenbank     | SQLite-Datei auf VPS | D1 (replikation, Backup automatisch) |
| Skalierung    | manuell | auto · 0–∞ |
| File-Storage  | lokales `wwwroot` | R2 (S3-kompatibel, kein Egress) |
| Apple-ATS     | Workaround mit `NSAllowsArbitraryLoads` | nativ ATS-konform |

---

## Lizenz & Eigentum

© 2026 **David Schroedinger** · CustoSoft
Proprietäre Software — alle Rechte vorbehalten.

Kontakt: [taironic.media@gmail.com](mailto:taironic.media@gmail.com)

---

## Mitwirkende

Built with ❤️ by **David Schroedinger**
mit Pair-Programming-Unterstützung von **Claude Sonnet 4.5** (Anthropic).
