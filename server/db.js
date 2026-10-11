const cfg = require('../config/config');
const { TABLES, createSql } = require('./schema');
const { fail } = require('./util');

const JSON_COLS = ['resources', 'ranges'];
const BOOL_COLS = ['fullDay', 'read', 'deleted', 'isSuper', 'resolved'];
let txConn = null;  
const q = n => '`' + String(n).replace(/`/g, '') + '`';
let pool = null;

function getPool() {
  if (!pool) {
    pool = require('mysql2/promise').createPool({ ...cfg.mysql, waitForConnections: true, connectionLimit: 10, charset: 'utf8mb4', dateStrings: true });
  }
  return pool;
}
function setPool(p) { pool = p; }  

const pkOf = t => TABLES[t].pk || 'id';
function fromDb(t, row) {
  const o = {};
  Object.keys(TABLES[t].cols).forEach(k => {
    let v = row[k];
    if (BOOL_COLS.includes(k)) v = !!Number(v);
    else if (JSON_COLS.includes(k)) { try { v = v ? JSON.parse(v) : []; } catch (e) { v = []; } }
    else if (v === null || v === undefined) v = /INT/.test(TABLES[t].cols[k]) ? null : '';
    o[k] = v;
  });
  return o;
}
function toDb(k, v) {
  if (BOOL_COLS.includes(k)) return v ? 1 : 0;
  if (JSON_COLS.includes(k)) return JSON.stringify(v || []);
  return v === undefined ? null : v;
}

async function run(sql, params = []) { const [r] = await (txConn || getPool()).query(sql, params); return r; }
async function rows(t, where = {}) {
  const k = Object.keys(where);
  const r = await run(`SELECT * FROM ${q(t)}${k.length ? ' WHERE ' + k.map(c => q(c) + '=?').join(' AND ') : ''} ORDER BY ${q('seq')}`, k.map(c => where[c]));
  return r.map(x => fromDb(t, x));
}
async function one(t, where) { return (await rows(t, where))[0]; }
async function add(t, o) {
  const cols = Object.keys(TABLES[t].cols).filter(c => o[c] !== undefined);
  await run(`INSERT INTO ${q(t)} (${cols.map(q).join(',')}) VALUES (${cols.map(() => '?').join(',')})`, cols.map(c => toDb(c, o[c])));
  return o;
}
async function upd(t, id, patch) {
  const cols = Object.keys(patch).filter(c => c in TABLES[t].cols);
  if (!cols.length) return false;
  const r = await run(`UPDATE ${q(t)} SET ${cols.map(c => q(c) + '=?').join(',')} WHERE ${q(pkOf(t))}=?`, [...cols.map(c => toDb(c, patch[c])), id]);
  return (r.affectedRows || r.changes || 0) > 0;
}
async function updWhere(t, where, patch) {
  const w = Object.keys(where), c = Object.keys(patch).filter(k => k in TABLES[t].cols);
  if (!c.length) return;
  await run(`UPDATE ${q(t)} SET ${c.map(k => q(k) + '=?').join(',')} WHERE ${w.map(k => q(k) + '=?').join(' AND ')}`, [...c.map(k => toDb(k, patch[k])), ...w.map(k => where[k])]);
}
 
async function bulkInsert(t, list) {
  const cols = Object.keys(TABLES[t].cols);
  for (let i = 0; i < list.length; i += 200) {
    const part = list.slice(i, i + 200);
    await run(`INSERT INTO ${q(t)} (${cols.map(q).join(',')}) VALUES ${part.map(() => '(' + cols.map(() => '?').join(',') + ')').join(',')}`,
      part.flatMap(o => cols.map(c => toDb(c, o[c]))));
  }
}
 
async function transaction(fn) {
  const c = await getPool().getConnection();
  try {
    await c.beginTransaction(); txConn = c;
    try { const r = await fn(); await c.commit(); return r; } catch (e) { await c.rollback(); throw e; }
  } finally { txConn = null; c.release(); }
}
async function del(t, where) {
  const k = Object.keys(where);
  await run(`DELETE FROM ${q(t)} WHERE ${k.map(c => q(c) + '=?').join(' AND ')}`, k.map(c => where[c]));
}
async function clearAll() { for (const t of Object.keys(TABLES)) await run(`DELETE FROM ${q(t)}`); }

 
async function withLock(fn) {
  const c = await getPool().getConnection();
  try {
    const [r] = await c.query("SELECT GET_LOCK('campushub_write', 25) AS l");
    if (!r[0].l) fail('The system is busy right now. Please try again in a moment.');
    try { return await fn(); } finally { await c.query("SELECT RELEASE_LOCK('campushub_write')"); }
  } finally { c.release(); }
}

 
async function ensureSchema() {
  for (const t of Object.keys(TABLES)) {
    await run(createSql(t));
    const have = (await run(`SHOW COLUMNS FROM ${q(t)}`)).map(r => r.Field);
    for (const [c, ty] of Object.entries(TABLES[t].cols)) {
      if (!have.includes(c)) await run(`ALTER TABLE ${q(t)} ADD COLUMN ${q(c)} ${ty} NULL`);
    }
  }
}
async function setting(key) { const r = await one('Settings', { key }); return r ? r.value : ''; }
async function setSetting(key, value) { if (!(await upd('Settings', key, { value }))) await add('Settings', { key, value }); }
async function seedDefaults(force) {
  for (const k of Object.keys(cfg.seed)) if (force || (await setting(k)) === '') await setSetting(k, JSON.stringify(cfg.seed[k]));
}
module.exports = { setPool, getPool, run, rows, one, add, upd, updWhere, bulkInsert, transaction, del, clearAll, withLock, ensureSchema, setting, setSetting, seedDefaults };
