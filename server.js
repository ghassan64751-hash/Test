require('dotenv').config();
const crypto = require('crypto');
const path = require('path');
const express = require('express');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const { Resend } = require('resend');

const PORT = process.env.PORT || 3000;
const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 60 * 1000;
const IS_PROD = process.env.NODE_ENV === 'production';

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const FROM = process.env.MAIL_FROM || 'onboarding@resend.dev';

const pending = new Map();

const app = express();
app.set('trust proxy', 1);
app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', secure: IS_PROD, maxAge: 7 * 24 * 3600 * 1000 },
  })
);
app.use(express.static(path.join(__dirname, 'public')));

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });
app.use('/api/', limiter);

const emailOk = (e) => typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length <= 254;
const hashCode = (email, code) =>
  crypto.createHash('sha256').update(`${email}:${code}:${process.env.SESSION_SECRET || 'dev'}`).digest('hex');

function emailHtml(code) {
  return `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;max-width:420px;margin:auto;padding:24px;border:1px solid #e5e7eb;border-radius:12px">
  <h2 style="margin:0 0 12px">رمز التحقق</h2>
  <p style="color:#4b5563">استخدم الرمز التالي لتسجيل الدخول. صالح لمدة 10 دقائق.</p>
  <div style="font-size:34px;letter-spacing:8px;font-weight:bold;text-align:center;background:#f3f4f6;border-radius:8px;padding:16px;margin:16px 0" dir="ltr">${code}</div>
  <p style="color:#9ca3af;font-size:12px">إذا لم تطلب هذا الرمز تجاهل الرسالة.</p></div>`;
}

app.post('/api/request-code', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!emailOk(email)) return res.status(400).json({ error: 'البريد الإلكتروني غير صالح' });

  const existing = pending.get(email);
  if (existing && Date.now() - existing.lastSent < RESEND_COOLDOWN_MS) {
    const wait = Math.ceil((RESEND_COOLDOWN_MS - (Date.now() - existing.lastSent)) / 1000);
    return res.status(429).json({ error: `انتظر ${wait} ثانية قبل طلب رمز جديد` });
  }

  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  pending.set(email, { hash: hashCode(email, code), expires: Date.now() + CODE_TTL_MS, attempts: 0, lastSent: Date.now() });

  try {
    if (resend) {
      const { error } = await resend.emails.send({
        from: FROM,
        to: email,
        subject: `رمز الدخول: ${code}`,
        html: emailHtml(code),
        text: `رمز الدخول الخاص بك: ${code} (صالح 10 دقائق)`,
      });
      if (error) throw new Error(error.message);
    } else {
      console.log(`[DEV] رمز الدخول لـ ${email}: ${code}`);
    }
    res.json({ ok: true, dev: !resend });
  } catch (err) {
    console.error('Mail error:', err.message);
    pending.delete(email);
    res.status(502).json({ error: 'تعذر إرسال البريد، حاول لاحقاً' });
  }
});

app.post('/api/verify-code', (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const code = String(req.body.code || '').trim();
  const rec = pending.get(email);

  if (!rec || Date.now() > rec.expires) {
    pending.delete(email);
    return res.status(400).json({ error: 'انتهت صلاحية الرمز، اطلب رمزاً جديداً' });
  }
  if (rec.attempts >= MAX_ATTEMPTS) {
    pending.delete(email);
    return res.status(429).json({ error: 'محاولات كثيرة، اطلب رمزاً جديداً' });
  }
  rec.attempts++;

  const a = Buffer.from(rec.hash);
  const b = Buffer.from(hashCode(email, code));
  if (!/^\d{6}$/.test(code) || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(400).json({ error: 'الرمز غير صحيح' });
  }

  pending.delete(email);
  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'خطأ في الجلسة' });
    req.session.user = { email };
    res.json({ ok: true });
  });
});

app.get('/api/me', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'غير مسجل' });
  res.json(req.session.user);
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of pending) if (now > v.expires) pending.delete(k);
}, 60 * 1000).unref();

app.listen(PORT, () => console.log(`الموقع يعمل على http://localhost:${PORT}`));