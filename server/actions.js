



const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const cfg = require('../config/config');
const db = require('./db');
const { TABLES, BACKUP_TABLES, SCHEMA_VERSION } = require('./schema');
const { fail, mins, hhmm, fmt, iso, overlap, nowTZ, newId, newPw, checkPw, hasText, phoneOk, cleanList, stripSecrets } = require('./util');

const LIVE = ['Pending', 'Approved'];
const UPLOAD_DIR = cfg.uploadDir ? path.resolve(cfg.uploadDir) : path.join(__dirname, '..', 'uploads');
const log = (action, by) => db.add('Logs', { id: newId(), date: iso(), action, by });
const note = (userId, text, extra) => db.add('Notifications', Object.assign({ id: newId(), userId, text, date: iso(), read: false }, extra || {}));
const ended = b => { const n = nowTZ(); return b.date < n.date || (b.date === n.date && mins(b.end) <= n.min); };
const isFuture = b => { const n = nowTZ(); return !(b.date < n.date || (b.date === n.date && mins(b.start) <= n.min)); };
const adminLabel = rec => (rec.name || 'Admin') + ' (Admin)';
const PHOTO_URL = /^\/uploads\/[a-f0-9]{16}\.(png|jpg|webp)$/;

 
const REASON_TAIL = {
  ACCOUNT_BLOCKED: 'because the committee account was blocked by the administration.',
  ACCOUNT_DELETED: 'because the committee account was deleted.',
  VENUE_CLOSED: 'because the venue is closed on the selected date.',
  VENUE_REMOVED: 'because the venue was removed from the system.',
  VENUE_TIMING: 'because the venue timings were changed.'
};
const autoReason = (code, verb, extra) => verb + ' automatically ' + REASON_TAIL[code] + (extra ? ' ' + extra : '');

async function settings() {
  const o = {};
  (await db.rows('Settings')).forEach(r => { o[r.key] = r.value; });
  ['categories', 'committeeTypes'].forEach(k => { try { o[k] = JSON.parse(o[k] || '[]'); } catch (e) { o[k] = []; } });
  o.refreshSeconds = cfg.refreshSeconds;
  return o;
}
async function refreshStatuses() {
  for (const b of await db.rows('Bookings', { status: 'Approved' })) if (ended(b)) await db.upd('Bookings', b.id, { status: 'Completed' });
}






const CODE_RE = /^CH-(\d{6})-(\d+)$/;
const ddmmyy = date => String(date).slice(8, 10) + String(date).slice(5, 7) + String(date).slice(2, 4);
const codeOf = (date, n) => 'CH-' + ddmmyy(date) + '-' + String(n).padStart(2, '0');
async function lastBookingNumber() {
  let max = 0;
  for (const b of await db.rows('Bookings')) { const m = CODE_RE.exec(String(b.id)); if (m && +m[2] > max) max = +m[2]; }
  return max;
}
async function nextBookingId(date) { return codeOf(date, (await lastBookingNumber()) + 1); }

 
async function closureHit(vid, date, s, e) {
  return (await db.rows('Closures', { venueId: vid, date })).some(c => c.fullDay || c.ranges.some(r => overlap(s, e, r.start, r.end)));
}
async function clash(vid, date, s, e, skip) {
  return (await db.rows('Bookings', { venueId: vid, date })).filter(b => b.id !== skip && LIVE.includes(b.status) && overlap(s, e, b.start, b.end));
}
async function checkSlot(b, v, skip) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date) || !/^\d{2}:\d{2}$/.test(b.start) || !/^\d{2}:\d{2}$/.test(b.end)) fail('Select a date, start time and end time.');
  if (mins(b.start) >= mins(b.end)) fail('End time must be later than start time.');
  if (mins(b.start) < mins(v.openTime) || mins(b.end) > mins(v.closeTime)) fail('This venue is available only from ' + fmt(v.openTime) + ' to ' + fmt(v.closeTime) + '.');
  const n = nowTZ();
  if (b.date < n.date || (b.date === n.date && mins(b.start) <= n.min)) fail('The selected time has already passed. Select a later time.');
  if (await closureHit(v.id, b.date, b.start, b.end)) fail('The venue is closed at the selected date or time.');
  if ((await clash(v.id, b.date, b.start, b.end, skip)).length) fail('This time slot is already booked. Select a different time.');
}
function checkRes(req, v) {
  const seen = {};
  return (req || []).map(r => {
    const a = v.resources.find(x => x.name === r.name), q = parseInt(r.qty, 10);
    if (!a) fail('"' + r.name + '" is not available at this venue.');
    if (seen[a.name]) fail('"' + a.name + '" is selected twice.');
    seen[a.name] = 1;
    if (!(q >= 1)) fail('Enter the quantity required for "' + a.name + '".');
    if (q > parseInt(a.qty, 10)) fail('Only ' + a.qty + ' ' + a.name + ' available at this venue. Requested: ' + q + '.');
    return { name: a.name, qty: q };
  });
}
const organizerOf = (b, who) => b.bookedByName || (b.userId && who && who[b.userId]) || 'Admin';
async function brief(b) {
  const u = b.userId ? await db.one('Users', { id: b.userId }) : null;
  return { id: b.id, title: b.title, date: b.date, start: b.start, end: b.end, status: b.status, by: b.bookedByName || (u ? u.committee : 'Admin') };
}





async function clear(list, code, by, opts) {
  const o = opts || {};
  for (const b of list) {
    const rejected = b.status === 'Pending' && !o.force, st = rejected ? 'Rejected' : 'Cancelled';
    const reason = autoReason(code, st, o.extra);
    const patch = { status: st, reason, reasonCode: code, cancelledBy: 'System' };
    patch[rejected ? 'rejectedAt' : 'cancelledAt'] = iso();
    await db.upd('Bookings', b.id, patch);
    if (b.userId && !o.silent) await note(b.userId, 'Your booking "' + b.title + '" on ' + b.date + ' (' + fmt(b.start) + ' - ' + fmt(b.end) + '): ' + reason);
    await log(st + ' booking "' + b.title + '" - ' + code, by);
  }
}
async function liveFuture(fn) { return (await db.rows('Bookings')).filter(b => LIVE.includes(b.status) && !ended(b) && fn(b)); }
 
async function confirmOrClear(affected, d, code, extra, by, what) {
  if (affected.length && !d.confirm) {
    return { needConfirm: true, affected: await Promise.all(affected.map(brief)), message: what + ' ' + affected.length + ' booking(s) are affected. Do you want to reject or cancel them? The people who booked will be notified.' };
  }
  await clear(affected, code, by, { extra });
  return null;
}

 
function removeUpload(url) {
  if (!url || !String(url).startsWith('/uploads/')) return;
  fs.promises.unlink(path.join(UPLOAD_DIR, path.basename(url))).catch(() => { });
}

 
async function startSession(id, role) {
  for (const s of await db.rows('Sessions')) if (Number(s.expires) < Date.now()) await db.del('Sessions', { token: s.token });
  const token = crypto.randomBytes(32).toString('hex');
  await db.add('Sessions', { token, userId: id, role, expires: Date.now() + cfg.sessionHours * 3600000 });
  return token;
}
async function auth(token) {
  const s = token ? await db.one('Sessions', { token }) : null;
  if (!s || Number(s.expires) < Date.now()) fail('Your session has expired. Please sign in again.', 'SESSION');
  const rec = await db.one(s.role === 'admin' ? 'Admins' : 'Users', { id: s.userId });
  if (!rec) fail('Your session has expired. Please sign in again.', 'SESSION');
  if (s.role === 'user' && rec.status !== 'approved') { await db.del('Sessions', { userId: rec.id }); fail('Your account is not active. Please contact the admin.', 'SESSION'); }
  if (s.role === 'admin' && rec.status !== 'approved') fail('Your session has expired. Please sign in again.', 'SESSION');
  return { role: s.role, id: rec.id, rec, name: s.role === 'admin' ? rec.name : rec.committee };
}
async function otherAdmins(exceptId) { return (await db.rows('Admins')).filter(a => a.status === 'approved' && a.id !== exceptId); }

 
async function backfill() {
  const users = await db.rows('Users'), venues = await db.rows('Venues');
  for (const b of await db.rows('Bookings')) {
    const p = {}, u = users.find(x => x.id === b.userId), v = venues.find(x => x.id === b.venueId);
    if (!b.bookedByRole) p.bookedByRole = b.userId ? 'committee' : 'admin';
    if (!b.organizerKind) p.organizerKind = b.userId ? 'committee' : 'external';
    if (!b.bookedByName && u) p.bookedByName = u.committee;
    if (!b.inchargeName && u) { p.inchargeName = u.incharge; p.inchargePhone = u.phone; }
    if (!b.venueLocation && v) p.venueLocation = v.location;
    if (Object.keys(p).length) await db.upd('Bookings', b.id, p);
  }
  await convertOldIds();
}
 
async function convertOldIds() {
  const all = await db.rows('Bookings'), old = all.filter(b => !CODE_RE.test(String(b.id)) && /^\d{4}-\d{2}-\d{2}$/.test(b.date));
  if (!old.length) return 0;
  let n = await lastBookingNumber();
  const order = old.map((b, i) => ({ b, i })).sort((x, y) => String(x.b.createdAt || '').localeCompare(String(y.b.createdAt || '')) || x.i - y.i);
  for (const x of order) await db.upd('Bookings', x.b.id, { id: codeOf(x.b.date, ++n) });
  console.log(iso(), old.length + ' old booking ID(s) changed to the CH-DDMMYY-NN format');
  return old.length;
}

 
async function deleteGuard(c) {
  if (c.role === 'admin' && !(await otherAdmins(c.id)).length) fail('You are the only administrator. Add and approve another admin before deleting this account.');
}
async function archive(c, extra) {
  const r = c.rec, isAdmin = c.role === 'admin';
  await db.add('DeletedAccounts', { id: r.id, role: c.role, name: isAdmin ? r.name : r.committee, username: isAdmin ? r.username : '', type: isAdmin ? (r.isSuper ? 'Main admin' : 'Admin') : r.type,
    incharge: isAdmin ? '' : r.incharge, phone: r.phone, createdAt: r.createdAt, deletedAt: iso(), bookingsCancelled: extra || 0 });
}

 
const A = {
  publicInfo: { pub: 1, fn: async () => ({ settings: { committeeTypes: (await settings()).committeeTypes, refreshSeconds: cfg.refreshSeconds } }) },

  signup: { pub: 1, fn: async d => {
    const name = hasText(d.committee, 'the committee name', 80), pw = newPw(d.password);
    if (!(await settings()).committeeTypes.includes(d.type)) fail('Select a valid committee type.');
    if ((await db.rows('Users')).some(u => u.committee.toLowerCase() === name.toLowerCase())) fail('This committee name is already registered.');
    await db.add('Users', { id: newId(), committee: name, type: d.type, incharge: hasText(d.incharge, 'the in-charge name', 80), phone: phoneOk(d.phone), salt: pw.salt, hash: pw.hash, status: 'pending', createdAt: iso() });
    await log('New account request: ' + name, 'System');
    return true;
  } },

  login: { pub: 1, fn: async d => {
    const u = (await db.rows('Users')).find(x => x.committee.toLowerCase() === String(d.committee || '').trim().toLowerCase());
    if (!u || !checkPw(String(d.password || ''), u)) fail('Incorrect committee name or password.');
    if (u.status === 'pending') fail('Your account is pending admin approval.', 'PENDING');
    if (u.status === 'rejected') fail('Your registration was rejected. Please contact the admin.', 'REJECTED');
    if (u.status === 'blocked') fail('Your account has been blocked. Please contact the admin.', 'BLOCKED');
    return { token: await startSession(u.id, 'user') };
  } },

  adminSignup: { pub: 1, fn: async d => {
    const name = hasText(d.name, 'your name', 80), un = hasText(d.username, 'a username', 40), pw = newPw(d.password), phone = phoneOk(d.phone);
    const admins = await db.rows('Admins');
    if (admins.some(a => a.username.toLowerCase() === un.toLowerCase())) fail('This username is already taken.');
    const first = admins.length === 0;  
    const a = { id: newId(), name, phone, username: un, salt: pw.salt, hash: pw.hash, status: first ? 'approved' : 'pending', isSuper: first, createdAt: iso() };
    await db.add('Admins', a);
    if (first) { await log('Main admin created: ' + name, 'System'); return { first: true }; }
    const sup = admins.find(x => x.isSuper);
    if (sup) await note(sup.id, 'New admin request from "' + name + '" (username: ' + un + '). Please accept or reject.', { type: 'admin_request', reqAdminId: a.id, resolved: false });
    await log('New admin request: ' + name, 'System');
    return { first: false };
  } },

  adminLogin: { pub: 1, fn: async d => {
    const a = (await db.rows('Admins')).find(x => x.username.toLowerCase() === String(d.username || '').trim().toLowerCase());
    if (!a || !checkPw(String(d.password || ''), a)) fail('Incorrect username or password.');
    if (a.status !== 'approved') fail('Your admin account is pending approval from the main admin.', 'PENDING');
    return { token: await startSession(a.id, 'admin') };
  } },

  logout: { fn: async (d, c, token) => { await db.del('Sessions', { token }); return true; } },

  bootstrap: { fn: async (d, c) => {
    await refreshStatuses();
    const adm = c.role === 'admin', uid = c.id, who = {};
    const bk = await db.rows('Bookings'), users = await db.rows('Users'), admins = await db.rows('Admins');
    users.forEach(u => { who[u.id] = u.committee; });
    const full = b => Object.assign({}, b, { bookedByRole: b.bookedByRole || (b.userId ? 'committee' : 'admin'), bookedByName: organizerOf(b, who) });
    return {
      role: c.role, me: stripSecrets(c.rec), settings: await settings(), venues: await db.rows('Venues'), closures: await db.rows('Closures'),
      bookings: adm ? bk.map(full) : bk.filter(b => b.userId === uid || ['Pending', 'Approved', 'Completed'].includes(b.status))
        .map(b => b.userId === uid ? full(b) : { id: b.id, venueId: b.venueId, date: b.date, start: b.start, end: b.end, status: b.status, title: b.title, by: organizerOf(b, who) }),
      users: adm ? users.map(stripSecrets) : [],
      admins: admins.filter(a => adm || a.status === 'approved').map(a => adm ? stripSecrets(a) : { id: a.id, name: a.name }),
      deletedAccounts: adm ? (await db.rows('DeletedAccounts')).map(x => ({ id: x.id, role: x.role, name: x.name, username: x.username, type: x.type, deletedAt: x.deletedAt, bookingsCancelled: x.bookingsCancelled })) : [],
      notifications: (await db.rows('Notifications', { userId: uid })),
      chats: (await db.rows('Chats')).filter(m => m.fromId === uid || m.toId === uid),
      logs: adm ? (await db.rows('Logs')).slice(-300) : [],
      serverNow: nowTZ()
    };
  } },

   
  createBooking: { fn: async (d, c) => {
    const v = await db.one('Venues', { id: d.venueId });
    if (!v) fail('This venue is no longer available.');
    const b = { venueId: v.id, venueName: v.name, venueLocation: v.location, title: hasText(d.title, 'the event title', 120), category: String(d.category || '').slice(0, 60),
      desc: String(d.desc || '').slice(0, 500), date: d.date, start: d.start, end: d.end, attendees: parseInt(d.attendees, 10) || 0 };
    if (b.attendees < 1) fail('Enter the number of expected attendees.');
    if (b.attendees > v.capacity) fail('This venue can hold up to ' + v.capacity + ' people. Please enter ' + v.capacity + ' or fewer attendees.');
    await checkSlot(b, v);
    b.resources = checkRes(d.resources, v);
    let owner = null;
    if (c.role === 'admin') {
      Object.assign(b, { bookedByRole: 'admin', status: 'Approved', approvedAt: iso(), adminId: c.id, adminName: String(c.rec.name || 'Admin').slice(0, 80), adminUsername: String(c.rec.username || '').slice(0, 40) });
      if (d.forType === 'external') {
        Object.assign(b, { userId: '', organizerKind: 'external', bookedByName: hasText(d.bookedByName, 'the name of who is booking', 80), inchargeName: '', inchargePhone: '' });
        if (d.phone) b.inchargePhone = phoneOk(d.phone);
      } else {
        owner = await db.one('Users', { id: d.forUserId });
        if (!owner || owner.status !== 'approved') fail('Select a committee from the list, or choose External.');
        Object.assign(b, { userId: owner.id, organizerKind: 'committee', bookedByName: owner.committee, inchargeName: owner.incharge, inchargePhone: owner.phone });
      }
    } else {
      Object.assign(b, { bookedByRole: 'committee', organizerKind: 'committee', userId: c.id, bookedByName: c.rec.committee, inchargeName: c.rec.incharge, inchargePhone: c.rec.phone, status: 'Pending' });
    }
    b.id = await nextBookingId(b.date);  
    b.createdAt = iso();
    await db.add('Bookings', b);
    if (owner) await note(owner.id, adminLabel(c.rec) + ' booked "' + b.title + '" for your committee at ' + v.name + ' on ' + b.date + ' (' + fmt(b.start) + ' - ' + fmt(b.end) + '). You can view, print or cancel it from My History.');
    await log('Booking ' + (c.role === 'admin' ? 'added by admin for ' + b.bookedByName : 'requested') + ': ' + b.title, c.name);
    return { booking: b };
  } },

   
  previewDecision: { admin: 1, fn: async d => {
    const b = await db.one('Bookings', { id: d.id }); if (!b) fail('This booking was not found.');
    const v = await db.one('Venues', { id: b.venueId });
    const sameDay = (await db.rows('Bookings', { venueId: b.venueId, date: b.date })).filter(x => x.id !== b.id && LIVE.includes(x.status));
    return { booking: await brief(b), venue: v ? { name: v.name, capacity: v.capacity, openTime: v.openTime, closeTime: v.closeTime } : null,
      closures: await db.rows('Closures', { venueId: b.venueId, date: b.date }),
      sameDay: await Promise.all(sameDay.map(brief)),
      clashes: await Promise.all((await clash(b.venueId, b.date, b.start, b.end, b.id)).map(brief)), attendees: b.attendees };
  } },

  decideBooking: { admin: 1, fn: async (d, c) => {
    const b = await db.one('Bookings', { id: d.id });
    if (!b || b.status !== 'Pending') fail('This request has already been handled.');
    if (d.status === 'Rejected') {
      const r = hasText(d.reason, 'a reason for rejecting', 300), reason = 'Rejected by ' + adminLabel(c.rec) + '. Reason: ' + r;
      await db.upd('Bookings', b.id, { status: 'Rejected', reason, reasonCode: 'ADMIN_REJECTED', cancelledBy: adminLabel(c.rec), rejectedAt: iso() });
      if (b.userId) await note(b.userId, 'Your booking "' + b.title + '" was rejected. Reason: ' + r);
    } else {
      const v = await db.one('Venues', { id: b.venueId });
      if (!v) fail('This venue no longer exists, so the booking cannot be approved.');
      await checkSlot(b, v, b.id);
      await db.upd('Bookings', b.id, { status: 'Approved', approvedAt: iso(), adminId: c.id, adminName: c.rec.name, adminUsername: c.rec.username });
      if (b.userId) await note(b.userId, 'Your booking "' + b.title + '" on ' + b.date + ' was approved.');
    }
    await log(d.status + ' booking "' + b.title + '"', c.name);
    return true;
  } },

  cancelBooking: { fn: async (d, c) => {
    const b = await db.one('Bookings', { id: d.id }); if (!b) fail('This booking was not found.');
    if (b.status === 'Completed') fail('A completed event cannot be cancelled.');
    if (!LIVE.includes(b.status)) fail('This booking is already closed.');
    if (c.role === 'user') {
      if (b.userId !== c.id) fail('You can cancel only your own bookings.');
      if (!isFuture(b)) fail('This event has already started, so it cannot be cancelled.');
      await db.upd('Bookings', b.id, { status: 'Cancelled', reasonCode: 'USER_CANCELLED', cancelledBy: 'Organizer', cancelledAt: iso(), reason: 'Cancelled by the organizer (' + c.rec.committee + ').' });
      if (b.bookedByRole === 'admin' && b.adminId) await note(b.adminId, c.rec.committee + ' cancelled the booking "' + b.title + '" on ' + b.date + ' that was made by ' + (b.adminName || 'an admin') + '.');
    } else {
      const r = hasText(d.reason, 'a reason for cancelling', 300);
      await db.upd('Bookings', b.id, { status: 'Cancelled', reasonCode: 'ADMIN_CANCELLED', cancelledBy: adminLabel(c.rec), cancelledAt: iso(), reason: 'Cancelled by ' + adminLabel(c.rec) + '. Reason: ' + r });
      if (b.userId) await note(b.userId, 'Your booking "' + b.title + '" on ' + b.date + ' was cancelled by ' + adminLabel(c.rec) + '. Reason: ' + r);
    }
    await log('Cancelled booking "' + b.title + '"', c.name);
    return true;
  } },

   
  saveVenue: { admin: 1, fn: async (d, c) => {
    const v = { name: hasText(d.name, 'the venue name', 100), capacity: parseInt(d.capacity, 10), location: hasText(d.location, 'the location', 150),
      openTime: d.openTime, closeTime: d.closeTime, resources: (d.resources || []).map(r => ({ name: hasText(r.name, 'the resource name', 60), qty: parseInt(r.qty, 10) })) };
    if (!(v.capacity >= 1)) fail('Enter the venue capacity.');
    if (v.resources.some(r => !(r.qty >= 1))) fail('Every resource needs a quantity of 1 or more.');
    if (!/^\d{2}:\d{2}$/.test(d.openTime || '') || !/^\d{2}:\d{2}$/.test(d.closeTime || '') || mins(d.openTime) >= mins(d.closeTime)) fail('The closing time must be later than the opening time.');
    if (d.photo) { if (!PHOTO_URL.test(String(d.photo))) fail('Select a PNG, JPG or WEBP image.'); v.photo = String(d.photo); }
    if (!d.id) { v.id = newId(); v.photo = v.photo || ''; await db.add('Venues', v); await log('Added venue: ' + v.name, c.name); return { saved: true }; }
    const old = await db.one('Venues', { id: d.id }); if (!old) fail('This venue was not found.');
    const out = await liveFuture(b => b.venueId === old.id && (mins(b.start) < mins(v.openTime) || mins(b.end) > mins(v.closeTime)));
    const ask = await confirmOrClear(out, d, 'VENUE_TIMING', 'New timing: ' + fmt(v.openTime) + ' to ' + fmt(v.closeTime) + '.', c.name, 'The new timing does not fit.');
    if (ask) return ask;
    await db.upd('Venues', old.id, v);
    if (v.photo && v.photo !== old.photo) removeUpload(old.photo);
    if (old.name !== v.name || old.location !== v.location) await db.updWhere('Bookings', { venueId: old.id }, { venueName: v.name, venueLocation: v.location });
    await log('Updated venue: ' + v.name, c.name);
    return { saved: true };
  } },

  deleteVenue: { admin: 1, fn: async (d, c) => {
    const v = await db.one('Venues', { id: d.id }); if (!v) fail('This venue was not found.');
    const aff = await liveFuture(b => b.venueId === v.id);
    const ask = await confirmOrClear(aff, d, 'VENUE_REMOVED', '', c.name, 'You are removing "' + v.name + '".');
    if (ask) return ask;
    await db.del('Venues', { id: v.id }); await db.del('Closures', { venueId: v.id }); removeUpload(v.photo);
    await log('Removed venue: ' + v.name, c.name);
    return { deleted: true };
  } },

  saveClosure: { admin: 1, fn: async (d, c) => {
    const v = await db.one('Venues', { id: d.venueId }); if (!v) fail('This venue was not found.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date || '')) fail('Select a date.');
    const full = !!d.fullDay, rg = full ? [] : (d.ranges || []).filter(r => r.start && r.end && mins(r.start) < mins(r.end));
    if (!full && !rg.length) fail('Add at least one time range, or choose the full day.');
    const aff = await liveFuture(b => b.venueId === v.id && b.date === d.date && (full || rg.some(r => overlap(b.start, b.end, r.start, r.end))));
    const ask = await confirmOrClear(aff, d, 'VENUE_CLOSED', 'Closed on ' + d.date + '.', c.name, 'The venue will be closed.');
    if (ask) return ask;
    await db.del('Closures', { venueId: v.id, date: d.date });
    await db.add('Closures', { id: newId(), venueId: v.id, date: d.date, fullDay: full, ranges: rg });
    await log('Closed "' + v.name + '" on ' + d.date, c.name);
    return { saved: true };
  } },

  removeClosure: { admin: 1, fn: async (d, c) => {
    await db.del('Closures', { venueId: d.venueId, date: d.date });
    await log('Removed closure on ' + d.date, c.name); return true;
  } },

   
  setUserStatus: { admin: 1, fn: async (d, c) => {
    const u = await db.one('Users', { id: d.id }); if (!u) fail('This committee was not found.');
    if (!['approved', 'blocked', 'rejected'].includes(d.status)) fail('Something went wrong. Please try again.');
    if (d.status === 'blocked') {
      await clear(await liveFuture(b => b.userId === u.id), 'ACCOUNT_BLOCKED', c.name, { force: true });
      await db.del('Sessions', { userId: u.id });
    }
    await db.upd('Users', u.id, { status: d.status });
    await note(u.id, d.status === 'approved' ? 'The admin approved your account.' : d.status === 'blocked' ? 'The admin blocked your account. Please contact the admin.' : 'The admin rejected your account request.');
    await log('Committee "' + u.committee + '" set to ' + d.status, c.name);
    return true;
  } },

  decideAdmin: { admin: 1, fn: async (d, c) => {
    if (!c.rec.isSuper) fail('Only the main admin can do this.');
    const a = await db.one('Admins', { id: d.id }); if (!a || a.status !== 'pending') fail('This request has already been handled.');
    if (d.approve) await db.upd('Admins', a.id, { status: 'approved' }); else await db.del('Admins', { id: a.id });
    await db.updWhere('Notifications', { reqAdminId: a.id }, { resolved: true });
    await log((d.approve ? 'Approved' : 'Rejected') + ' admin: ' + a.name, c.name);
    return true;
  } },

  createUser: { admin: 1, fn: async (d, c) => {
    const name = hasText(d.committee, 'the committee name', 80), pw = newPw(d.password);
    if (!(await settings()).committeeTypes.includes(d.type)) fail('Select a valid committee type.');
    if ((await db.rows('Users')).some(u => u.committee.toLowerCase() === name.toLowerCase())) fail('This committee name is already registered.');
    await db.add('Users', { id: newId(), committee: name, type: d.type, incharge: hasText(d.incharge, 'the in-charge name', 80), phone: phoneOk(d.phone), salt: pw.salt, hash: pw.hash, status: 'approved', createdAt: iso() });
    await log('Created committee account: ' + name, c.name);
    return true;
  } },

  forgotPassword: { pub: 1, fn: async d => {
    const name = hasText(d.committee, 'the committee name', 80), inc = hasText(d.incharge, 'the in-charge name', 80), ph = phoneOk(d.phone);
    const u = (await db.rows('Users')).find(x => x.committee.toLowerCase() === name.toLowerCase() && x.incharge.toLowerCase() === inc.toLowerCase() && String(x.phone) === ph);
    if (!u) fail('The details you entered do not match any account.', 'NO_MATCH');
    const sup = (await db.rows('Admins')).find(a => a.isSuper);
    const open = (await db.rows('Notifications', { refId: u.id })).some(n => n.type === 'password_reset' && !n.resolved);
    if (sup && !open) await note(sup.id, 'Password reset request. Committee: ' + u.committee + ' | In-charge: ' + u.incharge + ' | Contact: ' + u.phone + '.', { type: 'password_reset', refId: u.id, resolved: false });
    return true;
  } },

  resetUserPassword: { admin: 1, fn: async (d, c) => {
    const u = await db.one('Users', { id: d.id }); if (!u) fail('This committee was not found.');
    const pw = newPw(d.password);
    await db.upd('Users', u.id, { salt: pw.salt, hash: pw.hash });
    await db.del('Sessions', { userId: u.id });
    await db.updWhere('Notifications', { type: 'password_reset', refId: u.id }, { resolved: true });
    await note(u.id, 'Your password was changed by the admin.');
    await log('Password reset for "' + u.committee + '"', c.name);
    return true;
  } },

  ignoreNotification: { admin: 1, fn: async (d, c) => {
    const n = await db.one('Notifications', { id: d.id }); if (!n || n.userId !== c.id) fail('This notification was not found.');
    await db.upd('Notifications', n.id, { resolved: true }); return true;
  } },

   
  sendChat: { fn: async (d, c) => {
    const text = String(d.text || '').trim().slice(0, 1000); if (!text) fail('Enter a message.');
    const ok = c.role === 'user' ? (await db.rows('Admins', { id: d.toId })).some(a => a.status === 'approved') : !!(await db.one('Users', { id: d.toId }));
    if (!ok) fail('This person cannot be reached right now.');
    await db.add('Chats', { id: newId(), fromId: c.id, toId: d.toId, text, timestamp: iso(), read: false, deleted: false });
    return true;
  } },
  markChatRead: { fn: async (d, c) => { await db.updWhere('Chats', { fromId: d.withId, toId: c.id }, { read: true }); return true; } },
  deleteChat: { fn: async (d, c) => {
    const m = await db.one('Chats', { id: d.id });
    if (!m || m.fromId !== c.id) fail('You can delete only your own messages.');
    await db.upd('Chats', m.id, { text: '', deleted: true, deletedAt: iso() }); return true;
  } },
  markNotificationsRead: { fn: async (d, c) => { await db.updWhere('Notifications', { userId: c.id }, { read: true }); return true; } },

  saveProfile: { fn: async (d, c) => {
    const p = {};
    if (c.role === 'user') { p.incharge = hasText(d.incharge, 'the in-charge name', 80); p.phone = phoneOk(d.phone); }
    else { p.name = hasText(d.name, 'your name', 80); if (d.phone) p.phone = phoneOk(d.phone); }
    if (d.password) { const pw = newPw(d.password); p.salt = pw.salt; p.hash = pw.hash; }
    await db.upd(c.role === 'admin' ? 'Admins' : 'Users', c.id, p); return true;
  } },

   
  requestDeleteAccount: { fn: async (d, c) => {
    if (!checkPw(String(d.password || ''), c.rec)) fail('Incorrect password.');
    await deleteGuard(c);
    const code = String(crypto.randomInt(100000, 1000000)), id = c.role + ':' + c.id;
    await db.del('Verifications', { id });
    await db.add('Verifications', { id, userId: c.id, role: c.role, purpose: 'delete', code, expires: Date.now() + 300000, tries: 0 });
    return { code, seconds: 300, affected: c.role === 'user' ? (await liveFuture(b => b.userId === c.id)).length : 0 };
  } },

  deleteAccount: { fn: async (d, c) => {
    const id = c.role + ':' + c.id, v = await db.one('Verifications', { id });
    if (!v || Number(v.expires) < Date.now()) { if (v) await db.del('Verifications', { id }); fail('The confirmation has expired. Please start again.', 'EXPIRED'); }
    if (String(d.code || '').trim() !== v.code) {
      if (Number(v.tries) + 1 >= 5) { await db.del('Verifications', { id }); fail('Too many wrong codes. Please start again.', 'EXPIRED'); }
      await db.upd('Verifications', id, { tries: Number(v.tries) + 1 }); fail('The confirmation code is incorrect.');
    }
    if (String(d.phrase || '').trim() !== 'DELETE') fail('Type DELETE exactly as shown.');
    await deleteGuard(c);
    const name = c.name;
    if (c.role === 'user') {
      const aff = await liveFuture(b => b.userId === c.id);
      await clear(aff, 'ACCOUNT_DELETED', name, { force: true, silent: true });
      await archive(c, aff.length);
      for (const a of await otherAdmins('')) await note(a.id, 'Committee "' + name + '" deleted its account.' + (aff.length ? ' ' + aff.length + ' upcoming booking(s) were cancelled automatically (reason: account deleted).' : ' It had no upcoming bookings.'), { type: 'account_deleted' });
      await db.del('Users', { id: c.id });
    } else {
      await archive(c, 0);
      const rest = await otherAdmins(c.id);
      if (c.rec.isSuper) {
        const next = rest[0];
        await db.upd('Admins', next.id, { isSuper: true });
        for (const n of await db.rows('Notifications', { userId: c.id })) if (!n.resolved && ['admin_request', 'password_reset'].includes(n.type)) await db.upd('Notifications', n.id, { userId: next.id });
        await note(next.id, 'The previous main admin deleted their account. You are now the main admin.', { type: 'account_deleted' });
      }
      for (const a of rest) await note(a.id, 'Admin "' + name + '" deleted their account. Their past bookings are kept in the records.', { type: 'account_deleted' });
      await db.del('Admins', { id: c.id });
    }
    await db.del('Sessions', { userId: c.id });
    await db.del('Notifications', { userId: c.id });
    await db.del('Verifications', { id });
    await log((c.role === 'admin' ? 'Admin' : 'Committee') + ' account deleted by the owner: ' + name, name);
    return true;
  } },

  saveSettings: { admin: 1, fn: async (d, c) => {
    if (Array.isArray(d.categories)) await db.setSetting('categories', JSON.stringify(cleanList(d.categories, 'event categories')));
    if (Array.isArray(d.committeeTypes)) await db.setSetting('committeeTypes', JSON.stringify(cleanList(d.committeeTypes, 'committee types')));
    await log('Updated settings', c.name); return true;
  } },

  uploadImage: { admin: 1, fn: async d => {
    const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[d.mime];
    if (!ext) fail('Select a PNG, JPG or WEBP image.');
    if (!d.data || d.data.length > 3500000) fail('This image is too big. Select an image under 2.5 MB.');
    const name = crypto.randomBytes(8).toString('hex') + '.' + ext;
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    const file = path.join(UPLOAD_DIR, name);
    await fs.promises.writeFile(file, Buffer.from(String(d.data), 'base64'));
    if (!fs.existsSync(file)) fail('The image could not be saved on the server. Please try again.');
    return { url: '/uploads/' + name };
  } },

   
  exportBackup: { admin: 1, fn: async (d, c) => {
    if (!c.rec.isSuper) fail('Only the main admin can download the full backup.');
    const tables = {}, counts = {}, files = {};
    for (const t of BACKUP_TABLES) { tables[t] = await db.rows(t); counts[t] = tables[t].length; }
    for (const v of tables.Venues) {
      if (!PHOTO_URL.test(v.photo || '')) continue;
      try { files[path.basename(v.photo)] = (await fs.promises.readFile(path.join(UPLOAD_DIR, path.basename(v.photo)))).toString('base64'); } catch (e) {   }
    }
    await log('Downloaded full JSON backup', c.name);
    return { meta: { app: 'CampusHub-Backup', schemaVersion: SCHEMA_VERSION, exportedAt: iso(), exportedBy: c.name, counts }, tables, files };
  } },

  restoreBackup: { admin: 1, fn: async (d, c) => {
    if (!c.rec.isSuper) fail('Only the main admin can restore a backup.');
    if (d.phrase !== 'RESTORE') fail('Type RESTORE to confirm.');
    if (!checkPw(String(d.password || ''), c.rec)) fail('Incorrect password.');
    const bk = d.backup;
    if (!bk || !bk.meta || bk.meta.app !== 'CampusHub-Backup' || !bk.tables || typeof bk.tables !== 'object') fail('This is not a CampusHub backup file.');
    const data = {};
    for (const t of BACKUP_TABLES) {
      const list = bk.tables[t] === undefined ? [] : bk.tables[t];
      if (!Array.isArray(list) || list.some(r => !r || typeof r !== 'object' || Array.isArray(r))) fail('The backup file is damaged (table ' + t + ').');
      data[t] = list;
    }
    if (!data.Admins.some(a => a.status === 'approved' && a.isSuper)) fail('The backup has no main admin account, so it cannot be restored.');
    data.Venues.forEach(v => { if (v.photo && !PHOTO_URL.test(String(v.photo))) v.photo = ''; });
    await db.transaction(async () => {
      await db.clearAll();
      for (const t of BACKUP_TABLES) await db.bulkInsert(t, data[t]);
    });
    await db.seedDefaults(false);
    await convertOldIds();  
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    for (const f of fs.readdirSync(UPLOAD_DIR)) if (f !== '.gitkeep') fs.unlinkSync(path.join(UPLOAD_DIR, f));
    for (const [name, b64] of Object.entries(bk.files || {})) {
      if (!/^[a-f0-9]{16}\.(png|jpg|webp)$/.test(name) || typeof b64 !== 'string' || b64.length > 7000000) continue;
      await fs.promises.writeFile(path.join(UPLOAD_DIR, name), Buffer.from(b64, 'base64'));
    }
    console.log(iso(), 'Backup restored by', c.name);
    return true;
  } },

   
  factoryReset: { admin: 1, fn: async (d, c) => {
    if (!c.rec.isSuper) fail('Only the main admin can reset the system.');
    if (d.phrase !== 'RESET') fail('Type RESET to confirm.');
    if (!checkPw(String(d.password || ''), c.rec)) fail('Incorrect password.');
    await db.clearAll();
    await db.seedDefaults(true);
    if (fs.existsSync(UPLOAD_DIR)) for (const f of fs.readdirSync(UPLOAD_DIR)) if (f !== '.gitkeep') fs.unlinkSync(path.join(UPLOAD_DIR, f));
    console.log(iso(), 'Factory reset done by', c.name);
    return true;
  } }
};

module.exports = { A, auth, UPLOAD_DIR, backfill };
