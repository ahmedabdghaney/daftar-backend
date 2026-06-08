require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { initDb } = require('./initDb');

const app = express();
app.use(cors());
app.use(express.json({ limit: '4mb' }));

app.get('/', (req, res) => res.json({ name: 'Daftar API', status: 'ok' }));
app.get('/health', (req, res) => res.json({ ok: true }));

app.use('/api/auth', require('./routes/auth'));
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
