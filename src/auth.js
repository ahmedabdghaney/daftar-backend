const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { pool } = require('./db');

const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

function sign(userId) {
  return jwt.sign({ sub: userId }, SECRET, { expiresIn: '30d' });
}

function hash(pw) { return bcrypt.hash(pw, 10); }
function compare(pw, h) { return bcrypt.compare(pw, h); }

async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'no_token' });
  try {
    const payload = jwt.verify(token, SECRET);
    // نتحقق إن المستخدم لسه موجود (لو محذوف من اللوحة يصير التوكن غير صالح فوراً)
    const exists = await pool.query('select 1 from users where id=$1', [payload.sub]);
    if (exists.rows.length === 0) return res.status(401).json({ error: 'account_deleted' });
    req.userId = payload.sub;
    next();
  } catch {
    return res.status(401).json({ error: 'bad_token' });
  }
}

module.exports = { sign, hash, compare, requireAuth };
