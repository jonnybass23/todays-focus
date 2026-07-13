/**
 * Today's Focus — multi-user, multi-board Express server.
 *
 * Auth: bcrypt + JWT cookie. Data isolated per user in SQLite (see db.js).
 * Each user has one or more boards; every board has its own columns + focus.
 * Built to sit behind a reverse proxy (Unraid) with HTTPS terminated there.
 */
'use strict';

const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const webpush = require('web-push');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createStore } = require('./db');

// ============================================================
// CONFIGURATION
// ============================================================
const PORT          = process.env.PORT || 3000;
const DATA_DIR      = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE       = process.env.DB_FILE || path.join(DATA_DIR, 'focus.db');
const PUBLIC_DIR    = path.join(__dirname, 'public');

const THEMES        = ['light', 'cardboard', 'dark'];
const DEFAULT_THEME = 'dark';
const DEFAULT_LABELS = { thought: 'Thoughts', project: 'Projects', goal: 'Goals' };
const DEFAULT_FOCUS_COLUMNS = [
  { key: 'thought', label: 'Thoughts', accent: '#60a5fa', hint: 'Capture a fleeting idea…' },
  { key: 'project', label: 'Projects', accent: '#f472b6', hint: 'Something you are building…' },
  { key: 'goal',    label: 'Goals',    accent: '#34d399', hint: 'An outcome to reach…' },
];
const DEFAULT_NEW_COLUMNS = [
  { key: 'todo',  label: 'To do', accent: '#60a5fa', hint: '' },
  { key: 'doing', label: 'Doing', accent: '#f472b6', hint: '' },
  { key: 'done',  label: 'Done',  accent: '#34d399', hint: '' },
];
// Boards pre-built for every user (alongside their pinned "Today's Focus" board).
const SEED_BOARDS = [
  { name: 'Quotes', icon: '💬', focusLabel: 'Quote of the Day', spotlight: true, streak: false,
    columns: [{ key: 'quotes', label: 'Quotes', accent: '#a78bfa', hint: 'Add a quote…' }] },
  { name: 'Affirmations', icon: '🌟', focusLabel: 'Affirmation of the Day', spotlight: true, streak: false,
    columns: [{ key: 'affirmations', label: 'Affirmations', accent: '#34d399', hint: 'Add an affirmation…' }] },
  { name: 'Books', icon: '📚', focusLabel: 'Currently Reading', spotlight: false, streak: false,
    columns: [
      { key: 'want', label: 'Want to Read', accent: '#60a5fa', hint: 'A book to read…' },
      { key: 'reading', label: 'Reading', accent: '#fbbf24', hint: '' },
      { key: 'finished', label: 'Finished', accent: '#34d399', hint: '' },
    ] },
  { name: 'Games', icon: '🎮', focusLabel: 'Now Playing', spotlight: false, streak: false,
    columns: [
      { key: 'backlog', label: 'Backlog', accent: '#60a5fa', hint: 'A game to play…' },
      { key: 'playing', label: 'Playing', accent: '#fbbf24', hint: '' },
      { key: 'beaten', label: 'Beaten', accent: '#34d399', hint: '' },
      { key: 'shelved', label: 'Shelved', accent: '#a1a1aa', hint: '' },
    ] },
  { name: 'Routines', icon: '✅', focusLabel: 'Up Next', spotlight: false, streak: false,
    columns: [
      { key: 'morning', label: 'Morning', accent: '#fbbf24', hint: 'A morning routine…' },
      { key: 'afternoon', label: 'Afternoon', accent: '#60a5fa', hint: '' },
      { key: 'evening', label: 'Evening', accent: '#a78bfa', hint: '' },
    ] },
];
const MAX_TITLE_LEN = 280;
const MAX_LABEL_LEN = 24;
const MAX_BOARD_NAME = 40;
const MAX_COLUMNS   = 8;
const MAX_SUBTASKS  = 50;
const MAX_SUBTASK_LEN = 200;
const MAX_TAGS      = 20;
const MAX_TAG_LEN   = 30;
const MAX_NOTE_LEN  = 10000;
const MAX_DURATION  = 100000; // minutes
const RECUR_VALUES  = ['', 'daily', 'weekday', 'weekly', 'biweekly', 'monthly', 'yearly'];
const RECOVERY_CODE_COUNT = 10;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@todays-focus.local';
const MAX_CARDS_PER_USER  = parseInt(process.env.MAX_CARDS_PER_USER  || '500', 10);
const MAX_BOARDS_PER_USER = parseInt(process.env.MAX_BOARDS_PER_USER || '20',  10);

// --- auth / security ---
const JWT_TTL_DAYS  = 30;
const COOKIE_NAME   = 'tf_session';
const BCRYPT_ROUNDS = 10;
const MIN_USERNAME_LEN = 3, MAX_USERNAME_LEN = 32;
const MIN_PASSWORD_LEN = 8;
const TRUST_PROXY   = parseTrustProxy(process.env.TRUST_PROXY, 1);
const FORCE_SECURE_COOKIE = process.env.FORCE_SECURE_COOKIE === 'true';
const RL_WINDOW_MS    = 15 * 60 * 1000;
const RL_MAX          = 12;
const RL_LOCKOUT_MS   = 10 * 60 * 1000; // IP lockout after hitting RL_MAX
const RL_REG_MAX      = 3;               // max registrations per IP per hour
const RL_REG_WINDOW   = 60 * 60 * 1000;
const ACCT_FAIL_MAX   = 5;              // consecutive login failures before per-account lockout
const ACCT_LOCK_MS    = 10 * 60 * 1000;
const BODY_LIMIT      = '64kb';
const HSTS_MAX_AGE  = 15552000;

// --- registration bootstrap ---
const INVITE_CODE       = process.env.INVITE_CODE || '';
const OPEN_REGISTRATION = process.env.OPEN_REGISTRATION === 'true';
const ADMIN_USERNAME    = process.env.ADMIN_USERNAME || '';
const ADMIN_PASSWORD    = process.env.ADMIN_PASSWORD || '';
// ============================================================

const store = createStore(DB_FILE, { theme: DEFAULT_THEME, labels: DEFAULT_LABELS, focusColumns: DEFAULT_FOCUS_COLUMNS, seedBoards: SEED_BOARDS });
const JWT_SECRET = loadJwtSecret();
const VAPID = loadVapidKeys();
if (VAPID) { try { webpush.setVapidDetails(VAPID_SUBJECT, VAPID.publicKey, VAPID.privateKey); } catch (e) { console.warn('  ▸ Push disabled — bad VAPID keys:', e.message); } }
const COOKIE_MAX_AGE = JWT_TTL_DAYS * 24 * 60 * 60 * 1000;
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', BCRYPT_ROUNDS);

const app = express();
app.set('trust proxy', TRUST_PROXY);
app.use(express.json({ limit: BODY_LIMIT }));
app.use(cookieParser());
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  if (req.secure) res.setHeader('Strict-Transport-Security', `max-age=${HSTS_MAX_AGE}`);
  next();
});
app.use(authenticate);

// ============================================================
// AUTH HELPERS
// ============================================================
function loadJwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const p = path.join(DATA_DIR, '.jwtsecret');
  try { return fs.readFileSync(p, 'utf8').trim(); }
  catch { const secret = crypto.randomBytes(48).toString('hex'); fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(p, secret, { mode: 0o600 }); return secret; }
}
// VAPID keypair for web-push. Set via env, or auto-generated once and saved to data/.vapid.json.
function loadVapidKeys() {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  const p = path.join(DATA_DIR, '.vapid.json');
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch {
    try {
      const keys = webpush.generateVAPIDKeys();
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(p, JSON.stringify(keys), { mode: 0o600 });
      return keys;
    } catch (e) { console.warn('  ▸ Could not generate VAPID keys:', e.message); return null; }
  }
}
function parseTrustProxy(val, fallback) {
  if (val == null || val === '') return fallback;
  if (val === 'true') return true;
  if (val === 'false') return false;
  const n = Number(val);
  return Number.isFinite(n) ? n : val;
}
function signToken(user) { return jwt.sign({ sub: user.id, v: user.token_version }, JWT_SECRET, { expiresIn: `${JWT_TTL_DAYS}d` }); }
function setSessionCookie(req, res, user) {
  res.cookie(COOKIE_NAME, signToken(user), { httpOnly: true, sameSite: 'lax', secure: FORCE_SECURE_COOKIE || req.secure, maxAge: COOKIE_MAX_AGE, path: '/' });
}
function clearSessionCookie(res) { res.clearCookie(COOKIE_NAME, { path: '/' }); }

function authenticate(req, res, next) {
  req.user = null; req.viaToken = false;
  const auth = req.headers.authorization || '';
  const headerToken = (auth.startsWith('Bearer ') ? auth.slice(7).trim() : '') || req.headers['x-api-key'];
  if (headerToken) { const u = store.getUserByToken(String(headerToken)); if (u) { req.user = u; req.viaToken = true; return next(); } }
  const cookie = req.cookies[COOKIE_NAME];
  if (cookie) {
    try { const payload = jwt.verify(cookie, JWT_SECRET); const u = store.getUserById(payload.sub); if (u && u.token_version === payload.v) req.user = u; }
    catch (_) {}
  }
  next();
}
const requireAuth   = (req, res, next) => req.user ? next() : res.status(401).json({ error: 'Authentication required.' });
const requireCookie = (req, res, next) => !req.user ? res.status(401).json({ error: 'Authentication required.' })
  : req.viaToken ? res.status(403).json({ error: 'This action requires a browser session, not an API token.' }) : next();
const requireAdmin  = (req, res, next) => !req.user ? res.status(401).json({ error: 'Authentication required.' })
  : (req.viaToken || req.user.role !== 'admin') ? res.status(403).json({ error: 'Admin only.' }) : next();

const attempts    = new Map(); // IP → { count, resetAt, lockedUntil? }
const regAttempts = new Map(); // IP → { count, resetAt }
const acctLock    = new Map(); // username.lower → { fails, lockedUntil }

function rateLimit(req, res, next) {
  const now = Date.now();
  let rec = attempts.get(req.ip);
  if (!rec || (now > rec.resetAt && now > (rec.lockedUntil || 0))) { rec = { count: 0, resetAt: now + RL_WINDOW_MS }; attempts.set(req.ip, rec); }
  if (rec.lockedUntil && now < rec.lockedUntil) return res.status(429).json({ error: 'Too many attempts. Please wait before trying again.' });
  if (++rec.count > RL_MAX) { rec.lockedUntil = now + RL_LOCKOUT_MS; return res.status(429).json({ error: 'Too many attempts. Please wait a few minutes and try again.' }); }
  next();
}
function regLimit(req, res, next) {
  const now = Date.now();
  let rec = regAttempts.get(req.ip);
  if (!rec || now > rec.resetAt) { rec = { count: 0, resetAt: now + RL_REG_WINDOW }; regAttempts.set(req.ip, rec); }
  if (++rec.count > RL_REG_MAX) return res.status(429).json({ error: 'Too many registration attempts from this IP. Please try again later.' });
  next();
}

const validUsername = (u) => typeof u === 'string' && new RegExp(`^[a-zA-Z0-9_.-]{${MIN_USERNAME_LEN},${MAX_USERNAME_LEN}}$`).test(u);
const validPassword = (p) => typeof p === 'string' && p.length >= MIN_PASSWORD_LEN && p.length <= 200;
const validHttpUrl = (u) => { if (typeof u !== 'string' || !u) return false; try { const x = new URL(u); return x.protocol === 'http:' || x.protocol === 'https:'; } catch { return false; } };
const today = (tz) => new Date().toLocaleDateString('en-CA', tz ? { timeZone: tz } : undefined);
const validTz = (tz) => { if (typeof tz !== 'string' || !tz) return false; try { new Intl.DateTimeFormat('en-CA', { timeZone: tz }); return true; } catch { return false; } };
function computeStreaks(days, todayStr) {
  const set = new Set(days), DAY = 86400000;
  const toMs = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  const fromMs = (ms) => new Date(ms).toISOString().slice(0, 10);
  let current = 0, cursor = toMs(todayStr);
  if (!set.has(todayStr)) cursor -= DAY;
  while (set.has(fromMs(cursor))) { current++; cursor -= DAY; }
  let longest = 0, run = 0, prev = null;
  for (const d of [...set].sort()) { run = (prev !== null && toMs(d) - prev === DAY) ? run + 1 : 1; if (run > longest) longest = run; prev = toMs(d); }
  return { current, longest, total: set.size };
}
function sanitizeColumns(cols) {
  if (!Array.isArray(cols)) return null;
  const out = [], seen = new Set();
  for (const c of cols.slice(0, MAX_COLUMNS)) {
    if (!c || typeof c.label !== 'string' || !c.label.trim()) continue;
    let key = (typeof c.key === 'string' && c.key.trim()) ? c.key.trim() : c.label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
    key = (key || 'col').slice(0, 40);
    while (seen.has(key)) key += '_';
    seen.add(key);
    out.push({ key, label: c.label.trim().slice(0, MAX_LABEL_LEN), accent: /^#[0-9a-fA-F]{6}$/.test(c.accent) ? c.accent : '#60a5fa', hint: typeof c.hint === 'string' ? c.hint.slice(0, 80) : '' });
  }
  return out.length ? out : null;
}
function sanitizeSubtasks(list) {
  if (!Array.isArray(list)) return null;
  const out = [];
  for (const s of list.slice(0, MAX_SUBTASKS)) {
    if (!s || typeof s.text !== 'string') continue;
    const text = s.text.trim().slice(0, MAX_SUBTASK_LEN);
    if (!text) continue;
    const id = (typeof s.id === 'string' && s.id.trim()) ? s.id.trim().slice(0, 64) : crypto.randomUUID();
    out.push({ id, text, done: !!s.done });
  }
  return out; // may be empty (user cleared all subtasks)
}
// A due/reminder timestamp: a valid ISO string, or null/'' to clear it.
function normDateField(v) {
  if (v === null || v === '' || v === undefined) return null;
  if (typeof v !== 'string') return undefined; // invalid → ignore
  const t = Date.parse(v);
  return Number.isNaN(t) ? undefined : new Date(t).toISOString();
}
function sanitizeTags(list) {
  if (!Array.isArray(list)) return null;
  const out = [], seen = new Set();
  for (const raw of list) {
    if (typeof raw !== 'string') continue;
    const tag = raw.trim().replace(/^#+/, '').replace(/\s+/g, '-').toLowerCase().slice(0, MAX_TAG_LEN);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag); out.push(tag);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}
const normRecur = (v) => (typeof v === 'string' && RECUR_VALUES.includes(v)) ? v : '';
// Advance an ISO date by one recurrence step — used to spawn the next occurrence on completion.
function advanceRecur(iso, rule) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  if (rule === 'daily') d.setDate(d.getDate() + 1);
  else if (rule === 'weekly') d.setDate(d.getDate() + 7);
  else if (rule === 'biweekly') d.setDate(d.getDate() + 14);
  else if (rule === 'monthly') d.setMonth(d.getMonth() + 1);
  else if (rule === 'yearly') d.setFullYear(d.getFullYear() + 1);
  else if (rule === 'weekday') { do { d.setDate(d.getDate() + 1); } while (d.getDay() === 0 || d.getDay() === 6); }
  else return null;
  return d.toISOString();
}
function safeEqual(a, b) { const ba = Buffer.from(String(a)), bb = Buffer.from(String(b)); return ba.length === bb.length && crypto.timingSafeEqual(ba, bb); }
function makeRecoveryCodes(n = RECOVERY_CODE_COUNT) {
  const codes = [];
  for (let i = 0; i < n; i++) {
    const raw = crypto.randomBytes(6).toString('hex'); // 48 bits of entropy per code
    codes.push(`${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`);
  }
  return codes;
}
const registrationState = () => ({
  needsBootstrap: store.countUsers() === 0,
  openRegistration: store.getAppSetting('open_registration') === 'true',
  inviteCodeSet: !!(store.getAppSetting('invite_code') || ''),
});

// ============================================================
// AUTH ROUTES
// ============================================================
app.get('/api/health', (req, res) => res.json({ ok: true, users: store.countUsers() }));
app.get('/api/auth/config', (req, res) => res.json(registrationState()));

app.post('/api/auth/register', rateLimit, regLimit, async (req, res) => {
  // Honeypot: real browsers leave this blank; bots that fill forms fill it and get a silent fake-success
  if (req.body?.hp) return res.status(201).json({ user: { id: '', username: '', role: 'user' } });
  const { username, password, code } = req.body || {};
  if (!validUsername(username)) return res.status(400).json({ error: `Username must be ${MIN_USERNAME_LEN}–${MAX_USERNAME_LEN} characters (letters, numbers, . _ -).` });
  if (!validPassword(password)) return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LEN} characters.` });
  if (store.getUserByUsername(username)) return res.status(409).json({ error: 'That username is already taken.' });
  const state = registrationState();
  let role = 'user';
  if (state.needsBootstrap) role = 'admin';
  else if (state.openRegistration) { /* allowed */ }
  else if (state.inviteCodeSet && safeEqual(code || '', store.getAppSetting('invite_code'))) { /* allowed */ }
  else return res.status(403).json({ error: state.inviteCodeSet ? 'A valid invite code is required to register.' : 'Registration is closed — ask the owner to create your account.' });
  const user = store.createUser({ username, passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS), role });
  const recoveryCodes = makeRecoveryCodes();
  store.setRecoveryCodes(user.id, recoveryCodes);
  setSessionCookie(req, res, user);
  res.status(201).json({ user: store.publicUser(user), recoveryCodes });
});

app.post('/api/auth/login', rateLimit, async (req, res) => {
  const { username, password } = req.body || {};
  const lockKey = String(username || '').toLowerCase();
  const now = Date.now();
  const lock = acctLock.get(lockKey);
  if (lock && now < lock.lockedUntil) return res.status(429).json({ error: 'Too many failed attempts for this account. Please wait a few minutes before trying again.' });
  const user = store.getUserByUsername(String(username || ''));
  const ok = await bcrypt.compare(String(password || ''), user ? user.password_hash : DUMMY_HASH);
  if (!user || !ok) {
    const entry = acctLock.get(lockKey) || { fails: 0, lockedUntil: 0 };
    entry.fails++;
    if (entry.fails >= ACCT_FAIL_MAX) { entry.lockedUntil = now + ACCT_LOCK_MS; entry.fails = 0; }
    acctLock.set(lockKey, entry);
    return res.status(401).json({ error: 'Invalid username or password.' });
  }
  acctLock.delete(lockKey);
  setSessionCookie(req, res, user);
  res.json({ user: store.publicUser(user) });
});

app.post('/api/auth/logout', (req, res) => { clearSessionCookie(res); res.json({ ok: true }); });
app.get('/api/auth/me', requireAuth, (req, res) => res.json({ user: store.publicUser(req.user), apiToken: req.viaToken ? null : req.user.api_token }));

app.post('/api/auth/password', requireCookie, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!validPassword(newPassword)) return res.status(400).json({ error: `New password must be at least ${MIN_PASSWORD_LEN} characters.` });
  if (!(await bcrypt.compare(String(currentPassword || ''), req.user.password_hash))) return res.status(403).json({ error: 'Your current password is incorrect.' });
  store.setPassword(req.user.id, await bcrypt.hash(newPassword, BCRYPT_ROUNDS));
  setSessionCookie(req, res, store.getUserById(req.user.id));
  res.json({ ok: true });
});
app.post('/api/auth/token', requireCookie, (req, res) => res.json({ apiToken: store.regenerateToken(req.user.id) }));
app.post('/api/auth/username', requireCookie, (req, res) => {
  const { username } = req.body || {};
  if (!validUsername(username)) return res.status(400).json({ error: `Username must be ${MIN_USERNAME_LEN}–${MAX_USERNAME_LEN} characters (letters, numbers, . _ -).` });
  const existing = store.getUserByUsername(username);
  if (existing && existing.id !== req.user.id) return res.status(409).json({ error: 'That username is already taken.' });
  store.changeUsername(req.user.id, username.trim());
  res.json({ user: store.publicUser(store.getUserById(req.user.id)) });
});

// --- recovery codes (single-use backup codes; the only way back in without email) ---
app.get('/api/auth/recovery', requireCookie, (req, res) => res.json({ remaining: store.countRecoveryCodes(req.user.id) }));
app.post('/api/auth/recovery/regenerate', requireCookie, (req, res) => {
  const recoveryCodes = makeRecoveryCodes();
  store.setRecoveryCodes(req.user.id, recoveryCodes);
  res.json({ recoveryCodes });
});
app.post('/api/auth/recover', rateLimit, async (req, res) => {
  const { username, code, newPassword } = req.body || {};
  if (!validPassword(newPassword)) return res.status(400).json({ error: `New password must be at least ${MIN_PASSWORD_LEN} characters.` });
  const user = store.getUserByUsername(String(username || ''));
  // Same generic failure for unknown user OR bad code, so this can't be used to enumerate accounts.
  const ok = user ? store.consumeRecoveryCode(user.id, code) : false;
  if (!ok) return res.status(400).json({ error: 'That username and recovery code don’t match. Each code works only once.' });
  store.setPassword(user.id, await bcrypt.hash(newPassword, BCRYPT_ROUNDS)); // also bumps token_version → logs out other sessions
  const fresh = store.getUserById(user.id);
  setSessionCookie(req, res, fresh);
  res.json({ user: store.publicUser(fresh), remaining: store.countRecoveryCodes(user.id) });
});

// ============================================================
// ADMIN ROUTES
// ============================================================
app.get('/api/admin/users', requireAdmin, (req, res) => res.json({ users: store.listUsers().map((u) => ({ id: u.id, username: u.username, role: u.role, createdAt: u.created_at })) }));
app.post('/api/admin/users', requireAdmin, async (req, res) => {
  const { username, password, role } = req.body || {};
  if (!validUsername(username)) return res.status(400).json({ error: `Username must be ${MIN_USERNAME_LEN}–${MAX_USERNAME_LEN} characters (letters, numbers, . _ -).` });
  if (!validPassword(password)) return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LEN} characters.` });
  if (store.getUserByUsername(username)) return res.status(409).json({ error: 'That username is already taken.' });
  const u = store.createUser({ username, passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS), role: role === 'admin' ? 'admin' : 'user' });
  const recoveryCodes = makeRecoveryCodes();
  store.setRecoveryCodes(u.id, recoveryCodes);
  res.status(201).json({ user: { id: u.id, username: u.username, role: u.role, createdAt: u.created_at }, recoveryCodes });
});
app.delete('/api/admin/users/:id', requireAdmin, (req, res) => {
  const target = store.getUserById(req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found.' });
  if (target.id === req.user.id) return res.status(400).json({ error: 'You cannot delete your own account from here.' });
  if (target.role === 'admin' && store.countAdmins() <= 1) return res.status(400).json({ error: 'Cannot delete the last admin.' });
  store.deleteUser(target.id);
  res.json({ ok: true });
});
app.post('/api/admin/users/:id/password', requireAdmin, async (req, res) => {
  const target = store.getUserById(req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found.' });
  const { newPassword } = req.body || {};
  if (!validPassword(newPassword)) return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LEN} characters.` });
  store.setPassword(target.id, await bcrypt.hash(newPassword, BCRYPT_ROUNDS));
  res.json({ ok: true });
});
app.get('/api/admin/backup', requireAdmin, (req, res) => {
  store.checkpoint();
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="todays-focus-${today()}.db"`);
  fs.createReadStream(DB_FILE).on('error', () => res.status(500).end()).pipe(res);
});

function adminSettingsPayload() {
  return {
    openRegistration: store.getAppSetting('open_registration') === 'true',
    inviteCode: store.getAppSetting('invite_code') || '',
    donateEnabled: store.getAppSetting('donate_enabled') === 'true',
    donateLabel: store.getAppSetting('donate_label') || '',
    donateUrl: store.getAppSetting('donate_url') || '',
    shopEnabled: store.getAppSetting('shop_enabled') === 'true',
    shopLabel: store.getAppSetting('shop_label') || '',
    shopUrl: store.getAppSetting('shop_url') || '',
  };
}
app.get('/api/admin/settings', requireAdmin, (req, res) => res.json(adminSettingsPayload()));
app.patch('/api/admin/settings', requireAdmin, (req, res) => {
  const { openRegistration, inviteCode, donateEnabled, donateLabel, donateUrl, shopEnabled, shopLabel, shopUrl } = req.body || {};
  if (typeof openRegistration === 'boolean') store.setAppSetting('open_registration', openRegistration ? 'true' : 'false');
  if (typeof inviteCode === 'string') store.setAppSetting('invite_code', inviteCode.trim());
  if (typeof donateEnabled === 'boolean') store.setAppSetting('donate_enabled', donateEnabled ? 'true' : 'false');
  if (typeof donateLabel === 'string') store.setAppSetting('donate_label', donateLabel.trim().slice(0, 60));
  if (typeof donateUrl === 'string') { const u = donateUrl.trim(); if (u && !validHttpUrl(u)) return res.status(400).json({ error: 'Donation link must be a valid http(s) URL.' }); store.setAppSetting('donate_url', u); }
  if (typeof shopEnabled === 'boolean') store.setAppSetting('shop_enabled', shopEnabled ? 'true' : 'false');
  if (typeof shopLabel === 'string') store.setAppSetting('shop_label', shopLabel.trim().slice(0, 60));
  if (typeof shopUrl === 'string') { const u = shopUrl.trim(); if (u && !validHttpUrl(u)) return res.status(400).json({ error: 'Shop link must be a valid http(s) URL.' }); store.setAppSetting('shop_url', u); }
  res.json(adminSettingsPayload());
});
app.get('/api/donate', (req, res) => { const url = store.getAppSetting('donate_url') || ''; res.json({ enabled: store.getAppSetting('donate_enabled') === 'true' && !!url, label: store.getAppSetting('donate_label') || 'Donate', url }); });
app.get('/api/shop', (req, res) => { const url = store.getAppSetting('shop_url') || ''; res.json({ enabled: store.getAppSetting('shop_enabled') === 'true' && !!url, label: store.getAppSetting('shop_label') || 'Get the 3D-printed version', url }); });

// ============================================================
// BOARDS
// ============================================================
app.get('/api/boards', requireAuth, (req, res) => res.json({ boards: store.getBoards(req.user.id) }));
app.post('/api/boards', requireAuth, (req, res) => {
  if (store.countBoards(req.user.id) >= MAX_BOARDS_PER_USER)
    return res.status(400).json({ error: `Board limit reached (${MAX_BOARDS_PER_USER} per account). Delete a board to create another.` });
  const { name, icon, focusLabel, columns, streak, spotlight } = req.body || {};
  if (typeof name !== 'string' || !name.trim()) return res.status(400).json({ error: 'A board name is required.' });
  const board = store.createBoard(req.user.id, {
    name: name.trim().slice(0, MAX_BOARD_NAME),
    icon: typeof icon === 'string' && icon.trim() ? icon.trim().slice(0, 8) : '🗂️',
    focusLabel: typeof focusLabel === 'string' && focusLabel.trim() ? focusLabel.trim().slice(0, MAX_BOARD_NAME) : 'Focus',
    columns: sanitizeColumns(columns) || DEFAULT_NEW_COLUMNS,
    streak: streak === true,
    spotlight: spotlight === true,
  });
  res.status(201).json({ board, boards: store.getBoards(req.user.id) });
});
app.post('/api/boards/:id/touch', requireAuth, (req, res) => {
  if (!store.getBoard(req.user.id, req.params.id)) return res.status(404).json({ error: 'Board not found.' });
  store.touchBoard(req.user.id, req.params.id);
  res.json({ boards: store.getBoards(req.user.id) });
});
app.put('/api/boards/order', requireAuth, (req, res) => {
  const { ids } = req.body || {};
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'An array of board "ids" is required.' });
  store.reorderBoards(req.user.id, ids.map(String));
  res.json({ boards: store.getBoards(req.user.id) });
});
app.patch('/api/boards/:id', requireAuth, (req, res) => {
  const { name, icon, focusLabel, columns, streak, spotlight } = req.body || {};
  const fields = {};
  if (typeof name === 'string' && name.trim()) fields.name = name.trim().slice(0, MAX_BOARD_NAME);
  if (typeof icon === 'string') fields.icon = icon.trim().slice(0, 8);
  if (typeof focusLabel === 'string' && focusLabel.trim()) fields.focusLabel = focusLabel.trim().slice(0, MAX_BOARD_NAME);
  if (columns !== undefined) { const c = sanitizeColumns(columns); if (!c) return res.status(400).json({ error: 'A board needs at least one named column.' }); fields.columns = c; }
  if (typeof streak === 'boolean') fields.streak = streak;
  if (typeof spotlight === 'boolean') fields.spotlight = spotlight;
  const board = store.updateBoard(req.user.id, req.params.id, fields);
  if (!board) return res.status(404).json({ error: 'Board not found.' });
  res.json({ board, boards: store.getBoards(req.user.id) });
});
app.delete('/api/boards/:id', requireAuth, (req, res) => {
  if (!store.getBoard(req.user.id, req.params.id)) return res.status(404).json({ error: 'Board not found.' });
  if (store.countBoards(req.user.id) <= 1) return res.status(400).json({ error: 'You need at least one board.' });
  store.deleteBoard(req.user.id, req.params.id);
  res.json({ boards: store.getBoards(req.user.id) });
});
app.get('/api/boards/:bid/cards', requireAuth, (req, res) => {
  const board = store.getBoard(req.user.id, req.params.bid);
  if (!board) return res.status(404).json({ error: 'Board not found.' });
  res.json({ cards: store.getCards(board.id) });
});

// ============================================================
// CARDS (board-scoped; create accepts session cookie OR API token)
// ============================================================
app.post('/api/cards', requireAuth, (req, res) => {
  if (store.countUserCards(req.user.id) >= MAX_CARDS_PER_USER)
    return res.status(400).json({ error: `Card limit reached (${MAX_CARDS_PER_USER} per account). Remove some cards to continue.` });
  const { title, type, boardId } = req.body || {};
  if (typeof title !== 'string' || !title.trim()) return res.status(400).json({ error: 'Field "title" is required and must be a non-empty string.' });
  const boards = store.getBoards(req.user.id);
  const board = (boardId && boards.find((b) => b.id === boardId)) || boards[0];
  if (!board) return res.status(400).json({ error: 'No board available to add to.' });
  const keys = board.columns.map((c) => c.key);
  let card = store.createCard(req.user.id, board.id, { title: title.trim().slice(0, MAX_TITLE_LEN), type: keys.includes(type) ? type : keys[0] });
  // Optional scheduling fields accepted at creation (quick-add sends these).
  const extra = {};
  const due = normDateField(req.body?.dueAt); if (due !== undefined) extra.dueAt = due;
  const rem = normDateField(req.body?.remindAt); if (rem !== undefined) extra.remindAt = rem;
  const tags = sanitizeTags(req.body?.tags); if (tags) extra.tags = tags;
  if (req.body?.recur !== undefined) extra.recur = normRecur(req.body.recur);
  if (typeof req.body?.priority === 'number' && [0, 1, 2, 3].includes(req.body.priority)) extra.priority = req.body.priority;
  if (typeof req.body?.note === 'string') extra.note = req.body.note.slice(0, MAX_NOTE_LEN);
  const startCreate = normDateField(req.body?.startAt); if (startCreate !== undefined) extra.startAt = startCreate;
  if (typeof req.body?.duration === 'number' && req.body.duration >= 0) extra.duration = Math.min(Math.floor(req.body.duration), MAX_DURATION);
  if (Object.keys(extra).length) card = store.updateCard(req.user.id, card.id, extra);
  res.status(201).json({ card, cards: store.getCards(board.id) });
});
app.patch('/api/cards/:id', requireAuth, (req, res) => {
  const row = store.getCardRow(req.user.id, req.params.id);
  if (!row) return res.status(404).json({ error: 'Card not found.' });
  const { title, type, focused, subtasks, priority, dueAt, remindAt, tags, recur, note, startAt, duration } = req.body || {};
  const fields = {};
  if (typeof title === 'string' && title.trim()) fields.title = title.trim().slice(0, MAX_TITLE_LEN);
  if (typeof type === 'string' && type.trim()) fields.type = type.trim().slice(0, 40);
  if (typeof focused === 'boolean') fields.focused = focused;
  if (subtasks !== undefined) { const s = sanitizeSubtasks(subtasks); if (s) fields.subtasks = s; }
  if (typeof priority === 'number' && [0, 1, 2, 3].includes(priority)) fields.priority = priority;
  if ('dueAt' in (req.body || {})) { const d = normDateField(dueAt); if (d !== undefined) fields.dueAt = d; }
  if ('remindAt' in (req.body || {})) { const r = normDateField(remindAt); if (r !== undefined) fields.remindAt = r; }
  if ('tags' in (req.body || {})) { const t = sanitizeTags(tags); if (t) fields.tags = t; }
  if ('recur' in (req.body || {})) fields.recur = normRecur(recur);
  if (typeof note === 'string') fields.note = note.slice(0, MAX_NOTE_LEN);
  if ('startAt' in (req.body || {})) { const s = normDateField(startAt); if (s !== undefined) fields.startAt = s; }
  if (typeof duration === 'number' && duration >= 0) fields.duration = Math.min(Math.floor(duration), MAX_DURATION);
  const card = store.updateCard(req.user.id, req.params.id, fields);
  if (fields.focused === true) {
    const board = store.getBoard(req.user.id, row.board_id);
    if (board && board.streak) store.logFocus(req.user.id, card.title, card.id, today(req.user.timezone));
  }
  res.json({ card, cards: store.getCards(row.board_id) });
});
app.delete('/api/cards/:id', requireAuth, (req, res) => {
  const row = store.getCardRow(req.user.id, req.params.id);
  if (!row) return res.status(404).json({ error: 'Card not found.' });
  store.deleteCard(req.user.id, req.params.id);
  res.json({ cards: store.getCards(row.board_id) });
});
app.post('/api/cards/:id/archive', requireAuth, (req, res) => {
  const row = store.getCardRow(req.user.id, req.params.id);
  if (!row) return res.status(404).json({ error: 'Card not found.' });
  // Recurring task → spawn the next occurrence before completing this one.
  if (row.recur && RECUR_VALUES.includes(row.recur) && row.recur !== '') {
    const nextDue = advanceRecur(row.due_at || new Date().toISOString(), row.recur);
    if (nextDue) {
      const parseArr = (s) => { try { const v = JSON.parse(s); return Array.isArray(v) ? v : []; } catch { return []; } };
      const next = store.createCard(req.user.id, row.board_id, { title: row.title, type: row.type });
      const patch = { dueAt: nextDue, tags: parseArr(row.tags), recur: row.recur, priority: row.priority || 0 };
      const subs = parseArr(row.subtasks).map((s) => ({ ...s, done: false }));
      if (subs.length) patch.subtasks = subs;
      if (row.remind_at) { const nr = advanceRecur(row.remind_at, row.recur); if (nr) patch.remindAt = nr; }
      store.updateCard(req.user.id, next.id, patch);
    }
  }
  store.archiveCard(req.user.id, req.params.id);
  res.json({ cards: store.getCards(row.board_id) });
});
app.post('/api/cards/:id/restore', requireAuth, (req, res) => {
  const card = store.restoreCard(req.user.id, req.params.id);
  if (!card) return res.status(404).json({ error: 'Card not found.' });
  res.json({ cards: store.getCards(card.boardId), archived: store.getArchived(req.user.id) });
});
app.post('/api/cards/:id/move', requireAuth, (req, res) => {
  const row = store.getCardRow(req.user.id, req.params.id);
  if (!row) return res.status(404).json({ error: 'Card not found.' });
  const { boardId, type } = req.body || {};
  const target = store.getBoard(req.user.id, boardId);
  if (!target) return res.status(400).json({ error: 'Target board not found.' });
  const keys = target.columns.map((c) => c.key);
  const destType = keys.includes(type) ? type : keys[0];
  if (!destType) return res.status(400).json({ error: 'The target board has no columns to drop into.' });
  store.moveCardToBoard(req.user.id, req.params.id, target.id, destType);
  res.json({ cards: store.getCards(row.board_id), movedTo: target.id });
});
app.put('/api/cards/order', requireAuth, (req, res) => {
  const { boardId, type, ids } = req.body || {};
  const board = store.getBoard(req.user.id, boardId);
  if (!board || !Array.isArray(ids)) return res.status(400).json({ error: 'A valid "boardId", "type" and array of "ids" are required.' });
  store.reorderCards(req.user.id, board.id, String(type), ids.slice(0, 2000).map(String));
  res.json({ cards: store.getCards(board.id) });
});
app.get('/api/archive', requireAuth, (req, res) => res.json({ archived: store.getArchived(req.user.id) }));

// All active cards across every board — powers the Today / Upcoming / All views and tag filters.
app.get('/api/active', requireAuth, (req, res) => res.json({ cards: store.getActiveCards(req.user.id) }));

// ============================================================
// JOURNAL (one free-text entry per day)
// ============================================================
const MAX_JOURNAL_LEN = 100000;
const validDay = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
app.get('/api/journal/days', requireAuth, (req, res) => res.json({ days: store.getJournalDays(req.user.id).map((e) => ({ day: e.day, mood: e.mood, snippet: ((e.content || '').split('\n').map((l) => l.trim()).filter(Boolean)[0] || '').slice(0, 90) })) }));
app.get('/api/journal', requireAuth, (req, res) => {
  const day = req.query.day;
  if (!validDay(day)) return res.status(400).json({ error: 'A valid "day" (YYYY-MM-DD) is required.' });
  const e = store.getJournalEntry(req.user.id, day);
  res.json({ day, content: e.content, mood: e.mood });
});
app.put('/api/journal', requireAuth, (req, res) => {
  const { day, content, mood } = req.body || {};
  if (!validDay(day)) return res.status(400).json({ error: 'A valid "day" (YYYY-MM-DD) is required.' });
  const text = typeof content === 'string' ? content.slice(0, MAX_JOURNAL_LEN) : '';
  const m = (typeof mood === 'string' && mood.length <= 8) ? mood : '';
  store.saveJournalEntry(req.user.id, day, text, m);
  res.json({ ok: true, day });
});

// ============================================================
// SAVED FILTERS (smart lists)
// ============================================================
const DUE_RANGES = ['any', 'today', 'week', 'overdue'];
function sanitizeFilter(f) {
  if (!f || typeof f !== 'object') return null;
  return {
    id: (typeof f.id === 'string' && f.id.trim()) ? f.id.trim().slice(0, 64) : crypto.randomUUID(),
    name: (typeof f.name === 'string' && f.name.trim()) ? f.name.trim().slice(0, 40) : 'Filter',
    tags: sanitizeTags(f.tags) || [],
    priority: [0, 1, 2, 3].includes(f.priority) ? f.priority : 0,
    due: DUE_RANGES.includes(f.due) ? f.due : 'any',
    boards: Array.isArray(f.boards) ? f.boards.filter((b) => typeof b === 'string').slice(0, 30) : [],
  };
}
// ============================================================
// HABITS
// ============================================================
const MAX_HABITS = 60;
app.get('/api/habits', requireAuth, (req, res) => {
  const since = new Date(Date.now() - 400 * 86400000).toISOString().slice(0, 10); // ~13 months of history
  res.json({ habits: store.getHabits(req.user.id), checkins: store.getCheckins(req.user.id, since) });
});
app.post('/api/habits', requireAuth, (req, res) => {
  if (store.getHabits(req.user.id).length >= MAX_HABITS) return res.status(400).json({ error: `Habit limit reached (${MAX_HABITS}).` });
  const { name, icon, color } = req.body || {};
  if (typeof name !== 'string' || !name.trim()) return res.status(400).json({ error: 'A habit name is required.' });
  const habit = store.createHabit(req.user.id, { name: name.trim().slice(0, 60), icon: typeof icon === 'string' && icon.trim() ? icon.trim().slice(0, 8) : '✅', color: /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#34d399' });
  res.status(201).json({ habit: { id: habit.id, name: habit.name, icon: habit.icon, color: habit.color } });
});
app.patch('/api/habits/:id', requireAuth, (req, res) => {
  const { name, icon, color } = req.body || {};
  const fields = {};
  if (typeof name === 'string' && name.trim()) fields.name = name.trim().slice(0, 60);
  if (typeof icon === 'string' && icon.trim()) fields.icon = icon.trim().slice(0, 8);
  if (typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color)) fields.color = color;
  const habit = store.updateHabit(req.user.id, req.params.id, fields);
  if (!habit) return res.status(404).json({ error: 'Habit not found.' });
  res.json({ habit: { id: habit.id, name: habit.name, icon: habit.icon, color: habit.color } });
});
app.delete('/api/habits/:id', requireAuth, (req, res) => {
  if (!store.deleteHabit(req.user.id, req.params.id)) return res.status(404).json({ error: 'Habit not found.' });
  res.json({ ok: true });
});
app.post('/api/habits/:id/toggle', requireAuth, (req, res) => {
  const day = req.body?.day;
  if (!validDay(day)) return res.status(400).json({ error: 'A valid "day" (YYYY-MM-DD) is required.' });
  const state = store.toggleCheckin(req.user.id, req.params.id, day);
  if (state === null) return res.status(404).json({ error: 'Habit not found.' });
  res.json({ checked: state });
});

app.get('/api/filters', requireAuth, (req, res) => res.json({ filters: store.getFilters(req.user.id) }));
app.put('/api/filters', requireAuth, (req, res) => {
  const arr = Array.isArray(req.body?.filters) ? req.body.filters.slice(0, 50).map(sanitizeFilter).filter(Boolean) : [];
  store.setFilters(req.user.id, arr);
  res.json({ filters: arr });
});

// ============================================================
// WEB PUSH (reminders)
// ============================================================
app.get('/api/push/config', (req, res) => res.json({ enabled: !!VAPID, publicKey: VAPID ? VAPID.publicKey : '' }));
app.post('/api/push/subscribe', requireCookie, (req, res) => {
  if (!VAPID) return res.status(503).json({ error: 'Push notifications are not configured on this server.' });
  const sub = req.body?.subscription || req.body;
  if (!sub || typeof sub.endpoint !== 'string' || !sub.keys) return res.status(400).json({ error: 'A valid push subscription is required.' });
  store.saveSubscription(req.user.id, sub);
  res.status(201).json({ ok: true });
});
app.post('/api/push/unsubscribe', requireCookie, (req, res) => {
  if (req.body?.endpoint) store.deleteSubscription(String(req.body.endpoint));
  res.json({ ok: true });
});
app.post('/api/push/test', requireCookie, async (req, res) => {
  if (!VAPID) return res.status(503).json({ error: 'Push notifications are not configured.' });
  const subs = store.getSubscriptions(req.user.id);
  if (!subs.length) return res.status(400).json({ error: 'No device is subscribed on this account yet — enable reminders first.' });
  await Promise.all(subs.map((s) => sendPush(s, { title: "Today's Focus", body: 'Reminders are working ✓', url: '/' })));
  res.json({ ok: true, sent: subs.length });
});

// ============================================================
// SETTINGS · HISTORY · EXPORT
// ============================================================
app.get('/api/settings', requireAuth, (req, res) => res.json({ settings: { theme: req.user.theme, timezone: req.user.timezone || '' } }));
app.put('/api/settings', requireAuth, (req, res) => {
  const { theme, timezone } = req.body || {};
  if (typeof theme === 'string' && THEMES.includes(theme)) store.setTheme(req.user.id, theme);
  if (typeof timezone === 'string' && (timezone === '' || validTz(timezone))) store.setTimezone(req.user.id, timezone);
  const u = store.getUserById(req.user.id);
  res.json({ settings: { theme: u.theme, timezone: u.timezone || '' } });
});
app.get('/api/history', requireAuth, (req, res) => {
  res.json({ history: store.getHistory(req.user.id, 120), ...computeStreaks(store.getHistoryDays(req.user.id), today(req.user.timezone)) });
});
app.get('/api/export', requireAuth, (req, res) => {
  const boards = store.getBoards(req.user.id).map((b) => ({ ...b, cards: store.getCards(b.id) }));
  res.setHeader('Content-Disposition', `attachment; filename="my-focus-${today()}.json"`);
  res.json({ exportedAt: new Date().toISOString(), username: req.user.username, settings: { theme: req.user.theme, timezone: req.user.timezone || '' }, boards, history: store.getHistory(req.user.id, 100000) });
});

// ============================================================
// STATIC SPA
// ============================================================
// House bridge routes (definitions live in the HOUSE BRIDGE section below;
// registered here so they sit above the API catch-all).
app.get('/api/house/tasks', requireAuth, async (req, res) => {
  if (!isHouseUser(req.user)) return res.status(404).json({ error: 'Not enabled for this account.' });
  try { res.json({ tasks: await getHouseTasks('fresh' in req.query), baseUrl: HOUSEPLAN_PUBLIC_URL }); }
  catch (e) { res.status(502).json({ error: 'House Plan unreachable — ' + e.message }); }
});
app.post('/api/house/tasks', requireAuth, async (req, res) => {
  if (!isHouseUser(req.user)) return res.status(404).json({ error: 'Not enabled for this account.' });
  try { const out = await houseFetch('/api/tasks', { method: 'POST', body: JSON.stringify(req.body || {}) }); houseCache.t = 0; res.status(201).json(out); }
  catch (e) { res.status(502).json({ error: 'House Plan unreachable — ' + e.message }); }
});
app.post('/api/house/tasks/:id/toggle', requireAuth, async (req, res) => {
  if (!isHouseUser(req.user)) return res.status(404).json({ error: 'Not enabled for this account.' });
  try { const out = await houseFetch(`/api/tasks/${encodeURIComponent(req.params.id)}/toggle`, { method: 'POST' }); houseCache.t = 0; res.json(out); }
  catch (e) { res.status(502).json({ error: 'House Plan unreachable — ' + e.message }); }
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Unknown API endpoint.' }));
app.use(express.static(PUBLIC_DIR));
app.get('/privacy', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'privacy.html')));
app.get('*', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

// ============================================================
// PUSH DELIVERY + REMINDER SCHEDULER
// ============================================================
async function sendPush(sub, payload) {
  if (!VAPID) return;
  try { await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, JSON.stringify(payload)); }
  catch (err) { if (err && (err.statusCode === 404 || err.statusCode === 410)) store.deleteSubscription(sub.endpoint); }
}
const REMINDER_SWEEP_MS = 30 * 1000;
let sweeping = false;
async function runReminderSweep() {
  if (!VAPID || sweeping) return;
  sweeping = true;
  try {
    const due = store.getDueReminders(new Date().toISOString());
    for (const card of due) {
      const subs = store.getSubscriptions(card.userId);
      if (subs.length) {
        const payload = { title: '⏰ ' + card.title, body: card.dueAt ? 'Due ' + new Date(card.dueAt).toLocaleString('en-GB', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' }) : 'Reminder', url: '/', tag: 'card-' + card.id };
        await Promise.all(subs.map((s) => sendPush(s, payload)));
      }
      store.markReminded(card.id); // mark regardless, so we don't re-check a card with no live devices forever
    }
  } catch (err) { console.warn('  ▸ Reminder sweep error:', err.message); }
  finally { sweeping = false; }
}
if (VAPID) setInterval(runReminderSweep, REMINDER_SWEEP_MS).unref();

// ============================================================
// HOUSE BRIDGE — mirrors House Plan jobs (houseplan.fatharr.space)
// into a personal "🏠 House" view for one designated user.
// House Plan stays the source of truth; nothing is stored here.
// ============================================================
const HOUSEPLAN_URL        = (process.env.HOUSEPLAN_URL || '').replace(/\/+$/, '');
const HOUSEPLAN_PUBLIC_URL = (process.env.HOUSEPLAN_PUBLIC_URL || HOUSEPLAN_URL).replace(/\/+$/, '');
const HOUSEPLAN_KEY        = process.env.HOUSEPLAN_BRIDGE_KEY || '';
const HOUSE_USER           = (process.env.HOUSE_BOARD_USER || '').toLowerCase();
const houseConfigured = () => !!(HOUSEPLAN_URL && HOUSEPLAN_KEY && HOUSE_USER);
const isHouseUser = (u) => houseConfigured() && u && String(u.username).toLowerCase() === HOUSE_USER;

let houseCache = { t: 0, tasks: null };
async function houseFetch(path, options = {}) {
  const res = await fetch(HOUSEPLAN_URL + path, {
    ...options,
    headers: { 'x-bridge-key': HOUSEPLAN_KEY, 'Content-Type': 'application/json', ...(options.headers || {}) },
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) throw new Error(`House Plan replied ${res.status}`);
  return res.json();
}
async function getHouseTasks(fresh = false) {
  if (!fresh && houseCache.tasks && Date.now() - houseCache.t < 30000) return houseCache.tasks;
  const { tasks } = await houseFetch('/api/tasks');
  houseCache = { t: Date.now(), tasks };
  return tasks;
}

// Push when a repeating house job comes due (checked every 15 min).
const HOUSE_SWEEP_MS = 15 * 60 * 1000;
let houseSweeping = false;
async function runHouseSweep() {
  if (!VAPID || !houseConfigured() || houseSweeping) return;
  houseSweeping = true;
  try {
    const user = store.getUserByUsername(HOUSE_USER);
    if (!user) return;
    const subs = store.getSubscriptions(user.id);
    if (!subs.length) return;
    const tasks = await getHouseTasks(true);
    const due = tasks.filter((t) => t.state === 'open' && t.dueAt && new Date(t.dueAt) <= new Date());
    let seen = {};
    try { seen = JSON.parse(store.getAppSetting('house_notified') || '{}'); } catch (_) {}
    const fresh = due.filter((t) => seen[t.id] !== t.dueAt);
    if (fresh.length) {
      for (const t of fresh) seen[t.id] = t.dueAt;
      const live = new Set(tasks.map((t) => t.id));
      for (const k of Object.keys(seen)) if (!live.has(k)) delete seen[k];
      store.setAppSetting('house_notified', JSON.stringify(seen));
      const body = fresh.length === 1
        ? `${fresh[0].emoji} ${fresh[0].text}`.slice(0, 160)
        : `${fresh.length} house jobs are due: ${fresh.map((t) => t.text).join(' · ')}`.slice(0, 160);
      const payload = { title: '🏠 House job due', body, url: HOUSEPLAN_PUBLIC_URL || '/', tag: 'house-due' };
      await Promise.all(subs.map((s) => sendPush(s, payload)));
    }
  } catch (err) { console.warn('  ▸ House sweep error:', err.message); }
  finally { houseSweeping = false; }
}
if (VAPID) setInterval(runHouseSweep, HOUSE_SWEEP_MS).unref();
if (houseConfigured()) {
  setTimeout(() => {
    getHouseTasks().then((t) => console.log(`  ▸ House bridge            →  connected — ${t.length} open job(s) for @${HOUSE_USER}`))
      .catch((e) => console.warn(`  ▸ House bridge            →  UNREACHABLE (${e.message})`));
    runHouseSweep();
  }, 3000);
}

// ============================================================
// BOOT
// ============================================================
function seedAppSettings() {
  const seed = (k, v) => { if (store.getAppSetting(k) == null) store.setAppSetting(k, v); };
  seed('open_registration', OPEN_REGISTRATION ? 'true' : 'false');
  seed('invite_code', INVITE_CODE);
  seed('donate_enabled', 'false'); seed('donate_label', 'Support this server'); seed('donate_url', '');
  seed('shop_enabled', 'false'); seed('shop_label', 'Get the 3D-printed version'); seed('shop_url', '');
}
async function seedAdmin() {
  if (store.countUsers() > 0 || !ADMIN_USERNAME || !ADMIN_PASSWORD) return;
  store.createUser({ username: ADMIN_USERNAME, passwordHash: await bcrypt.hash(ADMIN_PASSWORD, BCRYPT_ROUNDS), role: 'admin' });
  console.log(`  ▸ Seeded admin account "${ADMIN_USERNAME}" from env`);
}

// Prune stale rate-limit entries hourly so the maps don't grow without bound on a long-lived server
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of attempts)    if (now > Math.max(v.resetAt, v.lockedUntil || 0)) attempts.delete(k);
  for (const [k, v] of regAttempts) if (now > v.resetAt) regAttempts.delete(k);
  for (const [k, v] of acctLock)    if (!v.fails && now > (v.lockedUntil || 0)) acctLock.delete(k);
}, 60 * 60 * 1000).unref();

seedAppSettings();
seedAdmin().then(() => {
  app.listen(PORT, () => {
    const s = registrationState();
    const mode = s.openRegistration ? 'OPEN' : s.inviteCodeSet ? 'invite-code' : 'admin-only';
    console.log(`\n  ▸ Today's Focus running   →  http://localhost:${PORT}`);
    console.log(`  ▸ Database                →  ${DB_FILE}`);
    console.log(`  ▸ Users / registration    →  ${store.countUsers()} user(s), registration: ${mode}`);
    console.log(`  ▸ Push reminders          →  ${VAPID ? 'enabled' : 'disabled (no VAPID keys)'}`);
    console.log(s.needsBootstrap ? '  ▸ No users yet — the first account you create becomes the admin.\n' : '');
  });
});
