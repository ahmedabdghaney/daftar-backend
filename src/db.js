const { Pool, types } = require('pg');

// خلي NUMERIC يرجع رقم مو نص (لو استخدمت numeric)
types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false,
});

module.exports = { pool };
