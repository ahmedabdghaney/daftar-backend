const router = require('express').Router();
const { pool } = require('../db');

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

function requireAdmin(req, res, next) {
  if (!ADMIN_PASSWORD) return res.status(503).json({ error: 'admin_not_configured' });
  const key = req.headers['x-admin-key'] || '';
  if (key !== ADMIN_PASSWORD) return res.status(401).json({ error: 'unauthorized' });
  next();
}

// ملخّص + إحصائيات + سلسلة التسجيلات لآخر 14 يوم
router.get('/stats', requireAdmin, async (req, res, next) => {
  try {
    const total = (await pool.query('select count(*) c from users')).rows[0].c;
    const today = (await pool.query("select count(*) c from users where created_at >= date_trunc('day', now())")).rows[0].c;
    const week = (await pool.query("select count(*) c from users where created_at >= now() - interval '7 days'")).rows[0].c;
    const google = (await pool.query("select count(*) c from users where auth_provider='google'")).rows[0].c;
    const months = (await pool.query('select count(*) c from months')).rows[0].c;

    // حركات: يومية + ثابتة + هدايا + عناصر مجموعات
    const tx = (await pool.query(`
      select
        (select count(*) from daily_expenses) +
        (select count(*) from fixed_expenses) +
        (select count(*) from gifts) +
        (select count(*) from group_items) as c`)).rows[0].c;

    // سلسلة آخر 14 يوم
    const series = (await pool.query(`
      select to_char(d::date,'MM-DD') as day, count(u.id) as count
      from generate_series(now()::date - interval '13 days', now()::date, interval '1 day') d
      left join users u on date_trunc('day', u.created_at) = d
      group by d order by d`)).rows;

    res.json({
      total: Number(total), today: Number(today), week: Number(week),
      google: Number(google), email: Number(total) - Number(google),
      months: Number(months), tx: Number(tx),
      series: series.map(r => ({ day: r.day, count: Number(r.count) }))
    });
  } catch (err) { next(err); }
});

// قائمة المستخدمين + بحث
router.get('/users', requireAdmin, async (req, res, next) => {
  try {
    const q = (req.query.q || '').toLowerCase().trim();
    const params = [];
    let where = '';
    if (q) { params.push('%' + q + '%'); where = 'where lower(u.email) like $1 or lower(u.display_name) like $1'; }
    const users = await pool.query(`
      select u.id, u.email, u.display_name, u.auth_provider, u.created_at,
             (select count(*) from months m where m.user_id = u.id) as months
      from users u ${where}
      order by u.created_at desc`, params);
    res.json({ users: users.rows });
  } catch (err) { next(err); }
});

// تفاصيل مستخدم واحد + ملخّص بياناته
router.get('/users/:id', requireAdmin, async (req, res, next) => {
  try {
    const id = req.params.id;
    const u = (await pool.query('select id,email,display_name,auth_provider,photo_url,created_at from users where id=$1', [id])).rows[0];
    if (!u) return res.status(404).json({ error: 'not_found' });
    const months = (await pool.query('select key from months where user_id=$1 order by key desc', [id])).rows.map(r => r.key);
    const counts = (await pool.query(`
      select
        (select count(*) from daily_expenses de join months m on de.month_id=m.id where m.user_id=$1) as daily,
        (select count(*) from fixed_expenses fe join months m on fe.month_id=m.id where m.user_id=$1) as fixed,
        (select count(*) from loans l join months m on l.month_id=m.id where m.user_id=$1) as loans,
        (select count(*) from gifts g join months m on g.month_id=m.id where m.user_id=$1) as gifts`, [id])).rows[0];
    res.json({ user: u, months, counts: {
      daily: Number(counts.daily), fixed: Number(counts.fixed),
      loans: Number(counts.loans), gifts: Number(counts.gifts)
    }});
  } catch (err) { next(err); }
});

// حذف مستخدم (وكل بياناته عبر cascade)
router.delete('/users/:id', requireAdmin, async (req, res, next) => {
  try {
    await pool.query('delete from users where id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// تصدير CSV
router.get('/export', requireAdmin, async (req, res, next) => {
  try {
    const rows = (await pool.query(
      'select email, display_name, auth_provider, created_at from users order by created_at desc'
    )).rows;
    const head = 'email,name,provider,created_at\n';
    const body = rows.map(r =>
      [r.email, (r.display_name || '').replace(/,/g, ' '), r.auth_provider, r.created_at.toISOString()].join(',')
    ).join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="daftar-users.csv"');
    res.send(head + body);
  } catch (err) { next(err); }
});

router.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(PAGE);
});

const PAGE = String.raw`<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Daftar — لوحة التحكم</title>
<style>
  :root { --bg:#0b0d10; --card:#14171c; --line:#262b33; --text:#e8eaed; --muted:#8a93a0; --brand:#1652F0; --green:#34C759; --red:#ff5b52; }
  * { box-sizing:border-box; }
  body { margin:0; font-family:-apple-system,system-ui,'Segoe UI',Tahoma,sans-serif; background:var(--bg); color:var(--text); }
  .wrap { max-width:980px; margin:0 auto; padding:24px 16px 80px; }
  .head { display:flex; align-items:center; gap:12px; margin-bottom:22px; }
  .logo { width:42px; height:42px; border-radius:12px; background:var(--brand); color:#fff; display:flex; align-items:center; justify-content:center; font-weight:800; font-size:22px; }
  h1 { font-size:20px; margin:0; }
  .sub { color:var(--muted); font-size:13px; margin-top:2px; }
  .login { background:var(--card); border:1px solid var(--line); border-radius:16px; padding:22px; max-width:380px; margin:60px auto; }
  .login input { width:100%; padding:13px 14px; border-radius:10px; border:1px solid var(--line); background:#0f1216; color:var(--text); font-size:15px; }
  .login button { margin-top:12px; width:100%; padding:13px; border:0; border-radius:10px; background:var(--brand); color:#fff; font-weight:700; font-size:15px; cursor:pointer; }
  .err { color:var(--red); font-size:13px; margin-top:10px; min-height:16px; }
  .stats { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin-bottom:18px; }
  .stat { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:15px; }
  .stat .n { font-size:24px; font-weight:800; }
  .stat .l { color:var(--muted); font-size:12px; margin-top:4px; }
  .panelbox { background:var(--card); border:1px solid var(--line); border-radius:16px; padding:18px; margin-bottom:18px; }
  .panelbox h3 { margin:0 0 14px; font-size:14px; color:var(--muted); font-weight:600; }
  .chart { display:flex; align-items:flex-end; gap:6px; height:120px; }
  .bar { flex:1; background:var(--brand); border-radius:4px 4px 0 0; min-height:3px; position:relative; transition:.2s; }
  .bar:hover { opacity:.8; }
  .bar span { position:absolute; bottom:-18px; left:50%; transform:translateX(50%); font-size:9px; color:var(--muted); white-space:nowrap; }
  .barwrap { padding-bottom:20px; }
  .toolbar { display:flex; gap:10px; margin-bottom:14px; align-items:center; flex-wrap:wrap; }
  .toolbar { display:block; } .toolbar input { width:100%; padding:11px 14px; border-radius:10px; border:1px solid var(--line); background:#0f1216; color:var(--text); font-size:14px; }
  .btn { background:transparent; border:1px solid var(--line); color:var(--text); padding:11px 16px; border-radius:10px; cursor:pointer; font-size:13px; }
  .btn.p { background:var(--brand); border-color:var(--brand); color:#fff; font-weight:700; }
  table { width:100%; border-collapse:collapse; background:var(--card); border:1px solid var(--line); border-radius:14px; overflow:hidden; direction:rtl; table-layout:fixed; }
  th, td { text-align:right; padding:12px 14px; font-size:14px; border-bottom:1px solid var(--line); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  th { color:var(--muted); font-weight:600; font-size:12px; background:#0f1216; }
  tr:last-child td { border-bottom:0; }
  tbody tr { cursor:pointer; }
  tbody tr:hover { background:#1a1e25; }
  .tag { font-size:11px; padding:2px 8px; border-radius:20px; background:#1d2330; color:var(--muted); }
  .tag.g { background:rgba(52,199,89,.15); color:var(--green); }
  .del { color:var(--red); border:0; background:transparent; cursor:pointer; font-size:13px; }
  .hide { display:none; }
  .topbar { display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; }
  .modal { position:fixed; inset:0; background:rgba(0,0,0,.6); display:flex; align-items:center; justify-content:center; padding:20px; z-index:10; }
  .modal .box { background:var(--card); border:1px solid var(--line); border-radius:18px; padding:24px; max-width:440px; width:100%; }
  .row { display:flex; justify-content:space-between; padding:9px 0; border-bottom:1px solid var(--line); font-size:14px; }
  .row:last-child { border:0; }
  .row .k { color:var(--muted); }
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
    <div class="stats">
      <div class="stat"><div class="n" id="s-total">—</div><div class="l">المستخدمين</div></div>
      <div class="stat"><div class="n" id="s-week">—</div><div class="l">هذا الأسبوع</div></div>
      <div class="stat"><div class="n" id="s-today">—</div><div class="l">اليوم</div></div>
      <div class="stat"><div class="n" id="s-tx">—</div><div class="l">إجمالي الحركات</div></div>
    </div>

    <div class="panelbox barwrap">
      <h3>التسجيلات — آخر ١٤ يوم</h3>
      <div class="chart" id="chart"></div>
    </div>

    <div class="panelbox" style="display:flex;gap:24px">
      <div><div class="l" style="color:var(--muted);font-size:12px">دخول بالإيميل</div><div style="font-size:20px;font-weight:800" id="s-email">—</div></div>
      <div><div class="l" style="color:var(--muted);font-size:12px">دخول بجوجل</div><div style="font-size:20px;font-weight:800;color:var(--green)" id="s-google">—</div></div>
      <div><div class="l" style="color:var(--muted);font-size:12px">إجمالي الشهور</div><div style="font-size:20px;font-weight:800" id="s-months">—</div></div>
    </div>

    <div class="topbar">
      <button class="btn" onclick="logout()">خروج</button>
      <div style="display:flex;gap:8px">
        <button class="btn" onclick="exportCsv()">تصدير CSV</button>
        <button class="btn p" onclick="load()">تحديث</button>
      </div>
    </div>

    <div class="toolbar">
      <input id="search" placeholder="ابحث باسم أو إيميل..." oninput="searchUsers()" />
    </div>

    <table>
      <thead><tr><th style="width:18%">الاسم</th><th style="width:28%">الإيميل</th><th style="width:14%">الدخول</th><th style="width:10%">الشهور</th><th style="width:18%">التسجيل</th><th style="width:12%">إجراء</th></tr></thead>
      <tbody id="rows"></tbody>
    </table>
  </div>
</div>

<div id="modal" class="modal hide" onclick="if(event.target===this) closeModal()">
  <div class="box" id="modalBox"></div>
</div>

<script>
let KEY = sessionStorage.getItem('adminKey') || '';
let searchTimer = null;

function api(path){ return fetch('/admin'+path, { headers: { 'x-admin-key': KEY } }); }
function fmtDate(s){ try { return new Date(s).toLocaleDateString('ar',{year:'numeric',month:'short',day:'numeric'}); } catch(e){ return s; } }

async function load(){
  try {
    const r = await api('/stats');
    if (r.status === 401) { showLogin('كلمة السر غلط'); return; }
    if (!r.ok) { showLogin('صار خطأ'); return; }
    const d = await r.json();
    document.getElementById('login').classList.add('hide');
    document.getElementById('panel').classList.remove('hide');
    document.getElementById('s-total').textContent = d.total;
    document.getElementById('s-week').textContent = d.week;
    document.getElementById('s-today').textContent = d.today;
    document.getElementById('s-tx').textContent = d.tx;
    document.getElementById('s-email').textContent = d.email;
    document.getElementById('s-google').textContent = d.google;
    document.getElementById('s-months').textContent = d.months;
    drawChart(d.series);
    loadUsers('');
  } catch(e) { showLogin('تعذّر الاتصال'); }
}

function drawChart(series){
  const max = Math.max(1, ...series.map(s => s.count));
  document.getElementById('chart').innerHTML = series.map(function(s){
    const h = Math.round((s.count / max) * 100);
    return '<div class="bar" style="height:'+h+'%" title="'+s.count+'"><span>'+s.day+'</span></div>';
  }).join('');
}

async function loadUsers(q){
  const r = await api('/users' + (q ? ('?q='+encodeURIComponent(q)) : ''));
  if (!r.ok) return;
  const d = await r.json();
  const rows = d.users.map(function(u){
    const prov = u.auth_provider === 'google' ? '<span class="tag g">Google</span>' : '<span class="tag">Email</span>';
    return '<tr onclick="openUser(\'' + u.id + '\')">' +
      '<td>'+(u.display_name||'—')+'</td>' +
      '<td>'+(u.email||'—')+'</td>' +
      '<td>'+prov+'</td>' +
      '<td>'+u.months+'</td>' +
      '<td>'+fmtDate(u.created_at)+'</td>' +
      '<td><button class="del" onclick="event.stopPropagation(); delUser(\'' + u.id + '\',\'' + (u.email||'') + '\')">حذف</button></td>' +
    '</tr>';
  }).join('');
  document.getElementById('rows').innerHTML = rows || '<tr><td colspan="6" style="color:var(--muted)">لا يوجد مستخدمين</td></tr>';
}

function searchUsers(){
  clearTimeout(searchTimer);
  const q = document.getElementById('search').value;
  searchTimer = setTimeout(function(){ loadUsers(q); }, 300);
}

async function openUser(id){
  const r = await api('/users/'+id);
  if (!r.ok) return;
  const d = await r.json();
  const u = d.user;
  document.getElementById('modalBox').innerHTML =
    '<div style="font-size:18px;font-weight:800;margin-bottom:4px">'+(u.display_name||'—')+'</div>' +
    '<div style="color:var(--muted);font-size:13px;margin-bottom:16px">'+(u.email||'')+'</div>' +
    '<div class="row"><span class="k">طريقة الدخول</span><span>'+(u.auth_provider||'—')+'</span></div>' +
    '<div class="row"><span class="k">تاريخ التسجيل</span><span>'+fmtDate(u.created_at)+'</span></div>' +
    '<div class="row"><span class="k">عدد الشهور</span><span>'+d.months.length+'</span></div>' +
    '<div class="row"><span class="k">مصاريف يومية</span><span>'+d.counts.daily+'</span></div>' +
    '<div class="row"><span class="k">مصاريف ثابتة</span><span>'+d.counts.fixed+'</span></div>' +
    '<div class="row"><span class="k">ديون</span><span>'+d.counts.loans+'</span></div>' +
    '<div class="row"><span class="k">هدايا</span><span>'+d.counts.gifts+'</span></div>' +
    '<button class="btn" style="margin-top:18px;width:100%" onclick="closeModal()">إغلاق</button>';
  document.getElementById('modal').classList.remove('hide');
}
function closeModal(){ document.getElementById('modal').classList.add('hide'); }

async function delUser(id, email){
  if (!confirm('حذف المستخدم '+email+' وكل بياناته؟')) return;
  const r = await fetch('/admin/users/'+id, { method:'DELETE', headers:{ 'x-admin-key': KEY } });
  if (r.ok) load();
}

function exportCsv(){
  const a = document.createElement('a');
  a.href = '/admin/export';
  // المتصفح ما يرسل الهيدر مع التحميل المباشر — نجيب الملف بـ fetch
  fetch('/admin/export', { headers:{ 'x-admin-key': KEY } })
    .then(function(r){ return r.blob(); })
    .then(function(b){
      const url = URL.createObjectURL(b);
      const link = document.createElement('a');
      link.href = url; link.download = 'daftar-users.csv'; link.click();
      URL.revokeObjectURL(url);
    });
}

function enter(){ KEY = document.getElementById('pw').value.trim(); sessionStorage.setItem('adminKey', KEY); load(); }
function logout(){ sessionStorage.removeItem('adminKey'); KEY=''; document.getElementById('panel').classList.add('hide'); showLogin(''); document.getElementById('pw').value=''; }
function showLogin(msg){ document.getElementById('login').classList.remove('hide'); document.getElementById('panel').classList.add('hide'); document.getElementById('err').textContent = msg||''; }

if (KEY) load(); else showLogin('');
document.getElementById('pw').addEventListener('keydown', function(e){ if(e.key==='Enter') enter(); });
</script>
</body>
</html>`;

module.exports = router;
