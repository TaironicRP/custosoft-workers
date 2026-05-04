# custosoft.de von Strato auf Cloudflare bringen

Ziel: Domain `custosoft.de` zeigt auf den Worker, sodass die Landing-Page und API
unter https://custosoft.de erreichbar sind. Stand jetzt liegt die Domain bei
Strato (NS: `ns3/ns4.stratoserver.net`), Cloudflare kann nichts servieren.

Es gibt zwei Wege — der **erste** (Nameserver-Wechsel) ist für dich der
einfachste und gibt dir alle Cloudflare-Features (CDN, SSL, Page Rules,
Workers-Routes) auf einen Schlag.

---

## ⭐ Variante A — Nameserver auf Cloudflare umstellen (empfohlen)

### 1. Cloudflare-Zone für custosoft.de anlegen

1. Browser → https://dash.cloudflare.com → **Add a site**
2. `custosoft.de` eingeben → **Continue**
3. Plan **Free** auswählen → **Continue**
4. Cloudflare scannt deine Strato-DNS-Records und übernimmt sie automatisch.
   Prüfe die Liste: alles was du bei Strato im Zonefile hattest, sollte hier
   stehen (MX für Mails, evtl. A-Records für die alte Webseite, TXT-Records
   für SPF/DKIM falls vorhanden).
5. **Continue** drücken — Cloudflare zeigt dir die zwei Cloudflare-Nameserver
   die du bei Strato eintragen musst (z.B. `lana.ns.cloudflare.com` &
   `walt.ns.cloudflare.com`). **Notiere dir diese zwei Namen.**

### 2. Nameserver bei Strato umstellen

1. Strato Login → https://www.strato.de/apps/CustomerService
2. **Domainverwaltung** → custosoft.de auswählen → **Verwalten**
3. Punkt **Nameserver / DNS** (oder „Nameserver verwalten")
4. Auf **Eigene Nameserver verwenden** umschalten
5. Beide Strato-NS löschen, die zwei **Cloudflare-Nameserver** eintragen
6. Speichern

> ⏱ Übernahme: 5 Min – 24 h (meistens 30 Min). Cloudflare schickt dir eine
> Mail wenn die Zone „active" ist.

### 3. Worker-Route für custosoft.de aktivieren

Sobald Cloudflare die Zone als **Active** zeigt, in `wrangler.toml` die
Route wieder einkommentieren:

```toml
[[routes]]
pattern   = "custosoft.de/*"
zone_name = "custosoft.de"

[[routes]]
pattern   = "www.custosoft.de/*"
zone_name = "custosoft.de"
```

Dann: `npx wrangler deploy`

### 4. DNS-Record für die Custom-Domain (im Cloudflare-Dashboard)

Damit Browser den Hostnamen überhaupt finden, brauchst du einen A- oder
CNAME-Record auf den Worker:

- Cloudflare Dashboard → custosoft.de → **DNS** → **Add record**
- Type **A**, Name `@` (oder `custosoft.de`), Content `192.0.2.1` (Dummy-IP),
  **Proxy-Status: Proxied** (orange Wolke an)
- Falls du `www.custosoft.de` auch willst: gleicher Record, Name `www`

> Cloudflare ignoriert die Dummy-IP weil der Worker via Route triggert.
> Wichtig ist nur dass der Hostname in der Zone existiert UND proxied ist.

### 5. SSL-Modus prüfen

Cloudflare → custosoft.de → **SSL/TLS** → Mode auf **Full** oder **Full (strict)**
stellen. Das HTTPS-Zertifikat wird automatisch innerhalb von Minuten ausgestellt.

### 6. Mailadressen — wichtig vor dem NS-Wechsel!

Wenn du E-Mail über Strato laufen lässt (`@custosoft.de`-Postfächer),
übernehme **vor** dem Nameserver-Wechsel die MX- und SPF-Records 1:1 in
Cloudflare. Sonst kommen 2-12 Stunden lang keine Mails an.

Strato MX-Standard:
```
MX  10  mx00.kundenserver.de
MX  10  mx01.kundenserver.de
```

(In der Strato-Domainverwaltung → DNS-Verwaltung sehen, was bei dir steht,
und in Cloudflare DNS spiegeln. Cloudflare-Setup-Wizard zieht das meist
automatisch — trotzdem nochmal vergleichen.)

---

## Variante B — Domain bei Strato lassen, nur DNS-Record auf Worker

Falls du den Nameserver-Wechsel nicht willst (z.B. weil Strato auch dein
Mailprovider ist und du dem nicht trauen willst):

1. Cloudflare → **Workers & Pages** → custosoft-api → **Settings** →
   **Triggers** → **Custom Domains** → `custosoft.de` als „Custom Domain"
   verbinden
2. Cloudflare zeigt dir einen **CNAME-Wert** (z.B.
   `custosoft-api.davidschroedinger.workers.dev`)
3. Bei Strato → DNS-Verwaltung → für `custosoft.de` einen CNAME-Record auf
   den Worker setzen.

> ⚠️ Strato erlaubt CNAMEs auf Apex (root domain `custosoft.de`) **nicht**.
> Für root brauchst du einen ALIAS / ANAME / Flattening, das Strato nicht
> bietet. Daher: nur `www.custosoft.de` per CNAME geht — Apex wird scheitern.
> **Genau deshalb ist Variante A für dich besser.**

---

## TL;DR — was du jetzt klicken musst

1. Cloudflare → Add Site → custosoft.de → Free Plan → Records prüfen
2. Strato → Domainverwaltung → custosoft.de → Nameserver auf
   die zwei Cloudflare-NS umstellen
3. Warten bis Cloudflare-Mail „Zone Active" kommt
4. In `wrangler.toml` die `[[routes]]` einkommentieren →
   `npx wrangler deploy`
5. Cloudflare DNS → A-Record `@` auf Dummy `192.0.2.1` mit oranger
   Wolke. Optional `www` CNAME auf `custosoft.de`.

Danach öffnet `https://custosoft.de` deine Landing-Page direkt aus dem
Worker, mit kostenlosem Cloudflare-SSL.

---

## Bis dahin — wo läuft die Page?

- **Aktuell live**: https://custosoft-api.davidschroedinger.workers.dev/
- Diese URL bleibt funktionsfähig, du kannst sie jetzt schon teilen.
- Sobald der Domain-Wechsel durch ist, leitet `custosoft.de` direkt auf
  denselben Worker — ohne dass du iOS-App-URLs ändern musst (in
  `APIClient.swift` steht ja bereits `…workers.dev/api/v1`).
