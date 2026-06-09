const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const { sign, hash, compare, requireAuth } = require('../auth');
const { sendCode } = require('../mailer');

async function publicUser(id) {
  const u = await pool.query(
    'select id, email, display_name as "displayName", photo_url as "photoURL", auth_provider as "authProvider" from users where id=$1',
    [id]
  );
  return u.rows[0];
}

// ===== أدوات الرموز =====
function genCode() {
  return String(Math.floor(100000 + Math.random() * 900000)); // 6 أرقام
}

async function createCode(email, purpose, payload = {}) {
  const code = genCode();
  const codeHash = await bcrypt.hash(code, 8);
  await pool.query('delete from email_codes where email=$1 and purpose=$2', [email, purpose]);
  await pool.query(
    `insert into email_codes(email, code_hash, purpose, payload, expires_at)
     values($1,$2,$3,$4, now() + interval '10 minutes')`,
    [email, codeHash, purpose, JSON.stringify(payload)]
  );
  return code;
}

async function verifyCode(email, purpose, code) {
  const r = await pool.query(
    'select * from email_codes where email=$1 and purpose=$2 order by created_at desc limit 1',
    [email, purpose]
  );
  if (!r.rowCount) return { error: 'code_not_found' };
  const row = r.rows[0];
  if (new Date(row.expires_at).getTime() < Date.now()) return { error: 'code_expired' };
  if (row.attempts >= 5) return { error: 'too_many_attempts' };
  const ok = await bcrypt.compare(String(code || ''), row.code_hash);
  if (!ok) {
    await pool.query('update email_codes set attempts=attempts+1 where id=$1', [row.id]);
    return { error: 'code_invalid' };
  }
  return { row };
}

// ===== ١) بدء التسجيل: يرسل رمز تفعيل (ما يسجّل بعد) =====
router.post('/register', async (req, res, next) => {
  try {
    const { email, password, displayName } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'email_password_required' });
    if (String(password).length < 6) return res.status(400).json({ error: 'weak_password' });
    const e = email.toLowerCase().trim();
    const exists = await pool.query('select 1 from users where email=$1', [e]);
    if (exists.rowCount) return res.status(409).json({ error: 'email_taken' });

    const ph = await hash(password);
    const code = await createCode(e, 'verify', { displayName: displayName || '', passwordHash: ph });
    await sendCode({ to: e, purpose: 'verify', code });
    res.json({ ok: true, pending: true, email: e });
  } catch (err) {
    if (err.message === 'mail_not_configured') return res.status(503).json({ error: 'mail_not_configured' });
    next(err);
  }
});

// ===== ٢) تأكيد رمز التسجيل: ينشئ المستخدم ويرجع التوكن =====
router.post('/verify-otp', async (req, res, next) => {
  try {
    const { email, code } = req.body || {};
    const e = (email || '').toLowerCase().trim();
    const v = await verifyCode(e, 'verify', code);
    if (v.error) return res.status(400).json({ error: v.error });

    const exists = await pool.query('select id from users where email=$1', [e]);
    if (exists.rowCount) {
      await pool.query('delete from email_codes where id=$1', [v.row.id]);
      return res.status(409).json({ error: 'email_taken' });
    }

    const payload = v.row.payload || {};
    const r = await pool.query(
      "insert into users(email, password_hash, display_name, auth_provider, email_verified) values($1,$2,$3,'email',true) returning id",
      [e, payload.passwordHash || null, payload.displayName || '']
    );
    const id = r.rows[0].id;
    await pool.query('insert into user_settings(user_id) values($1) on conflict do nothing', [id]);
    await pool.query('delete from email_codes where id=$1', [v.row.id]);
    res.json({ token: sign(id), user: await publicUser(id) });
  } catch (err) { next(err); }
});

// ===== ٣) إعادة إرسال رمز التسجيل =====
router.post('/resend-otp', async (req, res, next) => {
  try {
    const { email } = req.body || {};
    const e = (email || '').toLowerCase().trim();
    const exists = await pool.query('select 1 from users where email=$1', [e]);
    if (exists.rowCount) return res.status(409).json({ error: 'email_taken' });
    const last = await pool.query(
      'select payload from email_codes where email=$1 and purpose=$2 order by created_at desc limit 1',
      [e, 'verify']
    );
    if (!last.rowCount) return res.status(400).json({ error: 'no_pending_signup' });
    const code = await createCode(e, 'verify', last.rows[0].payload || {});
    await sendCode({ to: e, purpose: 'verify', code });
    res.json({ ok: true });
  } catch (err) {
    if (err.message === 'mail_not_configured') return res.status(503).json({ error: 'mail_not_configured' });
    next(err);
  }
});

// دخول بالإيميل
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    const e = (email || '').toLowerCase().trim();
    const r = await pool.query('select id, password_hash, banned from users where email=$1', [e]);
    if (!r.rowCount || !r.rows[0].password_hash) return res.status(401).json({ error: 'bad_credentials' });
    if (r.rows[0].banned) return res.status(403).json({ error: 'banned' });
    const ok = await compare(password || '', r.rows[0].password_hash);
    if (!ok) return res.status(401).json({ error: 'bad_credentials' });
    res.json({ token: sign(r.rows[0].id), user: await publicUser(r.rows[0].id) });
  } catch (err) { next(err); }
});

// ===== ٤) نسيت الباسوورد: يرسل رمز إعادة تعيين =====
router.post('/forgot-password', async (req, res, next) => {
  try {
    const { email } = req.body || {};
    const e = (email || '').toLowerCase().trim();
    const r = await pool.query('select id, password_hash from users where email=$1', [e]);
    if (r.rowCount && r.rows[0].password_hash) {
      const code = await createCode(e, 'reset', {});
      await sendCode({ to: e, purpose: 'reset', code });
    }
    res.json({ ok: true });
  } catch (err) {
    if (err.message === 'mail_not_configured') return res.status(503).json({ error: 'mail_not_configured' });
    next(err);
  }
});

// ===== ٥) إعادة تعيين الباسوورد بالرمز =====
router.post('/reset-password', async (req, res, next) => {
  try {
    const { email, code, newPassword } = req.body || {};
    const e = (email || '').toLowerCase().trim();
    if (!newPassword || String(newPassword).length < 6) return res.status(400).json({ error: 'weak_password' });
    const v = await verifyCode(e, 'reset', code);
    if (v.error) return res.status(400).json({ error: v.error });
    const ph = await hash(newPassword);
    await pool.query('update users set password_hash=$2 where email=$1', [e, ph]);
    await pool.query('delete from email_codes where id=$1', [v.row.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// دخول جوجل — يتحقق من id token الجاي من التطبيق
router.post('/google', async (req, res, next) => {
  try {
    const { idToken } = req.body || {};
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) return res.status(501).json({ error: 'google_not_configured' });
    if (!idToken) return res.status(400).json({ error: 'id_token_required' });

    const { OAuth2Client } = require('google-auth-library');
    const client = new OAuth2Client(clientId);
    const ticket = await client.verifyIdToken({ idToken, audience: clientId });
    const p = ticket.getPayload();
    const email = (p.email || '').toLowerCase();
    const name = p.name || '';
    const photo = p.picture || '';

    const found = await pool.query('select id, banned from users where email=$1', [email]);
    let id;
    if (found.rowCount) {
      if (found.rows[0].banned) return res.status(403).json({ error: 'banned' });
      id = found.rows[0].id;
      await pool.query(
        "update users set display_name = coalesce(nullif(display_name,''), $2), photo_url=$3, auth_provider='google', email_verified=true where id=$1",
        [id, name, photo]
      );
    } else {
      const ins = await pool.query(
        "insert into users(email, display_name, photo_url, auth_provider, email_verified) values($1,$2,$3,'google',true) returning id",
        [email, name, photo]
      );
      id = ins.rows[0].id;
      await pool.query('insert into user_settings(user_id) values($1) on conflict do nothing', [id]);
    }
    res.json({ token: sign(id), user: await publicUser(id) });
  } catch (err) {
    return res.status(401).json({ error: 'google_verify_failed' });
  }
});

// المستخدم الحالي
router.get('/me', requireAuth, async (req, res, next) => {
  try { res.json({ user: await publicUser(req.userId) }); }
  catch (err) { next(err); }
});

module.exports = router;
