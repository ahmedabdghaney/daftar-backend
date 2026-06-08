const router = require('express').Router();
const { pool } = require('../db');

// كلمة سر اللوحة — من متغير البيئة ADMIN_PASSWORD
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

// حماية: لازم كلمة السر بالهيدر x-admin-key
function requireAdmin(req, res, next) {
  if (!ADMIN_PASSWORD) return res.status(503).json({ error: 'admin_not_configured' });
  const key = req.headers['x-admin-key'] || '';
  if (key !== ADMIN_PASSWORD) return res.status(401).json({ error: 'unauthorized' });
  next();
}

// بيانات المستخدمين + ملخّص بسيط
router.get('/users', requireAdmin, async (req, res, next) => {
  try {
    const users = await pool.query(
      `select u.email, u.display_name, u.auth_provider, u.created_at,
              (select count(*) from months m where m.user_id = u.id) as months
       from users u
       order by u.created_at desc`
    );
    const total = users.rowCount;
    const today = (await pool.query(
      "select count(*) c from users where created_at >= date_trunc('day', now())"
    )).rows[0].c;
    const week = (await pool.query(
      "select count(*) c from users where created_at >= now() - interval '7 days'"
    )).rows[0].c;
    res.json({ total, today: Number(today), week: Number(week), users: users.rows });
  } catch (err) { next(err); }
});

// صفحة اللوحة (HTML) — تطلب كلمة السر بالمتصفح
router.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(PAGE);
});

const PAGE = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Daftar — لوحة التحكم</title>
<style>
  :root { --bg:#0b0d10; --card:#14171c; --line:#262b33; --text:#e8eaed; --muted:#8a93a0; --brand:#1652F0; --green:#34C759; }
  * { box-sizing:border-box; }
  body { margin:0; font-family:-apple-system,system-ui,'Segoe UI',Tahoma,sans-serif; background:var(--bg); color:var(--text); }
  .wrap { max-width:920px; margin:0 auto; padding:24px 16px 60px; }
  .head { display:flex; align-items:center; gap:12px; margin-bottom:24px; }
  .logo { width:42px; height:42px; border-radius:12px; background:var(--brand); color:#fff; display:flex; align-items:center; justify-content:center; font-weight:800; font-size:22px; }
  h1 { font-size:20px; margin:0; }
  .sub { color:var(--muted); font-size:13px; margin-top:2px; }
  .login { background:var(--card); border:1px solid var(--line); border-radius:16px; padding:22px; max-width:380px; margin:60px auto; }
  .login input { width:100%; padding:13px 14px; border-radius:10px; border:1px solid var(--line); background:#0f1216; color:var(--text); font-size:15px; }
  .login button, .reload { margin-top:12px; width:100%; padding:13px; border:0; border-radius:10px; background:var(--brand); color:#fff; font-weight:700; font-size:15px; cursor:pointer; }
  .err { color:#ff5b52; font-size:13px; margin-top:10px; min-height:16px; }
  .stats { display:grid; grid-template-columns:repeat(3,1fr); gap:12px; margin-bottom:20px; }
  .stat { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:16px; }
  .stat .n { font-size:26px; font-weight:800; }
  .stat .l { color:var(--muted); font-size:12px; margin-top:4px; }
  table { width:100%; border-collapse:collapse; background:var(--card); border:1px solid var(--line); border-radius:14px; overflow:hidden; }
  th, td { text-align:right; padding:12px 14px; font-size:14px; border-bottom:1px solid var(--line); }
  th { color:var(--muted); font-weight:600; font-size:12px; background:#0f1216; }
  tr:last-child td { border-bottom:0; }
  .tag { font-size:11px; padding:2px 8px; border-radius:20px; background:#1d2330; color:var(--muted); }
  .tag.g { background:rgba(52,199,89,.15); color:var(--green); }
  .hide { display:none; }
  .topbar { display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; }
  .out { background:transparent; border:1px solid var(--line); color:var(--muted); padding:8px 14px; border-radius:10px; cursor:pointer; font-size:13px; }
</style>
</head>
<body>
<div class="wrap">
  <div class="head">
    <div class="logo">D</div>
    <div><h1>Daftar</h1><div class="sub">لوحة التحكم</div></div>
  </div>

  <div id="login" class="login">
    <div style="font-weight:700;margin-bottom:12px">سجّل الدخول</div>
    <input id="pw" type="password" placeholder="كلمة سر اللوحة" />
    <button onclick="enter()">دخول</button>
    <div class="err" id="err"></div>
  </div>

  <div id="panel" class="hide">
    <div class="topbar">
      <div class="stats" style="flex:1">
        <div class="stat"><div class="n" id="s-total">—</div><div class="l">كل المستخدمين</div></div>
        <div class="stat"><div class="n" id="s-week">—</div><div class="l">هذا الأسبوع</div></div>
        <div class="stat"><div class="n" id="s-today">—</div><div class="l">اليوم</div></div>
      </div>
    </div>
    <div class="topbar">
      <button class="out" onclick="logout()">خروج</button>
      <button class="out" onclick="load()">تحديث</button>
    </div>
    <table>
      <thead><tr><th>الاسم</th><th>الإيميل</th><th>الدخول</th><th>الشهور</th><th>تاريخ التسجيل</th></tr></thead>
      <tbody id="rows"></tbody>
    </table>
  </div>
</div>

<script>
let KEY = sessionStorage.getItem('adminKey') || '';

function fmtDate(s){ try { return new Date(s).toLocaleDateString('ar', {year:'numeric',month:'short',day:'numeric'}); } catch(e){ return s; } }

async function load(){
  try {
    const r = await fetch('/admin/users', { headers: { 'x-admin-key': KEY } });
    if (r.status === 401) { showLogin('كلمة السر غلط'); return; }
    if (!r.ok) { showLogin('صار خطأ — حاول مرة ثانية'); return; }
    const d = await r.json();
    document.getElementById('login').classList.add('hide');
    document.getElementById('panel').classList.remove('hide');
    document.getElementById('s-total').textContent = d.total;
    document.getElementById('s-week').textContent = d.week;
    document.getElementById('s-today').textContent = d.today;
    const rows = d.users.map(function(u){
      const prov = u.auth_provider === 'google'
        ? '<span class="tag g">Google</span>'
        : '<span class="tag">Email</span>';
      return '<tr><td>'+(u.display_name||'—')+'</td><td>'+(u.email||'—')+'</td><td>'+prov+'</td><td>'+u.months+'</td><td>'+fmtDate(u.created_at)+'</td></tr>';
    }).join('');
    document.getElementById('rows').innerHTML = rows || '<tr><td colspan="5" style="color:var(--muted)">لا يوجد مستخدمين بعد</td></tr>';
  } catch(e) { showLogin('تعذّر الاتصال'); }
}

function enter(){
  KEY = document.getElementById('pw').value.trim();
  sessionStorage.setItem('adminKey', KEY);
  load();
}
function logout(){
  sessionStorage.removeItem('adminKey'); KEY='';
  document.getElementById('panel').classList.add('hide');
  showLogin('');
  document.getElementById('pw').value='';
}
function showLogin(msg){
  document.getElementById('login').classList.remove('hide');
  document.getElementById('panel').classList.add('hide');
  document.getElementById('err').textContent = msg || '';
}

if (KEY) load(); else showLogin('');
document.getElementById('pw').addEventListener('keydown', function(e){ if(e.key==='Enter') enter(); });
</script>
</body>
</html>`;

module.exports = router;
