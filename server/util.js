const crypto = require('crypto');
const cfg = require('../config/config');

class UserError extends Error { constructor(m, code) { super(m); this.user = true; this.code = code || ''; } }
const fail = (m, code) => { throw new UserError(m, code); };

const pad = n => String(n).padStart(2, '0');
const mins = t => { const a = String(t).split(':'); return +a[0] * 60 + +a[1]; };
const hhmm = m => pad(Math.floor(m / 60)) + ':' + pad(m % 60);
const fmt = t => { const m = mins(t), h = Math.floor(m / 60); return (h % 12 || 12) + ':' + pad(m % 60) + (h >= 12 ? ' PM' : ' AM'); };
const iso = () => new Date().toISOString();
const overlap = (s1, e1, s2, e2) => Math.max(mins(s1), mins(s2)) < Math.min(mins(e1), mins(e2));

 
function nowTZ() {
  const p = {};
  new Intl.DateTimeFormat('en-CA', { timeZone: cfg.timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date()).forEach(x => { p[x.type] = x.value; });
  return { date: `${p.year}-${p.month}-${p.day}`, min: +p.hour * 60 + +p.minute };
}

const newId = () => crypto.randomBytes(5).toString('hex');
const hashPw = (pw, salt) => crypto.scryptSync(String(pw), salt, 64).toString('hex');
function newPw(pw) {
  if (String(pw || '').length < 6) fail('Password must be at least 6 characters long.');
  const salt = crypto.randomBytes(16).toString('hex');
  return { salt, hash: hashPw(pw, salt) };
}
function checkPw(pw, rec) {
  if (!rec) return false;
  const a = Buffer.from(hashPw(pw, rec.salt)), b = Buffer.from(String(rec.hash));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function hasText(v, label, max) {
  const s = String(v || '').trim();
  if (!s) fail('Enter ' + label + '.');
  return s.slice(0, max || 200);
}
function phoneOk(p) { if (!/^[0-9]{10}$/.test(String(p || ''))) fail('Enter a valid 10-digit phone number.'); return String(p); }
function cleanList(a, label) {
  const seen = {}, out = [];
  (a || []).forEach(x => { const t = String(x).trim().slice(0, 60), k = t.toLowerCase(); if (t && !seen[k]) { seen[k] = 1; out.push(t); } });
  if (!out.length) fail('Keep at least one item in ' + label + '.');
  return out.slice(0, 30);
}
const stripSecrets = o => { const c = Object.assign({}, o); delete c.salt; delete c.hash; return c; };

module.exports = { UserError, fail, pad, mins, hhmm, fmt, iso, overlap, nowTZ, newId, newPw, checkPw, hasText, phoneOk, cleanList, stripSecrets };
