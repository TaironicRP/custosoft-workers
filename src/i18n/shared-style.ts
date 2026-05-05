// ─────────────────────────────────────────────────────────────────────────────
// Shared CSS for all public pages (locale-independent).
// Extracted from web-public.ts so the i18n modules can reference it.
// ─────────────────────────────────────────────────────────────────────────────

export const SHARED_STYLE = `
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{background:#0a0a14;color:#fff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6;-webkit-font-smoothing:antialiased}
  body::before,body::after{content:'';position:fixed;border-radius:50%;filter:blur(80px);pointer-events:none;z-index:0}
  body::before{width:600px;height:600px;background:radial-gradient(circle,rgba(120,60,255,0.40),transparent 70%);top:-200px;left:-150px}
  body::after{width:480px;height:480px;background:radial-gradient(circle,rgba(50,150,255,0.30),transparent 70%);bottom:-150px;right:-100px}
  .nav{position:sticky;top:0;background:rgba(10,10,20,0.85);backdrop-filter:blur(20px);border-bottom:1px solid rgba(255,255,255,0.08);padding:14px 24px;z-index:10}
  .nav-inner{max-width:1100px;margin:0 auto;display:flex;align-items:center;justify-content:space-between}
  .brand{display:flex;align-items:center;gap:10px;text-decoration:none;color:inherit}
  .brand .logo{width:32px;height:32px;border-radius:8px;background:linear-gradient(135deg,#7733dd,#3355ff);display:flex;align-items:center;justify-content:center;font-size:16px;box-shadow:0 6px 16px rgba(120,60,255,0.45)}
  .brand .name{font-size:16px;font-weight:700}
  .nav-links{display:flex;gap:18px}
  .nav-links a{color:rgba(255,255,255,0.65);text-decoration:none;font-size:14px;font-weight:500;transition:color 0.15s}
  .nav-links a:hover{color:#fff}
  main{position:relative;z-index:1;max-width:1100px;margin:0 auto;padding:60px 24px}
  .footer{position:relative;z-index:1;border-top:1px solid rgba(255,255,255,0.08);padding:40px 24px;text-align:center;color:rgba(255,255,255,0.50);font-size:13px;margin-top:80px}
  .footer a{color:rgba(255,255,255,0.65);text-decoration:none;margin:0 10px}
  .footer a:hover{color:#fff}
  @media (max-width:768px){.nav-links{gap:10px}.nav-links a{font-size:12px}}
`
