const router = require('express').Router();
const { pool } = require('../db');
const { sign, hash, compare, requireAuth } = require('../auth');

async function publicUser(id) {
  const u = await pool.query(
    'select id, email, display_name as "displayName", photo_url as "photoURL", auth_provider as "authProvider" from users where id=$1',
    [id]
  );
  return u.rows[0];
}

// تسجيل جديد بالإيميل
router.post('/register', async (req, res, next) => {
  try {
    const { email, password, displayName } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'email_password_required' });
    const e = email.toLowerCase().trim();
    const exists = await pool.query('select 1 from users where email=$1', [e]);
    if (exists.rowCount) return res.status(409).json({ error: 'email_taken' });
    const ph = await hash(password);
    const r = await pool.query(
      'insert into users(email, password_hash, display_name, auth_provider) values($1,$2,$3,$4) returning id',
      [e, ph, displayName || '', 'email']
    );
    const id = r.rows[0].id;
    await pool.query('insert into user_settings(user_id) values($1) on conflict do nothing', [id]);
    res.json({ token: sign(id), user: await publicUser(id) });
  } catch (err) { next(err); }
});

// دخول بالإيميل
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    const e = (email || '').toLowerCase().trim();
    const r = await pool.query('select id, password_hash from users where email=$1', [e]);
    if (!r.rowCount || !r.rows[0].password_hash) return res.status(401).json({ error: 'bad_credentials' });
    const ok = await compare(password || '', r.rows[0].password_hash);
    if (!ok) return res.status(401).json({ error: 'bad_credentials' });
    res.json({ token: sign(r.rows[0].id), user: await publicUser(r.rows[0].id) });
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

    const found = await pool.query('select id from users where email=$1', [email]);
    let id;
    if (found.rowCount) {
      id = found.rows[0].id;
      await pool.query(
        "update users set display_name = coalesce(nullif(display_name,''), $2), photo_url=$3, auth_provider='google' where id=$1",
        [id, name, photo]
      );
    } else {
      const ins = await pool.query(
        "insert into users(email, display_name, photo_url, auth_provider) values($1,$2,$3,'google') returning id",
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
