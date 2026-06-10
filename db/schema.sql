-- Daftar — PostgreSQL schema
-- آمنة للتشغيل أكثر من مرة (IF NOT EXISTS)

create extension if not exists pgcrypto;

create table if not exists users (
  id            uuid primary key default gen_random_uuid(),
  email         text unique not null,
  password_hash text,                       -- null لو الدخول عبر جوجل فقط
  display_name  text not null default '',
  photo_url     text not null default '',
  auth_provider text not null default 'email',  -- 'email' / 'google'
  banned        boolean not null default false,
  created_at    timestamptz not null default now()
);
-- لو الجدول موجود من قبل بدون العمود
alter table users add column if not exists banned boolean not null default false;

create table if not exists user_settings (
  user_id               uuid primary key references users(id) on delete cascade,
  notifications_enabled boolean not null default true,
  pin                   text not null default '',
  onboarded             boolean not null default false,
  bio_enabled           boolean not null default false,
  lang                  text not null default 'ar',
  theme                 text not null default 'light',
  active_month          text not null default '',
  currency              text not null default 'IQD',
  categories            jsonb not null default '[]',
  hidden_categories     jsonb not null default '[]',
  budgets               jsonb not null default '{}',
  app_lock              boolean not null default false
);

create table if not exists months (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references users(id) on delete cascade,
  key            text not null,                 -- yyyy-MM
  primary_name   text not null default 'Salary',
  primary_amount double precision not null default 0,
  unique(user_id, key)
);
create index if not exists idx_months_user on months(user_id);

create table if not exists incomes (
  id        uuid primary key default gen_random_uuid(),
  month_id  uuid not null references months(id) on delete cascade,
  name      text not null default '',
  amount    double precision not null default 0,
  is_primary boolean not null default false
);

create table if not exists loans (
  id        uuid primary key default gen_random_uuid(),
  month_id  uuid not null references months(id) on delete cascade,
  name      text not null default '',
  amount    double precision not null default 0,
  paid      double precision not null default 0,
  dir       text not null default 'owe',         -- owe / owed
  type      text not null default 'lump',        -- lump / installments
  monthly   double precision not null default 0,
  end_date  text not null default ''
);

create table if not exists installments (
  id        uuid primary key default gen_random_uuid(),
  month_id  uuid not null references months(id) on delete cascade,
  name      text not null default '',
  total     double precision not null default 0,
  monthly   double precision not null default 0,
  paid      double precision not null default 0,
  due_day   integer
);

create table if not exists goals (
  id        uuid primary key default gen_random_uuid(),
  month_id  uuid not null references months(id) on delete cascade,
  name      text not null default '',
  target    double precision not null default 0,
  saved     double precision not null default 0,
  monthly   double precision not null default 0
);

create table if not exists fixed_expenses (
  id        uuid primary key default gen_random_uuid(),
  month_id  uuid not null references months(id) on delete cascade,
  name      text not null default '',
  cost      double precision not null default 0,
  paid      boolean not null default false,
  category  text not null default 'Fixed'
);

create table if not exists daily_expenses (
  id        uuid primary key default gen_random_uuid(),
  month_id  uuid not null references months(id) on delete cascade,
  name      text not null default '',
  amount    double precision not null default 0,
  category  text not null default 'Other',
  date      text not null default '',
  ts        double precision not null default 0
);

create table if not exists gifts (
  id        uuid primary key default gen_random_uuid(),
  month_id  uuid not null references months(id) on delete cascade,
  name      text not null default '',
  amount    double precision not null default 0,
  note      text not null default '',
  date      text not null default ''
);

create table if not exists custom_groups (
  id        uuid primary key default gen_random_uuid(),
  month_id  uuid not null references months(id) on delete cascade,
  name      text not null default '',
  icon      text not null default 'square.grid.2x2'
);

create table if not exists group_items (
  id        uuid primary key default gen_random_uuid(),
  group_id  uuid not null references custom_groups(id) on delete cascade,
  name      text not null default '',
  amount    double precision not null default 0,
  date      text not null default ''
);

-- ===== تحقق الإيميل + رموز OTP/إعادة التعيين =====
-- عمود التفعيل (المستخدمين الحاليين يصيرون مفعّلين تلقائياً)
alter table users add column if not exists email_verified boolean not null default false;
update users set email_verified = true where created_at < now();

-- رموز مؤقتة: نوع 'verify' لتفعيل التسجيل و 'reset' لإعادة الباسوورد
create table if not exists email_codes (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,
  code_hash   text not null,                 -- الرمز مخزّن مشفّر
  purpose     text not null,                 -- 'verify' / 'reset'
  payload     jsonb not null default '{}',   -- بيانات التسجيل المؤقتة (الاسم/الباسوورد المشفّر)
  attempts    integer not null default 0,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_email_codes_lookup on email_codes(email, purpose);

-- أعمدة مضافة: صورة الحساب + تخصيص الفئات + تفضيلات جديدة (آمنة على القواعد الموجودة)
alter table user_settings add column if not exists photo_data      text    not null default '';
alter table user_settings add column if not exists category_icons  jsonb   not null default '{}';
alter table user_settings add column if not exists category_colors jsonb   not null default '{}';
alter table user_settings add column if not exists arabic_numerals boolean not null default false;
alter table user_settings add column if not exists birthday        text    not null default '';
alter table daily_expenses add column if not exists kind text not null default 'essential';
alter table fixed_expenses add column if not exists kind text not null default 'essential';
alter table loans add column if not exists deduct_from_balance boolean not null default true;
