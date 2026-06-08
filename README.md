# Daftar Backend

Backend خاص بتطبيق دفتر — Node.js + Express + PostgreSQL.
قاعدة بيانات علائقية حقيقية مع تسجيل دخول (إيميل + جوجل) ومزامنة كامل بيانات التطبيق.

## شنو يقدّم
- جداول Postgres مطابقة لموديل دفتر (شهور دخل مصاريف ثابتة يومية ديون أقساط أهداف هدايا مجموعات)
- تسجيل دخول بالإيميل/الباسوورد (مشفّر bcrypt) + توكن JWT
- دخول جوجل (يتحقق من id token)
- مزامنة كاملة: نقطتين بس `GET /api/state` و `PUT /api/state` تكفي لربط التطبيق

---

## التشغيل المحلي (الأسرع) — Docker
```
cp .env.example .env
docker compose up --build
```
يشتغل السيرفر على `http://localhost:4000` والقاعدة تنبني تلقائياً.

## التشغيل بدون Docker
1. ثبّت Postgres وسوّي قاعدة اسمها `daftar`
2. `cp .env.example .env` وعدّل `DATABASE_URL`
3. `npm install`
4. `npm run migrate`  (يبني الجداول)
5. `npm start`

## النشر السحابي (مجاني)
- **Railway / Render**: اربط الريبو سوّي Postgres add-on حط `DATABASE_URL` و `PGSSL=true` و `JWT_SECRET`. الجداول تنبني تلقائياً عند الإقلاع.
- **Supabase**: سوّي مشروع خذ connection string حطه بـ `DATABASE_URL` و `PGSSL=true`. تكدر تشغّل `db/schema.sql` من SQL Editor مباشرة.

---

## نقاط الـ API

### تسجيل / دخول
```
POST /api/auth/register   { email, password, displayName }   -> { token, user }
POST /api/auth/login      { email, password }                -> { token, user }
POST /api/auth/google     { idToken }                        -> { token, user }
GET  /api/auth/me         (Bearer token)                     -> { user }
```

### مزامنة البيانات (تحتاج Bearer token)
```
GET  /api/state   -> { settings, months }   نفس شكل AppState بالتطبيق
PUT  /api/state   { settings, months }      يستبدل كل بيانات المستخدم
```

كل الطلبات المحمية تحتاج هيدر:
```
Authorization: Bearer <token>
```

---

## ربط التطبيق (iOS) لاحقاً
- بعد الدخول خزّن الـ token
- عند الفتح: `GET /api/state` وعبّي البيانات
- عند أي حفظ: `PUT /api/state` بكل الحالة (مع debounce)

## ملاحظات
- `PUT /api/state` يستبدل كل البيانات (بسيط ومناسب لحجم شخصي). لو كبرت البيانات بدّلها لتحديثات جزئية لكل عنصر.
- المبالغ مخزّنة `double precision`. للأموال الدقيقة استخدم سنتات صحيحة لاحقاً.
- بدّل `JWT_SECRET` بسلسلة عشوائية طويلة قبل النشر.
