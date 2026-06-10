const router = require('express').Router();
const { pool } = require('../db');
const { requireAuth } = require('../auth');

router.use(requireAuth);

function num(v) { const n = Number(v); return isNaN(n) ? 0 : n; }

// ===== GET كل الحالة (مطابقة AppState بالتطبيق) =====
router.get('/', async (req, res, next) => {
  try {
    const uid = req.userId;
    const sRow = (await pool.query('select * from user_settings where user_id=$1', [uid])).rows[0] || {};
    const uRow = (await pool.query('select email, display_name, photo_url, auth_provider from users where id=$1', [uid])).rows[0] || {};

    const settings = {
      displayName: uRow.display_name || '',
      email: uRow.email || '',
      authProvider: uRow.auth_provider || '',
      photoURL: uRow.photo_url || '',
      notificationsEnabled: sRow.notifications_enabled ?? true,
      pin: sRow.pin || '',
      onboarded: sRow.onboarded ?? false,
      signedIn: true,
      bioEnabled: sRow.bio_enabled ?? false,
      lang: sRow.lang || 'ar',
      theme: sRow.theme || 'light',
      activeMonth: sRow.active_month || '',
      currency: sRow.currency || 'IQD',
      categories: sRow.categories || [],
      hiddenCategories: sRow.hidden_categories || [],
      budgets: sRow.budgets || {},
      appLock: sRow.app_lock ?? false,
      photoData: sRow.photo_data || '',
      categoryIcons: sRow.category_icons || {},
      categoryColors: sRow.category_colors || {},
      arabicNumerals: sRow.arabic_numerals ?? false,
      birthday: sRow.birthday || '',
      accounts: sRow.accounts || [],
      defaultAccount: sRow.default_account || null,
    };

    const mRows = (await pool.query('select * from months where user_id=$1', [uid])).rows;
    const ids = mRows.map((m) => m.id);
    const fetchBy = async (table, col) =>
      ids.length ? (await pool.query(`select * from ${table} where ${col}=any($1)`, [ids])).rows : [];

    const sec = await fetchBy('incomes', 'month_id');
    const loans = await fetchBy('loans', 'month_id');
    const inst = await fetchBy('installments', 'month_id');
    const goals = await fetchBy('goals', 'month_id');
    const fixed = await fetchBy('fixed_expenses', 'month_id');
    const daily = await fetchBy('daily_expenses', 'month_id');
    const gifts = await fetchBy('gifts', 'month_id');
    const groups = await fetchBy('custom_groups', 'month_id');
    const gids = groups.map((g) => g.id);
    const gitems = gids.length
      ? (await pool.query('select * from group_items where group_id=any($1)', [gids])).rows
      : [];

    const pick = (arr, mid) => arr.filter((x) => x.month_id === mid);
    const months = {};
    for (const m of mRows) {
      months[m.key] = {
        primary: { id: m.id, name: m.primary_name, amount: m.primary_amount, isPrimary: true },
        transfers: m.transfers || [],
        secondary: pick(sec, m.id).map((r) => ({ id: r.id, name: r.name, amount: r.amount, isPrimary: false })),
        loans: pick(loans, m.id).map((r) => ({
          id: r.id, name: r.name, amount: r.amount, paid: r.paid,
          dir: r.dir, type: r.type, monthly: r.monthly, endDate: r.end_date || '', deductFromBalance: r.deduct_from_balance ?? true, paidBefore: r.paid_before || 0,
        })),
        installments: pick(inst, m.id).map((r) => ({
          id: r.id, name: r.name, total: r.total, monthly: r.monthly, paid: r.paid, dueDay: r.due_day, paidBefore: r.paid_before || 0,
        })),
        goals: pick(goals, m.id).map((r) => ({
          id: r.id, name: r.name, target: r.target, saved: r.saved, monthly: r.monthly, targetDate: r.target_date || null, savedBefore: r.saved_before || 0,
        })),
        fixed: pick(fixed, m.id).map((r) => ({
          id: r.id, name: r.name, cost: r.cost, paid: r.paid, category: r.category || 'Fixed', kind: r.kind || 'essential',
        })),
        daily: pick(daily, m.id).map((r) => ({
          id: r.id, name: r.name, amount: r.amount, category: r.category || 'Other', kind: r.kind || 'essential', date: r.date || '', ts: r.ts || 0, note: r.note || '', receipt: r.receipt || '', account: r.account || null,
        })),
        gifts: pick(gifts, m.id).map((r) => ({
          id: r.id, name: r.name, amount: r.amount, note: r.note || '', date: r.date || '',
        })),
        groups: pick(groups, m.id).map((g) => ({
          id: g.id, name: g.name, icon: g.icon || 'square.grid.2x2',
          items: gitems.filter((it) => it.group_id === g.id)
            .map((it) => ({ id: it.id, name: it.name, amount: it.amount, date: it.date || '' })),
        })),
      };
    }

    res.json({ settings, months });
  } catch (err) { next(err); }
});

// ===== PUT استبدال كل الحالة (مزامنة من التطبيق) =====
router.put('/', async (req, res) => {
  const uid = req.userId;
  const { settings, months } = req.body || {};
  const client = await pool.connect();
  try {
    await client.query('begin');

    if (settings) {
      await client.query('update users set display_name=$2, photo_url=$3 where id=$1',
        [uid, settings.displayName || '', settings.photoURL || '']);
      await client.query(
        `insert into user_settings
          (user_id, notifications_enabled, pin, onboarded, bio_enabled, lang, theme, active_month, currency, categories, hidden_categories, budgets, app_lock,
           photo_data, category_icons, category_colors, arabic_numerals, birthday, accounts, default_account)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
         on conflict (user_id) do update set
           notifications_enabled=excluded.notifications_enabled, pin=excluded.pin, onboarded=excluded.onboarded,
           bio_enabled=excluded.bio_enabled, lang=excluded.lang, theme=excluded.theme, active_month=excluded.active_month,
           currency=excluded.currency, categories=excluded.categories, hidden_categories=excluded.hidden_categories,
           budgets=excluded.budgets, app_lock=excluded.app_lock,
           photo_data=excluded.photo_data, category_icons=excluded.category_icons, category_colors=excluded.category_colors,
           arabic_numerals=excluded.arabic_numerals, birthday=excluded.birthday,
           accounts=excluded.accounts, default_account=excluded.default_account`,
        [uid, !!settings.notificationsEnabled, settings.pin || '', !!settings.onboarded, !!settings.bioEnabled,
         settings.lang || 'ar', settings.theme || 'light', settings.activeMonth || '', settings.currency || 'IQD',
         JSON.stringify(settings.categories || []), JSON.stringify(settings.hiddenCategories || []),
         JSON.stringify(settings.budgets || {}), !!settings.appLock,
         settings.photoData || '', JSON.stringify(settings.categoryIcons || {}), JSON.stringify(settings.categoryColors || {}),
         !!settings.arabicNumerals, settings.birthday || '',
         JSON.stringify(settings.accounts || []), settings.defaultAccount || '']
      );
    }

    if (months && typeof months === 'object') {
      await client.query('delete from months where user_id=$1', [uid]); // cascade يمسح الأبناء
      for (const key of Object.keys(months)) {
        const m = months[key] || {};
        const pr = m.primary || {};
        const mr = await client.query(
          'insert into months(user_id, key, primary_name, primary_amount, transfers) values($1,$2,$3,$4,$5) returning id',
          [uid, key, pr.name || 'Salary', num(pr.amount), JSON.stringify(mo.transfers || [])]
        );
        const mid = mr.rows[0].id;

        for (const s of (m.secondary || []))
          await client.query('insert into incomes(month_id,name,amount,is_primary) values($1,$2,$3,false)',
            [mid, s.name || '', num(s.amount)]);
        for (const l of (m.loans || []))
          await client.query('insert into loans(month_id,name,amount,paid,dir,type,monthly,end_date,deduct_from_balance,paid_before) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
            [mid, l.name || '', num(l.amount), num(l.paid), l.dir || 'owe', l.type || 'lump', num(l.monthly), l.endDate || '', l.deductFromBalance !== false, num(l.paidBefore)]);
        for (const i of (m.installments || []))
          await client.query('insert into installments(month_id,name,total,monthly,paid,due_day,paid_before) values($1,$2,$3,$4,$5,$6,$7)',
            [mid, i.name || '', num(i.total), num(i.monthly), num(i.paid), i.dueDay == null ? null : parseInt(i.dueDay, 10), num(i.paidBefore)]);
        for (const g of (m.goals || []))
          await client.query('insert into goals(month_id,name,target,saved,monthly,saved_before,target_date) values($1,$2,$3,$4,$5,$6,$7)',
            [mid, g.name || '', num(g.target), num(g.saved), num(g.monthly), num(g.savedBefore), g.targetDate || null]);
        for (const f of (m.fixed || []))
          await client.query('insert into fixed_expenses(month_id,name,cost,paid,category,kind) values($1,$2,$3,$4,$5,$6)',
            [mid, f.name || '', num(f.cost), !!f.paid, f.category || 'Fixed', f.kind || 'essential']);
        for (const d of (m.daily || []))
          await client.query('insert into daily_expenses(month_id,name,amount,category,kind,date,ts,note,receipt,account) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
            [mid, d.name || '', num(d.amount), d.category || 'Other', d.kind || 'essential', d.date || '', num(d.ts), d.note || '', d.receipt || '', d.account || '']);
        for (const gf of (m.gifts || []))
          await client.query('insert into gifts(month_id,name,amount,note,date) values($1,$2,$3,$4,$5)',
            [mid, gf.name || '', num(gf.amount), gf.note || '', gf.date || '']);
        for (const grp of (m.groups || [])) {
          const gr = await client.query('insert into custom_groups(month_id,name,icon) values($1,$2,$3) returning id',
            [mid, grp.name || '', grp.icon || 'square.grid.2x2']);
          const grid = gr.rows[0].id;
          for (const it of (grp.items || []))
            await client.query('insert into group_items(group_id,name,amount,date) values($1,$2,$3,$4)',
              [grid, it.name || '', num(it.amount), it.date || '']);
        }
      }
    }

    await client.query('commit');
    res.json({ ok: true });
  } catch (err) {
    await client.query('rollback');
    console.error(err);
    res.status(500).json({ error: 'save_failed' });
  } finally {
    client.release();
  }
});

module.exports = router;
