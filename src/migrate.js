require('dotenv').config();
const { initDb } = require('./initDb');

initDb()
  .then(() => { console.log('Migration done'); process.exit(0); })
  .catch((e) => { console.error('Migration failed', e); process.exit(1); });
