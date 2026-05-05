// ── Web Admin UI — served at /admin ───────────────────────────────────────────
import { Hono }     from 'hono'
import type { Env } from '../types'

const webAdmin = new Hono<{ Bindings: Env }>()

webAdmin.get('/', (c) => c.html(ADMIN_HTML))

const ADMIN_HTML = `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>CustoSoft Admin</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { height: 100%; background: #0a0a14; color: #fff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; overflow-x: hidden; }
  body::before, body::after { content: ''; position: fixed; border-radius: 50%; filter: blur(60px); pointer-events: none; z-index: 0; }
  body::before { width: 480px; height: 480px; background: radial-gradient(circle, rgba(242,64,76,0.45), transparent 70%); top: -180px; left: -120px; animation: orb1 8s ease-in-out infinite alternate; }
  body::after { width: 360px; height: 360px; background: radial-gradient(circle, rgba(242,140,25,0.35), transparent 70%); top: -80px; right: -80px; animation: orb2 10s ease-in-out infinite alternate; }
  @keyframes orb1 { to { transform: translate(50px, 60px); } }
  @keyframes orb2 { to { transform: translate(-40px, 80px); } }
  .container { position: relative; z-index: 1; }

  /* Login */
  .login-screen { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; }
  .login-card { width: 100%; max-width: 420px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 24px; padding: 40px; backdrop-filter: blur(20px); box-shadow: 0 30px 80px rgba(0,0,0,0.5); }
  .login-card h1 { font-size: 32px; font-weight: 700; margin-bottom: 4px; background: linear-gradient(135deg, #ff6b5c, #ffaa3d); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
  .login-card .sub { color: rgba(255,255,255,0.5); font-size: 14px; margin-bottom: 28px; }
  .field { margin-bottom: 14px; }
  .field label { display: block; font-size: 12px; color: rgba(255,255,255,0.55); margin-bottom: 6px; font-weight: 600; }
  .field input, .field textarea, .field select { width: 100%; padding: 14px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12); border-radius: 12px; color: #fff; font-size: 15px; outline: none; transition: all 0.2s; font-family: inherit; resize: vertical; }
  .field textarea { min-height: 120px; }
  .field input:focus, .field textarea:focus, .field select:focus { background: rgba(255,255,255,0.10); border-color: rgba(242,64,76,0.55); box-shadow: 0 0 0 4px rgba(242,64,76,0.15); }
  .btn-primary { width: 100%; padding: 14px; background: linear-gradient(135deg, #f2404c, #f28c19); border: none; border-radius: 12px; color: #fff; font-size: 15px; font-weight: 600; cursor: pointer; margin-top: 10px; transition: transform 0.15s; box-shadow: 0 8px 24px rgba(242,64,76,0.4); }
  .btn-primary:hover { transform: translateY(-2px); }
  .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
  .err { background: rgba(255,80,80,0.15); border: 1px solid rgba(255,80,80,0.4); border-radius: 10px; padding: 10px 12px; font-size: 13px; color: #ff8a8a; margin-top: 12px; }

  /* Dashboard */
  .dashboard { display: none; min-height: 100vh; }
  .dashboard.active { display: flex; }
  .sidebar { width: 240px; background: rgba(255,255,255,0.04); border-right: 1px solid rgba(255,255,255,0.08); padding: 24px 12px; backdrop-filter: blur(20px); flex-shrink: 0; display: flex; flex-direction: column; }
  .sidebar .brand { display: flex; align-items: center; gap: 10px; padding: 0 12px 24px; margin-bottom: 12px; border-bottom: 1px solid rgba(255,255,255,0.08); }
  .sidebar .brand .logo { width: 36px; height: 36px; background: linear-gradient(135deg, #f2404c, #f28c19); border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 18px; }
  .sidebar .brand .name { font-size: 15px; font-weight: 700; }
  .sidebar .brand .role { font-size: 10px; color: rgba(255,255,255,0.4); }
  .sidebar nav { display: flex; flex-direction: column; gap: 3px; }
  .sidebar nav a { display: flex; align-items: center; gap: 10px; padding: 10px 14px; color: rgba(255,255,255,0.55); text-decoration: none; border-radius: 10px; font-size: 14px; font-weight: 500; cursor: pointer; transition: all 0.15s; }
  .sidebar nav a:hover { background: rgba(255,255,255,0.05); color: #fff; }
  .sidebar nav a.active { background: linear-gradient(135deg, rgba(242,64,76,0.25), rgba(242,140,25,0.15)); color: #fff; border: 1px solid rgba(242,64,76,0.3); }
  .sidebar .logout { margin-top: auto; padding-top: 12px; border-top: 1px solid rgba(255,255,255,0.08); }
  .sidebar .logout a { color: rgba(255,255,255,0.4); }

  .main { flex: 1; padding: 32px; overflow-x: auto; }
  .main h2 { font-size: 24px; font-weight: 700; margin-bottom: 6px; }
  .main h2 .count { font-size: 14px; color: rgba(255,255,255,0.4); font-weight: 500; margin-left: 8px; }
  .main .sub { color: rgba(255,255,255,0.45); font-size: 13px; margin-bottom: 16px; }

  /* KPIs */
  .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin: 24px 0; }
  .kpi { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.10); border-radius: 18px; padding: 18px; backdrop-filter: blur(10px); }
  .kpi .ico { font-size: 22px; margin-bottom: 12px; }
  .kpi .val { font-size: 28px; font-weight: 700; margin-bottom: 4px; font-variant-numeric: tabular-nums; }
  .kpi .lbl { font-size: 12px; color: rgba(255,255,255,0.5); }

  /* Tables */
  .toolbar { display: flex; gap: 10px; margin: 16px 0; align-items: center; flex-wrap: wrap; }
  .toolbar input[type=search] { flex: 1; max-width: 360px; padding: 10px 14px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.10); border-radius: 10px; color: #fff; font-size: 14px; outline: none; }
  .toolbar select { padding: 10px 14px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.10); border-radius: 10px; color: #fff; font-size: 13px; }
  .table-wrap { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 16px; overflow: hidden; backdrop-filter: blur(10px); }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; padding: 14px 18px; font-size: 11px; color: rgba(255,255,255,0.45); font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid rgba(255,255,255,0.08); }
  td { padding: 14px 18px; font-size: 14px; border-bottom: 1px solid rgba(255,255,255,0.05); vertical-align: middle; }
  tbody tr { cursor: pointer; }
  tbody tr:hover { background: rgba(255,255,255,0.03); }
  .pill { display: inline-block; padding: 3px 10px; border-radius: 999px; font-size: 11px; font-weight: 600; }
  .pill.priv { background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.6); }
  .pill.org { background: rgba(255,170,60,0.15); color: #ffb84a; }
  .pill.staff { background: rgba(140,80,255,0.15); color: #b894ff; }
  .pill.blocked { background: rgba(255,80,80,0.15); color: #ff7878; }
  .pill.active { background: rgba(80,220,140,0.15); color: #6ce69e; }

  .btn { padding: 7px 14px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; color: rgba(255,255,255,0.8); font-size: 12px; font-weight: 600; cursor: pointer; transition: all 0.15s; font-family: inherit; }
  .btn:hover { background: rgba(255,255,255,0.10); }
  .btn.danger { color: #ff7878; border-color: rgba(255,80,80,0.3); }
  .btn.danger:hover { background: rgba(255,80,80,0.12); }
  .btn.ok { color: #6ce69e; border-color: rgba(80,220,140,0.3); }
  .btn.ok:hover { background: rgba(80,220,140,0.12); }
  .btn.lg { padding: 11px 22px; font-size: 14px; border-radius: 10px; }

  .loading { text-align: center; padding: 40px; color: rgba(255,255,255,0.4); }
  .empty { text-align: center; padding: 40px; color: rgba(255,255,255,0.35); }
  .toast { position: fixed; bottom: 24px; right: 24px; padding: 12px 20px; background: rgba(20,20,30,0.95); border: 1px solid rgba(80,220,140,0.4); border-radius: 12px; font-size: 13px; z-index: 1000; }

  /* Modal/Drawer */
  .modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.6); backdrop-filter: blur(8px); z-index: 100; display: none; align-items: flex-start; justify-content: center; padding: 40px 20px; overflow-y: auto; }
  .modal-backdrop.show { display: flex; }
  .modal { background: linear-gradient(180deg, #1a1525 0%, #0a0a14 100%); border: 1px solid rgba(255,255,255,0.10); border-radius: 22px; padding: 28px; max-width: 720px; width: 100%; box-shadow: 0 40px 80px rgba(0,0,0,0.6); }
  .modal-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; padding-bottom: 14px; border-bottom: 1px solid rgba(255,255,255,0.08); }
  .modal-header h3 { font-size: 20px; font-weight: 700; }
  .modal .close { background: none; border: none; color: rgba(255,255,255,0.6); font-size: 24px; cursor: pointer; padding: 4px 10px; line-height: 1; }
  .modal-section { margin-bottom: 22px; }
  .modal-section-title { font-size: 11px; font-weight: 700; color: rgba(255,255,255,0.50); text-transform: uppercase; letter-spacing: 0.6px; margin-bottom: 10px; }
  .info-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.05); }
  .info-row .key { color: rgba(255,255,255,0.45); font-size: 13px; }
  .info-row .val { color: #fff; font-size: 13px; font-weight: 500; }
  .actions-row { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }

  @media (max-width: 768px) {
    .sidebar { width: 60px; padding: 12px 6px; }
    .sidebar .brand .name, .sidebar .brand .role, .sidebar nav a span { display: none; }
    .main { padding: 20px; }
    .modal { padding: 18px; max-height: 80vh; overflow-y: auto; }
  }
</style>
</head>
<body>
<div class="container">

  <!-- LOGIN -->
  <div id="loginScreen" class="login-screen">
    <div class="login-card">
      <h1>🛡️ CustoSoft</h1>
      <p class="sub">Verwaltungsbackend · Nur für Staff</p>
      <form id="loginForm">
        <div class="field"><label>E-Mail</label><input type="email" id="email" autocomplete="email" required></div>
        <div class="field"><label>Passwort</label><input type="password" id="password" autocomplete="current-password" required></div>
        <button type="submit" class="btn-primary" id="loginBtn">Anmelden</button>
        <div id="loginErr" class="err" style="display:none"></div>
      </form>
    </div>
  </div>

  <!-- DASHBOARD -->
  <div id="dashboard" class="dashboard">
    <aside class="sidebar">
      <div class="brand">
        <div class="logo">🛡️</div>
        <div><div class="name">CustoSoft</div><div class="role" id="userInfo">…</div></div>
      </div>
      <nav>
        <a data-tab="overview" class="active">📊 <span>Übersicht</span></a>
        <a data-tab="users">👥 <span>Nutzer</span></a>
        <a data-tab="orgs">🏢 <span>Organisationen</span></a>
        <a data-tab="licenses">🔑 <span>Lizenzen</span></a>
        <a data-tab="grants">🎁 <span>Manuelle Vergaben</span></a>
        <a data-tab="orders">💳 <span>Bestellungen</span></a>
        <a data-tab="notifications">🔔 <span>Benachrichtigungen</span></a>
        <a data-tab="emails">📧 <span>E-Mails</span></a>
        <a data-tab="legal">📜 <span>Rechtstexte</span></a>
        <a data-tab="staff">🛡️ <span>Staff &amp; SuperAdmin</span></a>
      </nav>
      <div class="logout"><a id="logoutBtn">🚪 <span>Abmelden</span></a></div>
    </aside>

    <main class="main">

      <!-- OVERVIEW -->
      <section data-section="overview">
        <h2>Übersicht</h2>
        <p class="sub">Dashboard mit Live-Statistiken aus der D1-Datenbank</p>
        <div class="kpis" id="kpis"></div>
        <h2 style="margin-top:32px">Extension-Nutzung</h2>
        <div class="table-wrap" style="margin-top:12px"><table id="extTable"><tbody></tbody></table></div>
      </section>

      <!-- USERS -->
      <section data-section="users" style="display:none">
        <h2>Nutzer <span class="count" id="usersCount"></span></h2>
        <div class="toolbar"><input type="search" id="userSearch" placeholder="Name oder E-Mail suchen…"></div>
        <div class="table-wrap"><table>
          <thead><tr><th>Name</th><th>E-Mail</th><th>Typ</th><th>Org</th><th>Extensions</th><th>Registriert</th></tr></thead>
          <tbody id="usersBody"></tbody>
        </table></div>
      </section>

      <!-- ORGS -->
      <section data-section="orgs" style="display:none">
        <h2>Organisationen <span class="count" id="orgsCount"></span></h2>
        <div class="toolbar"><input type="search" id="orgSearch" placeholder="Org suchen…"></div>
        <div class="table-wrap"><table>
          <thead><tr><th>Name</th><th>Owner</th><th>Mitglieder</th><th>Erstellt</th></tr></thead>
          <tbody id="orgsBody"></tbody>
        </table></div>
      </section>

      <!-- LICENSES -->
      <section data-section="licenses" style="display:none">
        <h2>Lizenzen <span class="count" id="licCount"></span></h2>
        <div class="toolbar">
          <input type="search" id="licSearch" placeholder="Suchen…">
          <select id="licFilter">
            <option value="all">Alle</option>
            <option value="active" selected>Nur aktive</option>
            <option value="expired">Nur abgelaufene</option>
          </select>
          <button class="btn ok" onclick="openGrantModal()">+ Lizenz vergeben</button>
        </div>
        <div class="table-wrap"><table>
          <thead><tr><th>Produkt</th><th>Nutzer</th><th>Quelle</th><th>Gekauft</th><th>Ablauf</th><th>Status</th><th></th></tr></thead>
          <tbody id="licBody"></tbody>
        </table></div>
      </section>

      <!-- GRANTS -->
      <section data-section="grants" style="display:none">
        <h2>Manuelle Vergaben <span class="count" id="grantsCount"></span></h2>
        <p class="sub">Audit-Log aller manuell vergebenen Lizenzen / Trial-Verlängerungen</p>
        <div class="table-wrap"><table>
          <thead><tr><th>Nutzer</th><th>Produkt</th><th>Vergeben von</th><th>Datum</th><th>Notiz</th><th></th></tr></thead>
          <tbody id="grantsBody"></tbody>
        </table></div>
      </section>

      <!-- ORDERS -->
      <section data-section="orders" style="display:none">
        <h2>Bestellungen <span class="count" id="ordersCount"></span></h2>
        <p class="sub">Read-only · Refunds laufen über Apple App Store Connect</p>
        <div class="table-wrap"><table>
          <thead><tr><th>Nutzer</th><th>Produkt</th><th>Preis</th><th>Datum</th><th>Status</th></tr></thead>
          <tbody id="ordersBody"></tbody>
        </table></div>
      </section>

      <!-- NOTIFICATIONS -->
      <section data-section="notifications" style="display:none">
        <h2>Benachrichtigungen <span class="count" id="notifCount"></span></h2>
        <p class="sub">Verlauf aller in-App-Benachrichtigungen die an Nutzer gesendet wurden</p>
        <div class="table-wrap"><table>
          <thead><tr><th>Empfänger</th><th>Titel</th><th>Inhalt</th><th>Typ</th><th>Datum</th></tr></thead>
          <tbody id="notifBody"></tbody>
        </table></div>
      </section>

      <!-- LEGAL -->
      <section data-section="legal" style="display:none">
        <h2>Rechtstexte</h2>
        <p class="sub">Datenschutzerklärung · AGB · Impressum (Apple-Pflicht)</p>
        <div id="legalList" style="display:flex;flex-direction:column;gap:12px;margin-top:16px"></div>
      </section>

      <!-- EMAILS -->
      <section data-section="emails" style="display:none">
        <h2>E-Mails</h2>
        <p class="sub">Versand-Log · Vorlagen · manueller Versand über taironic.media@gmail.com</p>

        <!-- Sub-Tabs: Logs · Vorlagen · Senden -->
        <div class="email-tabs" style="display:flex;gap:8px;margin:16px 0">
          <button class="btn email-tab active" data-emailtab="logs">📋 Versand-Log</button>
          <button class="btn email-tab" data-emailtab="templates">📝 Vorlagen</button>
          <button class="btn email-tab" data-emailtab="compose">✍️ Senden</button>
        </div>

        <!-- LOGS -->
        <div data-emailpanel="logs">
          <div class="toolbar" style="margin-bottom:12px">
            <input type="search" id="mailLogSearch" placeholder="Suchen (E-Mail, Betreff, Vorlage)…">
            <select id="mailLogStatus">
              <option value="">Alle</option>
              <option value="sent">Erfolgreich</option>
              <option value="failed">Fehlgeschlagen</option>
            </select>
            <button class="btn" onclick="loadMailLogs()">↻ Aktualisieren</button>
          </div>
          <div class="table-wrap"><table>
            <thead><tr>
              <th>Zeit</th><th>An</th><th>Betreff</th><th>Vorlage</th><th>Status</th><th>Fehler</th>
            </tr></thead>
            <tbody id="mailLogBody"></tbody>
          </table></div>
        </div>

        <!-- TEMPLATES -->
        <div data-emailpanel="templates" style="display:none">
          <div id="mailTemplatesList" style="display:flex;flex-direction:column;gap:10px"></div>
        </div>

        <!-- COMPOSE -->
        <div data-emailpanel="compose" style="display:none">
          <div style="display:grid;grid-template-columns: 1fr 1.4fr;gap:18px">
            <!-- Empfänger-Liste -->
            <div>
              <label class="lbl">Empfänger</label>
              <input type="search" id="mailRecipSearch" placeholder="Nutzer suchen…" style="margin:6px 0 8px">
              <div id="mailRecipList" style="height:380px;overflow-y:auto;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:6px"></div>
              <div style="margin-top:8px;font-size:11px;color:rgba(255,255,255,0.5)">
                <span id="mailRecipSelected">0</span> ausgewählt
              </div>
            </div>
            <!-- Editor + Vorschau -->
            <div>
              <label class="lbl">Betreff</label>
              <input type="text" id="mailSubject" placeholder="Betreff der Email" style="margin-top:6px">
              <label class="lbl" style="margin-top:12px">HTML-Inhalt <span style="color:rgba(255,255,255,0.4);font-weight:400">(Variablen: {{name}}, {{email}})</span></label>
              <textarea id="mailHtml" rows="12" placeholder="<p>Hallo {{name}},</p>" style="margin-top:6px;font-family:ui-monospace,monospace;font-size:12px"></textarea>
              <label class="lbl" style="margin-top:12px">Plain-Text-Fallback (optional)</label>
              <textarea id="mailText" rows="3" placeholder="Hallo {{name}}, …" style="margin-top:6px;font-family:ui-monospace,monospace;font-size:12px"></textarea>
              <div style="display:flex;gap:10px;margin-top:14px">
                <button class="btn" onclick="previewCompose()">👁 Vorschau</button>
                <button class="btn ok" onclick="sendCompose()">✉ Senden</button>
              </div>
              <div id="mailComposeStatus" style="margin-top:12px;font-size:13px"></div>
              <!-- Live-Vorschau -->
              <div style="margin-top:18px">
                <label class="lbl">Live-Vorschau</label>
                <iframe id="mailComposePreview" style="width:100%;height:340px;border:1px solid rgba(255,255,255,0.08);border-radius:10px;background:#fff;margin-top:6px"></iframe>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- STAFF & SUPERADMIN -->
      <section data-section="staff" style="display:none">
        <h2>Staff &amp; SuperAdmin <span class="count" id="staffCount"></span></h2>
        <p class="sub">Verwaltung der internen Mitarbeiter mit Backend-Zugriff. Promotion erfordert Master-Key.</p>
        <div class="toolbar">
          <button class="btn ok" onclick="openPromoteModal()">+ Neuen SuperAdmin/Staff erstellen</button>
        </div>
        <div class="table-wrap"><table>
          <thead><tr><th>Name</th><th>E-Mail</th><th>Rolle</th><th>Registriert</th><th>Letzter Login</th><th></th></tr></thead>
          <tbody id="staffBody"></tbody>
        </table></div>
      </section>

    </main>
  </div>

  <!-- USER DETAIL MODAL -->
  <div id="userModal" class="modal-backdrop"><div class="modal" id="userModalContent"></div></div>

  <!-- GRANT LICENSE MODAL -->
  <div id="grantModal" class="modal-backdrop">
    <div class="modal" style="max-width: 480px">
      <div class="modal-header"><h3>🎁 Lizenz vergeben</h3><button class="close" onclick="closeGrantModal()">×</button></div>
      <div class="field"><label>Nutzer-E-Mail</label><input type="email" id="grantEmail" placeholder="user@example.com"></div>
      <div class="field"><label>Produkt</label><select id="grantProduct">
        <option value="PunchClock">Stempeluhr (2,99 €/Woche)</option>
        <option value="MoreSpace">Mehr Platz (4,99 €)</option>
        <option value="Recruitment">Bewerbungsmanager (9,99 €)</option>
        <option value="TerminalMode">Wand-Stempeluhr (14,99 €)</option>
        <option value="BusinessBasic">Business Basic (49 €/Monat · 10 Slots)</option>
        <option value="BusinessBasicYearly">Business Basic Jährlich (469 €/Jahr · 10 Slots)</option>
        <option value="BusinessL">Business L (89 €/Monat · 50 Slots)</option>
        <option value="BusinessLYearly">Business L Jährlich (849 €/Jahr · 50 Slots)</option>
      </select></div>
      <button class="btn-primary" onclick="grantLicense()">Vergeben</button>
    </div>
  </div>

  <!-- LEGAL EDIT MODAL -->
  <div id="legalModal" class="modal-backdrop">
    <div class="modal">
      <div class="modal-header"><h3 id="legalEditTitle">Rechtstext bearbeiten</h3><button class="close" onclick="closeLegalModal()">×</button></div>
      <div class="field"><label>Titel</label><input type="text" id="legalEditTitleInput"></div>
      <div class="field"><label>Inhalt (HTML erlaubt)</label><textarea id="legalEditContent" rows="20" style="font-family:'SF Mono',Menlo,monospace;font-size:13px"></textarea></div>
      <button class="btn-primary" onclick="saveLegal()">Speichern</button>
    </div>
  </div>

  <!-- PROMOTE TO SUPERADMIN MODAL -->
  <div id="promoteModal" class="modal-backdrop">
    <div class="modal" style="max-width: 520px">
      <div class="modal-header"><h3>🛡️ SuperAdmin / Staff erstellen</h3><button class="close" onclick="closePromoteModal()">×</button></div>
      <div style="background:rgba(255,170,60,0.10);border:1px solid rgba(255,170,60,0.30);border-radius:12px;padding:14px;margin-bottom:18px;font-size:12px;color:rgba(255,255,255,0.75)">
        ⚠️ Diese Aktion gibt jemandem <strong>vollen Backend-Zugriff</strong>. Nur an Personen erteilen, die auch wirklich Staff sind. Master-Key wird benötigt.
      </div>
      <div class="field"><label>Nutzer-E-Mail (muss bereits registriert sein)</label><input type="email" id="promoteEmail" placeholder="user@example.com"></div>
      <div class="field"><label>Rolle</label><select id="promoteRole">
        <option value="SuperAdmin">SuperAdmin (alle Rechte)</option>
        <option value="Staff">Staff (Standard)</option>
      </select></div>
      <div class="field"><label>Master-Key</label><input type="password" id="promoteKey" placeholder="••••" autocomplete="off"></div>
      <button class="btn-primary" onclick="promoteSuperAdmin()">Befördern</button>
    </div>
  </div>

  <!-- NOTIFY MODAL -->
  <div id="notifyModal" class="modal-backdrop">
    <div class="modal" style="max-width: 480px">
      <div class="modal-header"><h3>🔔 Benachrichtigung senden</h3><button class="close" onclick="closeNotifyModal()">×</button></div>
      <div class="field"><label>Titel</label><input type="text" id="notifyTitle"></div>
      <div class="field"><label>Nachricht</label><textarea id="notifyBody" rows="5"></textarea></div>
      <button class="btn-primary" onclick="sendNotify()">Senden</button>
    </div>
  </div>

  <div id="toast" class="toast" style="display:none"></div>
</div>

<script>
const API = location.origin + '/api/v1'
let token = localStorage.getItem('admin_token') || null
let me = null
let currentUserId = null
let currentLegalSlug = null

// ── API Helper ──────────────────────────────────────────────
async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) }
  if (token) headers['Authorization'] = 'Bearer ' + token
  const res = await fetch(API + path, { ...opts, headers })
  const text = await res.text()
  let data
  try { data = JSON.parse(text) } catch { data = { error: text } }
  if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status))
  return data
}

function toast(msg) {
  const t = document.getElementById('toast')
  t.textContent = msg
  t.style.display = 'block'
  setTimeout(() => t.style.display = 'none', 2500)
}

function fmtDate(s) { try { return new Date(s).toLocaleDateString('de-DE') } catch { return '–' } }
function fmtDateTime(s) { try { return new Date(s).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) } catch { return '–' } }
function escHtml(s) { return String(s ?? '').replace(/[&<>"']/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])) }

// ── Login ───────────────────────────────────────────────────
document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault()
  const errEl = document.getElementById('loginErr')
  const btn = document.getElementById('loginBtn')
  errEl.style.display = 'none'
  btn.disabled = true; btn.textContent = '…'
  try {
    const data = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email: document.getElementById('email').value,
        password: document.getElementById('password').value,
      })
    })
    if (!data.user.appRole) throw new Error('Du hast keine Admin-Rechte. Nur Staff/SuperAdmin können sich hier anmelden.')
    token = data.accessToken; me = data.user
    localStorage.setItem('admin_token', token)
    showDashboard()
  } catch (err) {
    errEl.textContent = err.message; errEl.style.display = 'block'
  } finally { btn.disabled = false; btn.textContent = 'Anmelden' }
})

document.getElementById('logoutBtn').addEventListener('click', () => {
  localStorage.removeItem('admin_token')
  token = null; me = null
  document.getElementById('dashboard').classList.remove('active')
  document.getElementById('loginScreen').style.display = 'flex'
})

async function showDashboard() {
  document.getElementById('loginScreen').style.display = 'none'
  document.getElementById('dashboard').classList.add('active')
  if (!me) {
    try { me = await api('/auth/me') } catch { return document.getElementById('logoutBtn').click() }
  }
  document.getElementById('userInfo').textContent = (me.appRole || '?') + ' · ' + me.email
  loadOverview()
}

// ── Tabs ────────────────────────────────────────────────────
document.querySelectorAll('.sidebar nav a').forEach(a => {
  a.addEventListener('click', () => {
    document.querySelectorAll('.sidebar nav a').forEach(x => x.classList.remove('active'))
    a.classList.add('active')
    const tab = a.dataset.tab
    document.querySelectorAll('[data-section]').forEach(s => s.style.display = s.dataset.section === tab ? '' : 'none')
    if (tab === 'overview')      loadOverview()
    else if (tab === 'users')    loadUsers()
    else if (tab === 'orgs')     loadOrgs()
    else if (tab === 'licenses') loadLicenses()
    else if (tab === 'grants')   loadGrants()
    else if (tab === 'orders')   loadOrders()
    else if (tab === 'notifications') loadNotifications()
    else if (tab === 'emails')   onEmailsTabOpen()
    else if (tab === 'legal')    loadLegal()
    else if (tab === 'staff')    loadStaff()
  })
})

// ════════════════════════════════════════════════════════════════════════
// E-MAIL-SYSTEM (Logs · Vorlagen · Senden)
// ════════════════════════════════════════════════════════════════════════

let emailUsersCache = []   // cached list of users for the recipient picker
let emailSelectedIds = new Set()

function onEmailsTabOpen() {
  // Sub-tab handlers (idempotent — bind once)
  document.querySelectorAll('.email-tab').forEach(b => {
    if (b._wired) return
    b._wired = true
    b.addEventListener('click', () => {
      document.querySelectorAll('.email-tab').forEach(x => x.classList.remove('active'))
      b.classList.add('active')
      const which = b.dataset.emailtab
      document.querySelectorAll('[data-emailpanel]').forEach(p =>
        p.style.display = p.dataset.emailpanel === which ? '' : 'none'
      )
      if (which === 'logs')      loadMailLogs()
      if (which === 'templates') loadMailTemplates()
      if (which === 'compose')   loadComposeRecipients()
    })
  })
  // Default: Logs
  loadMailLogs()
}

// ── Versand-Log ─────────────────────────────────────────────────────────
async function loadMailLogs() {
  const tbody = document.getElementById('mailLogBody')
  tbody.innerHTML = '<tr><td colspan="6" class="loading">Lade…</td></tr>'
  const q      = document.getElementById('mailLogSearch')?.value ?? ''
  const status = document.getElementById('mailLogStatus')?.value ?? ''
  const params = new URLSearchParams()
  if (q) params.set('q', q)
  if (status) params.set('status', status)
  try {
    const r = await api('/admin/mail-logs?' + params.toString())
    const items = r.items || []
    if (!items.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="muted">Noch keine Mails versendet.</td></tr>'
      return
    }
    tbody.innerHTML = items.map(m => {
      const time = new Date(m.sent_at).toLocaleString('de-DE')
      const statusBadge = m.status === 'sent'
        ? '<span style="color:#3FE07A">✓ ok</span>'
        : '<span style="color:#FF6B6B">✗ fail</span>'
      const err = m.error_message ? '<span style="color:rgba(255,107,107,0.85);font-size:11px">' + esc(m.error_message.slice(0, 80)) + '</span>' : ''
      return '<tr>'
        + '<td style="font-size:11px">' + time + '</td>'
        + '<td>' + esc(m.to_email) + (m.to_name ? ' <span class="muted">(' + esc(m.to_name) + ')</span>' : '') + '</td>'
        + '<td>' + esc(m.subject ?? '—') + '</td>'
        + '<td><code style="font-size:11px">' + esc(m.template_key ?? '—') + '</code></td>'
        + '<td>' + statusBadge + '</td>'
        + '<td>' + err + '</td>'
        + '</tr>'
    }).join('')
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="6" class="err">Fehler: ' + esc(e.message) + '</td></tr>'
  }
}

// Debounced search re-trigger
document.addEventListener('input', e => {
  if (e.target?.id === 'mailLogSearch') {
    clearTimeout(window._mailLogTimer)
    window._mailLogTimer = setTimeout(loadMailLogs, 300)
  }
  if (e.target?.id === 'mailLogStatus') loadMailLogs()
  if (e.target?.id === 'mailRecipSearch') filterRecipients()
})

// ── Vorlagen-Liste + Editor ─────────────────────────────────────────────
async function loadMailTemplates() {
  const list = document.getElementById('mailTemplatesList')
  list.innerHTML = '<div class="loading">Lade Vorlagen…</div>'
  try {
    const r = await api('/admin/mail-templates')
    list.innerHTML = (r.items || []).map(t => {
      const badge = t.hasOverride
        ? '<span style="background:rgba(63,224,122,0.2);color:#3FE07A;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:600">ÜBERSCHRIEBEN</span>'
        : '<span style="background:rgba(255,255,255,0.1);color:rgba(255,255,255,0.55);padding:2px 8px;border-radius:4px;font-size:10px;font-weight:600">DEFAULT</span>'
      const updated = t.updatedAt ? '<span class="muted" style="font-size:11px">zuletzt: ' + new Date(t.updatedAt).toLocaleString('de-DE') + '</span>' : ''
      return '<div class="card" style="display:flex;align-items:center;gap:14px;padding:14px 16px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:12px">'
        + '<div style="flex:1">'
        +   '<div style="font-size:14px;font-weight:600">' + esc(t.name) + ' ' + badge + '</div>'
        +   '<div class="muted" style="font-size:11px;margin-top:2px"><code>' + esc(t.key) + '</code> · Variablen: ' + esc(t.placeholders) + '</div>'
        +   updated
        + '</div>'
        + '<button class="btn" onclick="openTemplateEditor(\\'' + esc(t.key) + '\\')">Bearbeiten</button>'
        + '</div>'
    }).join('')
  } catch (e) {
    list.innerHTML = '<div class="err">Fehler: ' + esc(e.message) + '</div>'
  }
}

async function openTemplateEditor(key) {
  try {
    const t = await api('/admin/mail-templates/' + encodeURIComponent(key))
    const cur = t.override || t.default
    showTemplateModal(t, cur)
  } catch (e) {
    alert('Fehler: ' + e.message)
  }
}

function showTemplateModal(t, cur) {
  const wrap = document.getElementById('genericModal') || (() => {
    const div = document.createElement('div')
    div.id = 'genericModal'
    div.className = 'modal'
    document.body.appendChild(div)
    return div
  })()
  wrap.innerHTML =
    '<div class="modal-content" style="max-width:1100px;width:96vw;height:88vh;display:flex;flex-direction:column">'
    + '<div class="modal-head"><h3>📝 ' + esc(t.name) + ' <code style="font-size:12px;color:rgba(255,255,255,0.4)">' + esc(t.key) + '</code></h3>'
    +   '<button class="close" onclick="closeTemplateModal()">×</button>'
    + '</div>'
    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;flex:1;overflow:hidden;padding:0 18px 18px">'
    + '  <div style="display:flex;flex-direction:column;overflow:hidden">'
    + '    <label class="lbl">Betreff</label>'
    + '    <input type="text" id="tplSubject" style="margin:6px 0 12px" value="' + escAttr(cur.subject) + '">'
    + '    <label class="lbl">HTML <span class="muted" style="font-weight:400">— Variablen: ' + esc(t.placeholders) + '</span></label>'
    + '    <textarea id="tplHtml" style="flex:1;font-family:ui-monospace,monospace;font-size:11px;margin-top:6px">' + esc(cur.html) + '</textarea>'
    + '    <label class="lbl" style="margin-top:10px">Plain-Text</label>'
    + '    <textarea id="tplText" style="height:80px;font-family:ui-monospace,monospace;font-size:11px;margin-top:6px">' + esc(cur.text || '') + '</textarea>'
    + '    <div style="display:flex;gap:8px;margin-top:12px">'
    + '      <button class="btn" onclick="refreshTemplatePreview()">↻ Vorschau aktualisieren</button>'
    + '      <button class="btn ok" onclick="saveTemplateEdit(\\'' + esc(t.key) + '\\')">Speichern</button>'
    +        (cur === t.override ? '<button class="btn err" onclick="resetTemplate(\\'' + esc(t.key) + '\\')">Auf Default zurück</button>' : '')
    + '    </div>'
    + '    <div id="tplStatus" style="margin-top:8px;font-size:12px"></div>'
    + '  </div>'
    + '  <div style="display:flex;flex-direction:column;overflow:hidden">'
    + '    <label class="lbl">Live-Vorschau (mit Test-Daten)</label>'
    + '    <iframe id="tplPreview" style="flex:1;width:100%;border:1px solid rgba(255,255,255,0.08);border-radius:10px;background:#fff;margin-top:6px"></iframe>'
    + '  </div>'
    + '</div>'
    + '</div>'
  wrap.style.display = 'flex'
  refreshTemplatePreview()
}

function closeTemplateModal() {
  const m = document.getElementById('genericModal')
  if (m) m.style.display = 'none'
}

async function refreshTemplatePreview() {
  const iframe = document.getElementById('tplPreview')
  const subject = document.getElementById('tplSubject').value
  const html    = document.getElementById('tplHtml').value
  const text    = document.getElementById('tplText').value
  // POST an Backend → erhalten gefüllten Inhalt
  // (Backend rendert Test-Daten in {{name}}, {{code}} etc.)
  const wrap = '<!DOCTYPE html><html><head><style>body{margin:0;font-family:-apple-system,sans-serif}</style></head><body>' + html + '</body></html>'
  // Einfacher Client-Fill — zeigt sofort, kein Server-Roundtrip nötig
  const testVars = { name: 'Anna Müller', code: '123456', newEmail: 'neu@bsp.de', productName: 'Stempeluhr', price: '3,99 €/Monat', daysRemaining: '7', expiresAt: '2026-12-31', email: 'anna@beispiel.de' }
  const filled = wrap.replace(/\\{\\{(\\w+)\\}\\}/g, (_, k) => testVars[k] ?? '')
  iframe.srcdoc = filled
  document.title = 'Vorschau: ' + (subject || '(kein Betreff)')
}

async function saveTemplateEdit(key) {
  const subject = document.getElementById('tplSubject').value.trim()
  const html    = document.getElementById('tplHtml').value
  const text    = document.getElementById('tplText').value.trim()
  const status = document.getElementById('tplStatus')
  if (!subject || !html) { status.textContent = '❌ Betreff + HTML sind Pflicht.'; status.style.color='#FF6B6B'; return }
  try {
    await api('/admin/mail-templates/' + encodeURIComponent(key), { method: 'PUT', body: JSON.stringify({ subject, html, text }) })
    status.textContent = '✅ Gespeichert.'
    status.style.color = '#3FE07A'
    loadMailTemplates()
  } catch (e) {
    status.textContent = '❌ ' + e.message
    status.style.color = '#FF6B6B'
  }
}

async function resetTemplate(key) {
  if (!confirm('Override löschen — Default-Vorlage greift wieder?')) return
  try {
    await api('/admin/mail-templates/' + encodeURIComponent(key), { method: 'DELETE' })
    closeTemplateModal()
    loadMailTemplates()
  } catch (e) { alert(e.message) }
}

// Live-Refresh-Vorschau bei Tipp-Änderung
document.addEventListener('input', e => {
  if (['tplSubject','tplHtml','tplText'].includes(e.target?.id)) {
    clearTimeout(window._tplTimer)
    window._tplTimer = setTimeout(refreshTemplatePreview, 250)
  }
  if (['mailHtml','mailSubject','mailText'].includes(e.target?.id)) {
    clearTimeout(window._composeTimer)
    window._composeTimer = setTimeout(previewCompose, 350)
  }
})

// ── Compose / Manueller Versand ─────────────────────────────────────────
async function loadComposeRecipients() {
  if (emailUsersCache.length) { renderRecipients(emailUsersCache); return }
  const list = document.getElementById('mailRecipList')
  list.innerHTML = '<div class="loading">Lade Nutzer…</div>'
  try {
    const r = await api('/admin/users?limit=500')
    emailUsersCache = (r.items || []).filter(u => u.email)
    renderRecipients(emailUsersCache)
  } catch (e) {
    list.innerHTML = '<div class="err">Fehler: ' + esc(e.message) + '</div>'
  }
}

function filterRecipients() {
  const q = document.getElementById('mailRecipSearch').value.toLowerCase().trim()
  const filtered = q
    ? emailUsersCache.filter(u =>
        (u.email || '').toLowerCase().includes(q) ||
        (u.displayName || '').toLowerCase().includes(q))
    : emailUsersCache
  renderRecipients(filtered)
}

function renderRecipients(users) {
  const list = document.getElementById('mailRecipList')
  list.innerHTML = users.map(u => {
    const checked = emailSelectedIds.has(u.id) ? 'checked' : ''
    return '<label style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:6px;cursor:pointer">'
      + '<input type="checkbox" data-uid="' + esc(u.id) + '" ' + checked + ' onchange="toggleRecip(this)">'
      + '<div style="flex:1;min-width:0">'
      +   '<div style="font-size:13px;font-weight:500">' + esc(u.displayName || u.email) + '</div>'
      +   '<div class="muted" style="font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(u.email) + '</div>'
      + '</div></label>'
  }).join('') || '<div class="muted" style="padding:14px;text-align:center">Keine Nutzer gefunden.</div>'
  updateRecipCount()
}

function toggleRecip(el) {
  if (el.checked) emailSelectedIds.add(el.dataset.uid)
  else emailSelectedIds.delete(el.dataset.uid)
  updateRecipCount()
}

function updateRecipCount() {
  const el = document.getElementById('mailRecipSelected')
  if (el) el.textContent = emailSelectedIds.size
}

function previewCompose() {
  const iframe = document.getElementById('mailComposePreview')
  if (!iframe) return
  const html = document.getElementById('mailHtml').value
  const wrap = '<!DOCTYPE html><html><head><style>body{margin:0;font-family:-apple-system,sans-serif}</style></head><body>' + html + '</body></html>'
  const testVars = { name: 'Anna Müller', email: 'anna@beispiel.de' }
  const filled = wrap.replace(/\\{\\{(\\w+)\\}\\}/g, (_, k) => testVars[k] ?? '')
  iframe.srcdoc = filled
}

async function sendCompose() {
  const subject = document.getElementById('mailSubject').value.trim()
  const html    = document.getElementById('mailHtml').value.trim()
  const text    = document.getElementById('mailText').value.trim()
  const status  = document.getElementById('mailComposeStatus')
  status.textContent = ''
  if (!subject || !html) { status.innerHTML = '<span class="err">Betreff und HTML sind Pflicht.</span>'; return }
  if (!emailSelectedIds.size) { status.innerHTML = '<span class="err">Mindestens einen Empfänger wählen.</span>'; return }
  if (!confirm('Email an ' + emailSelectedIds.size + ' Nutzer schicken?')) return
  status.innerHTML = '<span class="muted">Sende…</span>'
  try {
    const r = await api('/admin/mail-send', { method: 'POST', body: JSON.stringify({
      userIds: Array.from(emailSelectedIds),
      subject, html, text: text || undefined,
    })})
    status.innerHTML = '<span class="ok">✅ ' + r.sent + ' versendet'
      + (r.failed ? ', <span class="err">' + r.failed + ' fehlgeschlagen</span>' : '')
      + ' (gesamt ' + r.total + ')</span>'
  } catch (e) {
    status.innerHTML = '<span class="err">❌ ' + esc(e.message) + '</span>'
  }
}

// ── Helpers (escapen) ────────────────────────────────────────────────
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]))
}
function escAttr(s) {
  return esc(s).replace(/\\n/g, '&#10;')
}

// ── Staff & SuperAdmin ──────────────────────────────────────────────
async function loadStaff() {
  document.getElementById('staffBody').innerHTML = '<tr><td colspan="6" class="loading">Lade…</td></tr>'
  try {
    const r = await api('/admin/staff-list')
    const items = r.items || []
    document.getElementById('staffCount').textContent = '(' + items.length + ')'
    const tb = document.getElementById('staffBody')
    if (!items.length) { tb.innerHTML = '<tr><td colspan="6" class="empty">Keine Staff vorhanden</td></tr>'; return }
    tb.innerHTML = items.map(s => {
      const roleClass = s.role === 'SuperAdmin' ? 'staff' : 'priv'
      return '<tr><td><strong>' + escHtml(s.displayName) + '</strong></td>' +
        '<td style="color:rgba(255,255,255,0.65);font-size:13px">' + escHtml(s.email) + '</td>' +
        '<td><span class="pill ' + roleClass + '">' + escHtml(s.role) + '</span></td>' +
        '<td style="font-size:12px">' + fmtDate(s.registeredAt) + '</td>' +
        '<td style="font-size:12px">' + (s.lastLoginAt ? fmtDateTime(s.lastLoginAt) : '–') + '</td>' +
        '<td>' + (s.id !== me.id ? '<button class="btn danger" onclick="demoteSuperAdmin(\\''+ s.id +'\\')">Entfernen</button>' : '<span style="color:rgba(255,255,255,0.30);font-size:11px">Du selbst</span>') + '</td></tr>'
    }).join('')
  } catch (e) { document.getElementById('staffBody').innerHTML = '<tr><td colspan="6" class="empty">' + escHtml(e.message) + '</td></tr>' }
}

function openPromoteModal() {
  document.getElementById('promoteEmail').value = ''
  document.getElementById('promoteKey').value = ''
  document.getElementById('promoteRole').value = 'SuperAdmin'
  document.getElementById('promoteModal').classList.add('show')
}
function closePromoteModal() { document.getElementById('promoteModal').classList.remove('show') }
document.getElementById('promoteModal').addEventListener('click', e => { if (e.target.id === 'promoteModal') closePromoteModal() })

async function promoteSuperAdmin() {
  const userEmail = document.getElementById('promoteEmail').value.trim()
  const role      = document.getElementById('promoteRole').value
  const masterKey = document.getElementById('promoteKey').value
  if (!userEmail || !masterKey) { toast('Email + Master-Key sind Pflicht'); return }
  try {
    const r = await api('/admin/promote-superadmin', {
      method: 'POST',
      body: JSON.stringify({ userEmail, role, masterKey })
    })
    toast(r.email + ' ist jetzt ' + r.newRole)
    closePromoteModal()
    loadStaff()
  } catch (e) {
    toast('Fehler: ' + e.message)
  }
}

async function demoteSuperAdmin(userId) {
  const masterKey = prompt('Master-Key eingeben um SuperAdmin-Rechte zu entziehen:')
  if (!masterKey) return
  try {
    await api('/admin/demote-superadmin', {
      method: 'POST',
      body: JSON.stringify({ userId, masterKey })
    })
    toast('Rechte entzogen')
    loadStaff()
  } catch (e) { toast('Fehler: ' + e.message) }
}

// ── Overview ────────────────────────────────────────────────
async function loadOverview() {
  try {
    const stats = await api('/admin/stats')
    document.getElementById('kpis').innerHTML = [
      { ico: '👥', val: stats.totalUsers, lbl: 'Nutzer gesamt' },
      { ico: '✅', val: stats.activeUsers30Days, lbl: 'Aktiv (30 Tage)' },
      { ico: '🏢', val: stats.totalOrgs, lbl: 'Organisationen' },
      { ico: '€', val: stats.mrrFormatted, lbl: 'MRR' },
      { ico: '🆕', val: stats.newUsersThisMonth || 0, lbl: 'Neue Nutzer (Monat)' },
      { ico: '🏗', val: stats.newOrgsThisMonth || 0, lbl: 'Neue Orgs (Monat)' },
    ].map(k => '<div class="kpi"><div class="ico">' + k.ico + '</div><div class="val">' + k.val + '</div><div class="lbl">' + k.lbl + '</div></div>').join('')
    const ext = stats.extensionBreakdown || {}
    const tbody = document.querySelector('#extTable tbody')
    tbody.innerHTML = Object.entries(ext).sort((a,b) => b[1]-a[1]).map(([k,v]) =>
      '<tr><td>' + escHtml(k) + '</td><td style="text-align:right;font-weight:600">' + v + '</td></tr>'
    ).join('') || '<tr><td colspan="2" class="empty">Keine Daten</td></tr>'
  } catch (e) { toast('Fehler: ' + e.message) }
}

// ── Users ───────────────────────────────────────────────────
let allUsers = []
async function loadUsers() {
  document.getElementById('usersBody').innerHTML = '<tr><td colspan="6" class="loading">Lade…</td></tr>'
  try {
    const r = await api('/admin/users?pageSize=200')
    allUsers = r.items || []
    document.getElementById('usersCount').textContent = '(' + allUsers.length + ')'
    renderUsers(allUsers)
  } catch (e) { document.getElementById('usersBody').innerHTML = '<tr><td colspan="6" class="empty">' + escHtml(e.message) + '</td></tr>' }
}
function renderUsers(users) {
  const tb = document.getElementById('usersBody')
  if (!users.length) { tb.innerHTML = '<tr><td colspan="6" class="empty">Keine Nutzer</td></tr>'; return }
  tb.innerHTML = users.map(u => {
    const typPill = u.accountType === 'Organisation' ? '<span class="pill org">Org</span>' : '<span class="pill priv">Privat</span>'
    const role = u.appRole ? '<span class="pill staff">' + u.appRole + '</span>' : ''
    const blocked = u.isBlocked ? '<span class="pill blocked">Gesperrt</span>' : ''
    const exts = (u.activeExtensions || []).map(e => '<span class="pill priv" style="margin-right:2px">' + escHtml(e) + '</span>').join('')
    return '<tr onclick="openUserModal(\\''+ u.id +'\\')"><td>' + escHtml(u.displayName) + ' ' + role + ' ' + blocked + '</td>' +
      '<td style="color:rgba(255,255,255,0.6);font-size:13px">' + escHtml(u.email) + '</td>' +
      '<td>' + typPill + '</td>' +
      '<td>' + (u.orgId || '–') + '</td>' +
      '<td>' + exts + '</td>' +
      '<td style="color:rgba(255,255,255,0.5);font-size:12px">' + fmtDate(u.registeredAt) + '</td></tr>'
  }).join('')
}
document.getElementById('userSearch').addEventListener('input', e => {
  const q = e.target.value.toLowerCase()
  renderUsers(allUsers.filter(u =>
    u.email.toLowerCase().includes(q) || (u.displayName||'').toLowerCase().includes(q)
  ))
})

// ── User Detail Modal ──────────────────────────────────────
async function openUserModal(userId) {
  currentUserId = userId
  const modal = document.getElementById('userModal')
  modal.classList.add('show')
  document.getElementById('userModalContent').innerHTML = '<div class="loading">Lade…</div>'
  try {
    const data = await api('/admin/users/' + userId + '/full')
    renderUserModal(data)
  } catch (e) {
    document.getElementById('userModalContent').innerHTML = '<div class="err">' + escHtml(e.message) + '</div>'
  }
}
function closeUserModal() { document.getElementById('userModal').classList.remove('show'); currentUserId = null }
document.getElementById('userModal').addEventListener('click', e => { if (e.target.id === 'userModal') closeUserModal() })

function renderUserModal(data) {
  const u = data.user
  const exts = data.extensions || []
  const grants = data.managedGrants || []
  const notifs = data.notifications || []
  const orders = data.orders || []

  const blockBtn = u.isBlocked
    ? '<button class="btn ok" onclick="toggleBlock(true)">Entsperren</button>'
    : '<button class="btn danger" onclick="toggleBlock(false)">Sperren</button>'

  document.getElementById('userModalContent').innerHTML =
    '<div class="modal-header"><h3>' + escHtml(u.displayName) + '</h3>' +
    '<button class="close" onclick="closeUserModal()">×</button></div>' +

    '<div class="modal-section"><div class="modal-section-title">Profil</div>' +
    '<div class="info-row"><span class="key">E-Mail</span><span class="val">' + escHtml(u.email) + '</span></div>' +
    '<div class="info-row"><span class="key">Konto-Typ</span><span class="val">' + (u.accountType === 'Organisation' ? 'Organisation' : 'Privat') + '</span></div>' +
    '<div class="info-row"><span class="key">App-Rolle</span><span class="val">' + (u.appRole || '–') + '</span></div>' +
    '<div class="info-row"><span class="key">Org-ID</span><span class="val">' + (u.orgId || '–') + '</span></div>' +
    '<div class="info-row"><span class="key">Org-Rolle</span><span class="val">' + (u.orgRole || '–') + '</span></div>' +
    '<div class="info-row"><span class="key">Email bestätigt</span><span class="val">' + (u.emailConfirmed ? '✓' : '✗') + '</span></div>' +
    '<div class="info-row"><span class="key">Registriert</span><span class="val">' + fmtDate(u.registeredAt) + '</span></div>' +
    '<div class="info-row"><span class="key">Letzter Login</span><span class="val">' + (u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : '–') + '</span></div>' +
    '<div class="info-row"><span class="key">Status</span><span class="val">' + (u.isBlocked ? '<span class="pill blocked">Gesperrt</span>' : '<span class="pill active">Aktiv</span>') + '</span></div>' +
    '</div>' +

    '<div class="modal-section"><div class="modal-section-title">Extensions (' + exts.length + ')</div>' +
    (exts.length ? exts.map(e =>
      '<div class="info-row"><span class="val">' + escHtml(e.product) + ' <span class="pill ' + (e.is_active ? 'active' : 'priv') + '">' + (e.is_active ? 'aktiv' : 'inaktiv') + '</span></span>' +
      '<span class="key">' + (e.granted_via || '?') + ' · ' + fmtDate(e.purchased_at) + '</span></div>'
    ).join('') : '<div style="color:rgba(255,255,255,0.4);font-size:13px;padding:8px">Keine Extensions</div>') + '</div>' +

    '<div class="modal-section"><div class="modal-section-title">Aktionen</div>' +
    '<div class="actions-row">' +
      blockBtn +
      '<button class="btn ok" onclick="openGrantTrialPrompt()">+ Trial vergeben</button>' +
      '<button class="btn" onclick="openNotifyModal()">🔔 Benachrichtigung senden</button>' +
      '<button class="btn danger" onclick="deleteUser()">Account löschen</button>' +
    '</div></div>' +

    '<div class="modal-section"><div class="modal-section-title">Manuelle Vergaben (' + grants.length + ')</div>' +
    (grants.length ? grants.map(g =>
      '<div class="info-row"><span class="val">' + escHtml(g.product) + '</span>' +
      '<span class="key">' + fmtDate(g.granted_at) + ' — ' + escHtml(g.note || '') + '</span></div>'
    ).join('') : '<div style="color:rgba(255,255,255,0.4);font-size:13px;padding:8px">Keine</div>') + '</div>' +

    '<div class="modal-section"><div class="modal-section-title">Bestellungen (' + orders.length + ')</div>' +
    (orders.length ? orders.map(o =>
      '<div class="info-row"><span class="val">' + escHtml(o.product_name) + ' · ' + escHtml(o.price_paid || '') + '</span>' +
      '<span class="key">' + fmtDate(o.purchased_at) + '</span></div>'
    ).join('') : '<div style="color:rgba(255,255,255,0.4);font-size:13px;padding:8px">Keine</div>') + '</div>'
}

async function toggleBlock(unblock) {
  try {
    await api('/admin/users/' + currentUserId + '/block?action=' + (unblock ? 'unblock' : 'block'),
      { method: 'POST', body: '{}' })
    toast(unblock ? 'Entsperrt' : 'Gesperrt')
    openUserModal(currentUserId); loadUsers()
  } catch (e) { toast('Fehler: ' + e.message) }
}

async function deleteUser() {
  if (!confirm('Account WIRKLICH löschen? Alle Daten gehen verloren!')) return
  try {
    await api('/admin/users/' + currentUserId, { method: 'DELETE' })
    toast('Account gelöscht'); closeUserModal(); loadUsers()
  } catch (e) { toast('Fehler: ' + e.message) }
}

function openGrantTrialPrompt() {
  const product = prompt('Welches Produkt? (GroupChat, PunchClock, FileSystem, Business, MoreSpace, Recruitment, TerminalMode)')
  if (!product) return
  const days = parseInt(prompt('Wie viele Tage Trial?') || '14')
  if (!days || days < 1) return
  api('/admin/users/' + currentUserId + '/grant-trial',
    { method: 'POST', body: JSON.stringify({ product, days }) })
    .then(() => { toast(days + ' Tage Trial vergeben'); openUserModal(currentUserId) })
    .catch(e => toast('Fehler: ' + e.message))
}

// ── Notify Modal ────────────────────────────────────────────
function openNotifyModal() {
  document.getElementById('notifyTitle').value = ''
  document.getElementById('notifyBody').value = ''
  document.getElementById('notifyModal').classList.add('show')
}
function closeNotifyModal() { document.getElementById('notifyModal').classList.remove('show') }
document.getElementById('notifyModal').addEventListener('click', e => { if (e.target.id === 'notifyModal') closeNotifyModal() })
async function sendNotify() {
  const title = document.getElementById('notifyTitle').value
  const body = document.getElementById('notifyBody').value
  if (!title) { toast('Titel fehlt'); return }
  try {
    await api('/admin/users/' + currentUserId + '/notify',
      { method: 'POST', body: JSON.stringify({ title, body }) })
    toast('Benachrichtigung gesendet'); closeNotifyModal()
  } catch (e) { toast('Fehler: ' + e.message) }
}

// ── Orgs ────────────────────────────────────────────────────
let allOrgs = []
async function loadOrgs() {
  document.getElementById('orgsBody').innerHTML = '<tr><td colspan="4" class="loading">Lade…</td></tr>'
  try {
    const r = await api('/admin/orgs?pageSize=200')
    allOrgs = r.items || []
    document.getElementById('orgsCount').textContent = '(' + allOrgs.length + ')'
    renderOrgs(allOrgs)
  } catch (e) { document.getElementById('orgsBody').innerHTML = '<tr><td colspan="4" class="empty">' + escHtml(e.message) + '</td></tr>' }
}
function renderOrgs(orgs) {
  const tb = document.getElementById('orgsBody')
  if (!orgs.length) { tb.innerHTML = '<tr><td colspan="4" class="empty">Keine Orgs</td></tr>'; return }
  tb.innerHTML = orgs.map(o =>
    '<tr><td><strong>' + escHtml(o.name) + '</strong></td>' +
    '<td style="color:rgba(255,255,255,0.6);font-size:13px">' + escHtml(o.ownerEmail || '–') + '</td>' +
    '<td>' + (o.memberCount || 0) + '</td>' +
    '<td style="color:rgba(255,255,255,0.5);font-size:12px">' + fmtDate(o.createdAt) + '</td></tr>'
  ).join('')
}
document.getElementById('orgSearch').addEventListener('input', e => {
  const q = e.target.value.toLowerCase()
  renderOrgs(allOrgs.filter(o => o.name.toLowerCase().includes(q) || (o.ownerEmail||'').toLowerCase().includes(q)))
})

// ── Licenses ────────────────────────────────────────────────
let allLics = []
async function loadLicenses() {
  document.getElementById('licBody').innerHTML = '<tr><td colspan="7" class="loading">Lade…</td></tr>'
  try {
    const filter = document.getElementById('licFilter').value
    const r = await api('/admin/licenses?pageSize=200&filter=' + filter)
    allLics = r.items || []
    document.getElementById('licCount').textContent = '(' + allLics.length + ')'
    renderLics(allLics)
  } catch (e) { document.getElementById('licBody').innerHTML = '<tr><td colspan="7" class="empty">' + escHtml(e.message) + '</td></tr>' }
}
function renderLics(lics) {
  const tb = document.getElementById('licBody')
  if (!lics.length) { tb.innerHTML = '<tr><td colspan="7" class="empty">Keine Lizenzen</td></tr>'; return }
  tb.innerHTML = lics.map(l =>
    '<tr><td><strong>' + escHtml(l.product) + '</strong></td>' +
    '<td>' + escHtml(l.userEmail || l.userId) + '</td>' +
    '<td>' + (l.grantedVia === 'Purchase' ? 'Kauf' : 'Manuell') + '</td>' +
    '<td style="color:rgba(255,255,255,0.5);font-size:12px">' + fmtDate(l.purchasedAt) + '</td>' +
    '<td>' + (l.expiresAt ? fmtDate(l.expiresAt) : '∞') + '</td>' +
    '<td>' + (l.isActive ? '<span class="pill active">Aktiv</span>' : '<span class="pill blocked">Inaktiv</span>') + '</td>' +
    '<td><button class="btn danger" onclick="revoke(' + l.id + ')">Widerrufen</button></td></tr>'
  ).join('')
}
async function revoke(id) {
  if (!confirm('Lizenz wirklich widerrufen?')) return
  try { await api('/admin/licenses/' + id + '/revoke', { method: 'DELETE' }); toast('Widerrufen'); loadLicenses() }
  catch (e) { toast('Fehler: ' + e.message) }
}
document.getElementById('licFilter').addEventListener('change', loadLicenses)
document.getElementById('licSearch').addEventListener('input', e => {
  const q = e.target.value.toLowerCase()
  renderLics(allLics.filter(l => (l.product||'').toLowerCase().includes(q) || (l.userEmail||'').toLowerCase().includes(q)))
})

// Grant License Modal
function openGrantModal() { document.getElementById('grantModal').classList.add('show') }
function closeGrantModal() { document.getElementById('grantModal').classList.remove('show') }
document.getElementById('grantModal').addEventListener('click', e => { if (e.target.id === 'grantModal') closeGrantModal() })
async function grantLicense() {
  const userEmail = document.getElementById('grantEmail').value.trim()
  const product = document.getElementById('grantProduct').value
  if (!userEmail) { toast('E-Mail fehlt'); return }
  try {
    await api('/admin/licenses/grant', { method: 'POST', body: JSON.stringify({ userEmail, product }) })
    toast('Lizenz vergeben'); closeGrantModal(); loadLicenses(); loadGrants()
  } catch (e) { toast('Fehler: ' + e.message) }
}

// ── Grants ──────────────────────────────────────────────────
async function loadGrants() {
  document.getElementById('grantsBody').innerHTML = '<tr><td colspan="6" class="loading">Lade…</td></tr>'
  try {
    const r = await api('/admin/grants')
    const items = r.items || []
    document.getElementById('grantsCount').textContent = '(' + items.length + ')'
    const tb = document.getElementById('grantsBody')
    if (!items.length) { tb.innerHTML = '<tr><td colspan="6" class="empty">Keine manuellen Vergaben</td></tr>'; return }
    tb.innerHTML = items.map(g =>
      '<tr><td>' + escHtml(g.userDisplayName) + '<br><span style="color:rgba(255,255,255,0.5);font-size:11px">' + escHtml(g.userEmail) + '</span></td>' +
      '<td><strong>' + escHtml(g.product) + '</strong></td>' +
      '<td style="font-size:11px;color:rgba(255,255,255,0.5)">' + escHtml(g.grantedBy) + '</td>' +
      '<td style="font-size:12px">' + fmtDateTime(g.grantedAt) + '</td>' +
      '<td style="font-size:12px;color:rgba(255,255,255,0.6)">' + escHtml(g.note || '–') + '</td>' +
      '<td><button class="btn danger" onclick="revokeGrant(' + g.id + ')">Widerrufen</button></td></tr>'
    ).join('')
  } catch (e) { document.getElementById('grantsBody').innerHTML = '<tr><td colspan="6" class="empty">' + escHtml(e.message) + '</td></tr>' }
}
async function revokeGrant(id) {
  if (!confirm('Vergabe widerrufen? Auch die zugehörige Lizenz wird deaktiviert.')) return
  try { await api('/admin/grants/' + id, { method: 'DELETE' }); toast('Widerrufen'); loadGrants(); loadLicenses() }
  catch (e) { toast('Fehler: ' + e.message) }
}

// ── Orders ──────────────────────────────────────────────────
async function loadOrders() {
  document.getElementById('ordersBody').innerHTML = '<tr><td colspan="5" class="loading">Lade…</td></tr>'
  try {
    const r = await api('/admin/orders?pageSize=200')
    const items = r.items || []
    document.getElementById('ordersCount').textContent = '(' + items.length + ')'
    const tb = document.getElementById('ordersBody')
    if (!items.length) { tb.innerHTML = '<tr><td colspan="5" class="empty">Keine Bestellungen</td></tr>'; return }
    tb.innerHTML = items.map(o =>
      '<tr><td>' + escHtml(o.userEmail) + '</td>' +
      '<td><strong>' + escHtml(o.productName) + '</strong></td>' +
      '<td>' + escHtml(o.pricePaid || '–') + '</td>' +
      '<td style="font-size:12px">' + fmtDateTime(o.purchasedAt) + '</td>' +
      '<td><span class="pill ' + (o.status === 'Active' ? 'active' : 'priv') + '">' + escHtml(o.status) + '</span></td></tr>'
    ).join('')
  } catch (e) { document.getElementById('ordersBody').innerHTML = '<tr><td colspan="5" class="empty">' + escHtml(e.message) + '</td></tr>' }
}

// ── Notifications History ───────────────────────────────────
async function loadNotifications() {
  document.getElementById('notifBody').innerHTML = '<tr><td colspan="5" class="loading">Lade…</td></tr>'
  try {
    const r = await api('/admin/notifications')
    const items = r.items || []
    document.getElementById('notifCount').textContent = '(' + items.length + ')'
    const tb = document.getElementById('notifBody')
    if (!items.length) { tb.innerHTML = '<tr><td colspan="5" class="empty">Keine Benachrichtigungen</td></tr>'; return }
    tb.innerHTML = items.map(n =>
      '<tr><td style="font-size:13px">' + escHtml(n.userEmail) + '</td>' +
      '<td><strong>' + escHtml(n.title) + '</strong></td>' +
      '<td style="font-size:12px;color:rgba(255,255,255,0.6)">' + escHtml((n.body || '').slice(0, 80)) + '</td>' +
      '<td><span class="pill priv">' + escHtml(n.type || '?') + '</span></td>' +
      '<td style="font-size:12px">' + fmtDateTime(n.createdAt) + '</td></tr>'
    ).join('')
  } catch (e) { document.getElementById('notifBody').innerHTML = '<tr><td colspan="5" class="empty">' + escHtml(e.message) + '</td></tr>' }
}

// ── Legal Pages ─────────────────────────────────────────────
async function loadLegal() {
  const list = document.getElementById('legalList')
  list.innerHTML = '<div class="loading">Lade…</div>'
  try {
    const r = await api('/admin/legal')
    const items = r.items || []
    if (!items.length) {
      list.innerHTML = '<div class="empty">Keine Rechtstexte</div>'
      return
    }
    list.innerHTML = items.map(p =>
      '<div class="table-wrap" style="padding:18px"><div style="display:flex;justify-content:space-between;align-items:center">' +
      '<div><h3 style="font-size:16px;margin-bottom:4px">' + escHtml(p.title) + '</h3>' +
      '<div style="color:rgba(255,255,255,0.45);font-size:12px">slug: <code>' + escHtml(p.slug) + '</code> · zuletzt: ' + fmtDateTime(p.updatedAt) + '</div></div>' +
      '<button class="btn lg ok" onclick="editLegal(\\''+ p.slug +'\\')">Bearbeiten</button>' +
      '</div></div>'
    ).join('')
  } catch (e) { list.innerHTML = '<div class="err">' + escHtml(e.message) + '</div>' }
}

async function editLegal(slug) {
  currentLegalSlug = slug
  try {
    const p = await api('/admin/legal/' + slug)
    document.getElementById('legalEditTitle').textContent = '📜 ' + p.title + ' bearbeiten'
    document.getElementById('legalEditTitleInput').value = p.title || ''
    document.getElementById('legalEditContent').value = p.content || ''
    document.getElementById('legalModal').classList.add('show')
  } catch (e) { toast('Fehler: ' + e.message) }
}
function closeLegalModal() { document.getElementById('legalModal').classList.remove('show'); currentLegalSlug = null }
document.getElementById('legalModal').addEventListener('click', e => { if (e.target.id === 'legalModal') closeLegalModal() })

async function saveLegal() {
  const title = document.getElementById('legalEditTitleInput').value
  const content = document.getElementById('legalEditContent').value
  try {
    await api('/admin/legal/' + currentLegalSlug, { method: 'PUT', body: JSON.stringify({ title, content }) })
    toast('Gespeichert'); closeLegalModal(); loadLegal()
  } catch (e) { toast('Fehler: ' + e.message) }
}

// ── Auto-Login ──────────────────────────────────────────────
if (token) showDashboard()
</script>
</body>
</html>`

export default webAdmin
