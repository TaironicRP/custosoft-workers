# CustoSoft API — Cloudflare Workers Deployment Guide

## Schritt 1 — Cloudflare Account & Domain

1. **Account erstellen**: https://dash.cloudflare.com/sign-up
2. **Domain hinzufügen**: `custosoft.de` in Cloudflare einbinden
   - Bei deinem Domain-Registrar: Nameserver auf Cloudflare-Nameserver ändern
   - Cloudflare gibt dir zwei NS-Einträge (z.B. `aria.ns.cloudflare.com`)
3. **Subdomain planen**: `api.custosoft.de` → wird automatisch vom Worker übernommen

---

## Schritt 2 — Wrangler CLI installieren

```bash
npm install -g wrangler
wrangler login          # öffnet Browser → Cloudflare einloggen
```

---

## Schritt 3 — D1 Datenbank erstellen

```bash
cd /Users/davidschroe/Desktop/custosoft-workers

# Datenbank erstellen
wrangler d1 create custosoft-db

# ⚠️ WICHTIG: Die ausgegebene database_id in wrangler.toml eintragen!
# Beispiel Output:
# ✅ Created D1 database 'custosoft-db' (id: abc123-def456-...)
```

Jetzt `wrangler.toml` öffnen und `PASTE_YOUR_D1_DATABASE_ID_HERE` ersetzen.

```bash
# Schema in D1 einspielen (remote = echte Datenbank)
wrangler d1 execute custosoft-db --file=schema.sql --remote

# ✅ Prüfen ob es funktioniert hat:
wrangler d1 execute custosoft-db --command="SELECT name FROM sqlite_master WHERE type='table'" --remote
```

---

## Schritt 4 — R2 Bucket erstellen

```bash
# Bucket für alle Uploads (Bilder, Dokumente, Avatare)
wrangler r2 bucket create custosoft-uploads

# ✅ Prüfen:
wrangler r2 bucket list
```

---

## Schritt 5 — Dependencies installieren

```bash
cd /Users/davidschroe/Desktop/custosoft-workers
npm install
```

---

## Schritt 6 — Secrets setzen

```bash
# JWT Secret (mindestens 64 Zeichen — generiere einen zufälligen String)
wrangler secret put JWT_SECRET
# → Eingabe: <langen zufälligen String eingeben>

# Apple Sign In
wrangler secret put APPLE_CLIENT_ID
# → com.taironic.custosoft

wrangler secret put APPLE_TEAM_ID
# → deine Apple Team ID (10 Zeichen, aus App Store Connect)

wrangler secret put APPLE_KEY_ID
# → deine Sign In with Apple Key ID

wrangler secret put APPLE_PRIVATE_KEY
# → Inhalt der .p8 Datei (alle Zeilen als eine Zeile mit \n)

wrangler secret put APPLE_IAP_SHARED_SECRET
# → App Store Connect → Meine Apps → In-App-Käufe → Shared Secret
```

---

## Schritt 7 — Lokal testen (Simulator)

```bash
# Workers lokal starten (nutzt lokale D1 + R2 Simulatoren)
npm run dev

# iOS Simulator verbindet sich mit http://localhost:8787
# Debug-URL ist schon in APIClient.swift für DEBUG-Builds gesetzt
```

Jetzt die iOS App im Simulator starten → Login sollte funktionieren!

---

## Schritt 8 — Bestehende Daten migrieren (optional)

```bash
# better-sqlite3 für das Migrationsskript installieren
npm install --save-dev better-sqlite3 @types/better-sqlite3

# Migration ausführen (liest custosoft.db → generiert SQL-Dateien)
node scripts/migrate.js

# SQL in D1 einspielen (Reihenfolge wichtig!)
wrangler d1 execute custosoft-db --file=scripts/migrated_users.sql --remote
wrangler d1 execute custosoft-db --file=scripts/migrated_orgs.sql --remote
wrangler d1 execute custosoft-db --file=scripts/migrated_data.sql --remote
```

**⚠️ Achtung**: Passwörter werden NICHT migriert. 
Nutzer müssen einmalig "Passwort vergessen" nutzen.
Apple/Google Login funktioniert sofort ohne Reset.

---

## Schritt 9 — Deployen

```bash
npm run deploy

# Output zeigt die Worker URL: https://custosoft-api.DEIN_ACCOUNT.workers.dev
```

---

## Schritt 10 — Custom Domain: api.custosoft.de

1. In Cloudflare Dashboard: **Workers & Pages** → `custosoft-api` → **Settings** → **Domains & Routes**
2. **Add Custom Domain**: `api.custosoft.de`
3. Cloudflare erstellt automatisch den DNS-Eintrag

Oder via CLI:
```bash
# Danach wrangler.toml anpassen: routes-Block einkommentieren
wrangler deploy
```

---

## Schritt 11 — iOS App für Production bauen

In `APIClient.swift` ist bereits konfiguriert:
- **DEBUG**: `http://localhost:8787/api/v1` (Simulator)
- **Release**: `https://api.custosoft.de/api/v1` (Production)

In `Info.plist`:
- `NSAllowsArbitraryLoads` entfernt (HTTPS braucht das nicht mehr)
- `NSAllowsLocalNetworking` bleibt für Simulator-Dev

→ Einfach für TestFlight archivieren — läuft automatisch auf dem Workers-Backend.

---

## Apple App Review — ATS Compliance

Da `NSAllowsArbitraryLoads` entfernt ist und das Backend HTTPS nutzt:
- ✅ **Alle Apple ATS-Anforderungen erfüllt**
- ✅ **Kein Reject-Risiko mehr durch unsichere HTTP-Verbindungen**
- ✅ **TLS 1.3 via Cloudflare** (Cloudflare stellt automatisch gültige Zertifikate aus)

---

## Was Cloudflare automatisch macht

| Feature           | Details |
|-------------------|---------|
| HTTPS / TLS       | Automatisches Let's Encrypt Zertifikat für `api.custosoft.de` |
| DDoS-Schutz       | Cloudflare Magic Transit im kostenlosen Plan |
| Global Edge       | API läuft in ~300 Rechenzentren weltweit (niedrige Latenz) |
| Bandwidth         | 10 GB/Tag kostenlos (R2), 100k Requests/Tag (Workers) |
| D1 Database       | 5 GB Speicher, 5M Leseanfragen/Tag kostenlos |
| R2 Storage        | 10 GB/Monat kostenlos, kein Egress-Preis |

---

## Troubleshooting

```bash
# Worker Logs live anschauen
wrangler tail

# D1 direkt abfragen
wrangler d1 execute custosoft-db --command="SELECT COUNT(*) FROM users" --remote

# Worker neu deployen
wrangler deploy

# Secrets anzeigen (nur Namen, nicht Werte)
wrangler secret list
```

---

## Kostenschätzung (kostenloser Plan reicht für den Start)

| Service        | Kostenlos        | Paid (wenn nötig) |
|----------------|-----------------|-------------------|
| Workers        | 100k req/Tag     | $5/Monat unbegrenzt |
| D1 Database    | 5 GB, 5M reads/Tag | $0.001/1M reads |
| R2 Storage     | 10 GB            | $0.015/GB |
| **Gesamt**     | **$0/Monat**     | ~$5-10/Monat |
