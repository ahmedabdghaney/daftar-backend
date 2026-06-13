require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { initDb } = require('./initDb');
const { authLimiter, codeLimiter, generalLimiter, adminLimiter } = require('./rateLimit');

const app = express();
// Railway/البروكسي: ضروري ليقرأ IP الحقيقي للمستخدم (وإلا كل الطلبات تبدو من نفس IP)
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: '4mb' }));

app.get('/', (req, res) => res.json({ name: 'Daftar API', status: 'ok' }));
app.get('/health', (req, res) => res.json({ ok: true }));

// ===== حدود المعدّل =====
// مسارات إرسال الرموز (الأغلى — إيميل/SMS): حد صارم
app.use('/api/auth/register', codeLimiter);
app.use('/api/auth/resend-otp', codeLimiter);
app.use('/api/auth/forgot-password', codeLimiter);
app.use('/api/auth/phone/send', codeLimiter);
// بقية مسارات المصادقة (دخول/تحقق/جوجل): حد ضد التخمين
app.use('/api/auth', authLimiter);
// لوحة الأدمن: حد صارم
app.use('/admin', adminLimiter);
// بقية الـ API: حد عام واسع
app.use('/api/state', generalLimiter);

app.use('/api/auth', require('./routes/auth'));
app.use('/api/auth', require('./routes/authPhone'));
app.use('/api/state', require('./routes/state'));
app.use('/admin', require('./routes/admin'));

// معالج أخطاء عام
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'server_error' });
});

const port = process.env.PORT || 4000;
initDb()
  .then(() => app.listen(port, () => console.log('Daftar API running on :' + port)))
  .catch((e) => { console.error('DB init failed', e); process.exit(1); });
