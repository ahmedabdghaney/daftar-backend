const { Resend } = require('resend');

const API_KEY = process.env.RESEND_API_KEY || '';
const FROM = process.env.MAIL_FROM || 'Raseed <no-reply@mail.aswad-iq.com>';

const resend = API_KEY ? new Resend(API_KEY) : null;

function codeEmail(title, intro, code) {
  return `<!doctype html>
<html dir="rtl" lang="ar">
<body style="margin:0;background:#f4f5f7;font-family:-apple-system,system-ui,'Segoe UI',Tahoma,sans-serif">
  <div style="max-width:460px;margin:32px auto;background:#fff;border-radius:18px;overflow:hidden;border:1px solid #e6e8eb">
    <div style="background:#1652F0;padding:22px 26px;color:#fff">
      <div style="font-size:22px;font-weight:800;letter-spacing:.5px">رصيد</div>
    </div>
    <div style="padding:28px 26px;color:#1d2127">
      <div style="font-size:18px;font-weight:700;margin-bottom:8px">${title}</div>
      <div style="font-size:14px;color:#5b6470;line-height:1.7;margin-bottom:22px">${intro}</div>
      <div style="font-size:34px;font-weight:800;letter-spacing:10px;text-align:center;background:#f4f5f7;border-radius:12px;padding:18px;color:#1652F0">${code}</div>
      <div style="font-size:12px;color:#8a93a0;text-align:center;margin-top:16px">الرمز صالح ١٠ دقائق. لو ما طلبت هذا الرمز تجاهل الرسالة.</div>
    </div>
  </div>
</body>
</html>`;
}

async function sendCode({ to, purpose, code }) {
  if (!resend) throw new Error('mail_not_configured');
  const isReset = purpose === 'reset';
  const subject = isReset ? 'رمز إعادة تعيين كلمة السر' : 'رمز تفعيل حسابك في رصيد';
  const title = isReset ? 'إعادة تعيين كلمة السر' : 'تفعيل الحساب';
  const intro = isReset
    ? 'استخدم الرمز التالي لإعادة تعيين كلمة السر مالتك:'
    : 'استخدم الرمز التالي لتفعيل حسابك:';
  const html = codeEmail(title, intro, code);
  return resend.emails.send({ from: FROM, to, subject, html });
}

module.exports = { sendCode, mailerReady: !!resend };
