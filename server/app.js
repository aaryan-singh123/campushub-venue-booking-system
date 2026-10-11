const express = require('express');
const path = require('path');
const cfg = require('../config/config');
const db = require('./db');
const fs = require('fs');
const { A, auth, UPLOAD_DIR, backfill } = require('./actions');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'SAMEORIGIN', 'Referrer-Policy': 'same-origin' });
  next();
});
 
const smallJson = express.json({ limit: '6mb' }), bigJson = express.json({ limit: '150mb' });
app.use('/api', (req, res, next) => (req.get('X-Action') === 'restoreBackup' && req.get('Authorization') ? bigJson : smallJson)(req, res, next));

 
const tries = new Map();
const LIMITED = ['login', 'adminLogin', 'signup', 'adminSignup', 'forgotPassword'];
function tooMany(ip) {
  const now = Date.now(), list = (tries.get(ip) || []).filter(t => now - t < 600000);
  list.push(now); tries.set(ip, list);
  return list.length > 20;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of tries) if (!v.some(t => now - t < 600000)) tries.delete(k); }, 600000).unref();

app.post('/api', async (req, res) => {
  const { action, data } = req.body || {};
  let out;
  try {
    const a = Object.prototype.hasOwnProperty.call(A, action) ? A[action] : null;
    if (!a) throw Object.assign(new Error('Something went wrong. Please try again.'), { user: true });
    if (LIMITED.includes(action) && tooMany(req.ip)) throw Object.assign(new Error('Too many attempts. Please wait a few minutes and try again.'), { user: true });
    const token = (req.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const result = await db.withLock(async () => {
      let c = null;
      if (!a.pub) {
        c = await auth(token);
        if (a.admin && c.role !== 'admin') { const e = new Error('Only an admin can do this.'); e.user = true; throw e; }
      }
      return a.fn(data || {}, c, token);
    });
    out = { ok: true, data: result };
  } catch (err) {
    if (!err.user) console.error(new Date().toISOString(), '[error]', action, err && err.stack || err);
    out = { ok: false, error: err.user ? err.message : 'Something went wrong. Please try again.', code: err.code || '' };
  }
  res.json(out);
});

app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d' }));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use((err, req, res, next) => res.status(400).json({ ok: false, error: 'Something went wrong. Please try again.' }));

(async () => {
  try {
    await db.ensureSchema();
    await db.seedDefaults(false);
    await backfill();
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    const lost = (await db.rows('Venues')).filter(v => v.photo && !fs.existsSync(path.join(UPLOAD_DIR, path.basename(v.photo))));
    if (lost.length) console.warn('WARNING: ' + lost.length + ' venue photo file(s) are in the database but missing from the uploads folder: ' + lost.map(v => v.name + ' (' + v.photo + ')').join(', ') + '\nCopy those files into the folder above, or upload the photos again from Admin > Venues > Edit.');
  } catch (e) {
    console.error('\nCould not connect to MySQL. Open config/config.js and check host, user, password and database name.\nDetails:', e.message, '\n');
    process.exit(1);
  }
  app.listen(cfg.port, () => console.log(new Date().toISOString(), 'CampusHub is running on port ' + cfg.port));
})();
