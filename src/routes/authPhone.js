const router = require('express').Router();
const { pool } = require('../db');
const { sign } = require('../auth');

// ===== إعداد Twilio =====
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const verifySid = process.env.TWILIO_VERIFY_SID;
// قناة الإرسال: whatsapp (افتراضي) أو sms — تُضبط من متغير البيئة TWILIO_CHANNEL
const channel = (process.env.TWILIO_CHANNEL || 'whatsapp').toLowerCase();
const twilioReady = !!(accountSid && authToken && verifySid);
const client = twilioReady ? require('twilio')(accountSid, authToken) : null;

async function publicUser(id) {
  const u = await pool.query(
    'select id, email, phone, display_name as "displayName", photo_url as "photoURL", auth_provider as "authProvider" from users where id=$1',
    [id]
  );
  return u.rows[0];
}

// تطبيع الرقم لصيغة E.164 (+964...)
function normalizePhone(raw) {
  let p = String(raw || '').trim().replace(/[\s\-()]/g, '');
  if (!p) return null;
  // 00 بداية -> +
  if (p.startsWith('00')) p = '+' + p.slice(2);
  // رقم عراقي محلي يبدأ بـ 0 (مثل 0770...) -> +964
  if (p.startsWith('0') && !p.startsWith('+')) p = '+964' + p.slice(1);
  // بدون + وبدون 0 -> نفترض عراقي
  if (!p.startsWith('+')) p = '+964' + p;
  // تحقق بسيط: + ثم 8-15 رقم
  if (!/^\+\d{8,15}$/.test(p)) return null;
  return p;
}

// ===== ١) إرسال رمز عبر SMS =====
router.post('/phone/send', async (req, res, next) => {
  try {
    if (!twilioReady) return res.status(503).json({ error: 'sms_not_configured' });
    const phone = normalizePhone((req.body || {}).phone);
    if (!phone) return res.status(400).json({ error: 'invalid_phone' });

    await client.verify.v2.services(verifySid)
      .verifications.create({ to: phone, channel });

    res.json({ ok: true, phone, channel });
  } catch (err) {
    // أخطاء Twilio الشائعة: رقم غير موثّق بالحساب التجريبي / صيغة خاطئة
    const code = err && err.code;
    if (code === 60200) return res.status(400).json({ error: 'invalid_phone' });
    if (code === 60203) return res.status(429).json({ error: 'max_send_attempts' });
    if (code === 21608) return res.status(400).json({ error: 'phone_not_verified_trial' });
    console.error('twilio send', code, err && err.message);
    res.status(502).json({ error: 'sms_send_failed' });
  }
});

// ===== ٢) تأكيد الرمز: ينشئ/يجيب حساب بالرقم ويرجع التوكن =====
router.post('/phone/verify', async (req, res, next) => {
  try {
    if (!twilioReady) return res.status(503).json({ error: 'sms_not_configured' });
    const phone = normalizePhone((req.body || {}).phone);
    const code = String((req.body || {}).code || '').trim();
    if (!phone) return res.status(400).json({ error: 'invalid_phone' });
    if (!code) return res.status(400).json({ error: 'code_required' });

    const check = await client.verify.v2.services(verifySid)
      .verificationChecks.create({ to: phone, code });

    if (check.status !== 'approved') {
      return res.status(400).json({ error: 'code_invalid' });
    }

    // upsert المستخدم بالرقم
    const found = await pool.query('select id, banned from users where phone=$1', [phone]);
    let id;
    if (found.rowCount) {
      if (found.rows[0].banned) return res.status(403).json({ error: 'banned' });
      id = found.rows[0].id;
    } else {
      const ins = await pool.query(
        "insert into users(phone, display_name, auth_provider, email_verified) values($1,'','phone',true) returning id",
        [phone]
      );
      id = ins.rows[0].id;
    }
    await pool.query('insert into user_settings(user_id) values($1) on conflict do nothing', [id]);
    try { await pool.query('update users set last_login_at = now() where id=$1', [id]); } catch {}

    res.json({ token: sign(id), user: await publicUser(id) });
  } catch (err) {
    const code = err && err.code;
    if (code === 60200) return res.status(400).json({ error: 'invalid_phone' });
    if (code === 20404) return res.status(400).json({ error: 'code_expired' }); // لا يوجد تحقق فعّال
    console.error('twilio verify', code, err && err.message);
    res.status(502).json({ error: 'sms_verify_failed' });
  }
});

module.exports = router;
