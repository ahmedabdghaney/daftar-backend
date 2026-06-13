const rateLimit = require('express-rate-limit');

// رسالة موحّدة عند تجاوز الحد
function limitMessage(req, res) {
  res.status(429).json({ error: 'too_many_requests' });
}

// محدّد صارم لمسارات المصادقة (دخول/تسجيل/رموز/إعادة تعيين)
// 20 محاولة لكل IP خلال 15 دقيقة — يوقف هجمات تخمين كلمات السر
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: limitMessage,
});

// محدّد متوسط لإرسال الرموز (OTP/استعادة) — أغلى لأنه يرسل إيميل/SMS
// 5 رسائل لكل IP خلال 15 دقيقة
const codeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: limitMessage,
});

// محدّد عام واسع لبقية الـ API — يحمي من الإغراق دون إزعاج الاستخدام الطبيعي
// 300 طلب لكل IP خلال 5 دقائق
const generalLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  handler: limitMessage,
});

// محدّد لوحة الأدمن — صارم لأن كلمة السر واحدة
const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: limitMessage,
});

module.exports = { authLimiter, codeLimiter, generalLimiter, adminLimiter };
