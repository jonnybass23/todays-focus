/* ============================================================
   Today's Focus — vanilla JS front-end (multi-user, multi-board).

   Each board keeps the signature Focus Zone + columns; only the context
   changes per board (its name, focus label, and columns). Today's Focus is
   the default board. Auth-gated; all data is scoped server-side to the cookie.
   ============================================================ */

// ============================================================
// CONFIGURATION
// ============================================================
const API_BASE = '/api';

const THEMES = [
  { id: 'light',     label: 'Light' },
  { id: 'cardboard', label: 'Cardboard' },
  { id: 'dark',      label: 'Dark'  },
];

const DONATE_PRESETS = [
  { label: 'Custom…', url: '' },
  { label: 'Support this server', url: '' },
  { label: 'Doctors Without Borders', url: 'https://donate.doctorswithoutborders.org/' },
  { label: 'UNICEF', url: 'https://www.unicef.org/donate' },
  { label: 'American Red Cross', url: 'https://www.redcross.org/donate/donation.html' },
  { label: 'Wikipedia (Wikimedia)', url: 'https://donate.wikimedia.org/' },
  { label: 'Electronic Frontier Foundation', url: 'https://www.eff.org/donate' },
  { label: 'World Wildlife Fund', url: 'https://www.worldwildlife.org/donate' },
  { label: 'GiveDirectly', url: 'https://www.givedirectly.org/donate/' },
];

const BOARD_ICONS = ['🎯', '📚', '🎮', '💬', '🌟', '✅', '🗒️', '💡', '🏆', '🎬', '🎵', '🧠', '🏋️', '🍳', '✈️', '🗂️'];
const COLUMN_ACCENTS = ['#60a5fa', '#f472b6', '#34d399', '#fbbf24', '#a78bfa', '#22d3ee', '#fb7185', '#a3e635'];

const MAX_TITLE_LEN = 280;
const MAX_LABEL_LEN = 24;
const POLL_MS       = 5000;
const TOAST_MS      = 2800;
// ============================================================

const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const state = { cards: [] };
let settings = { theme: 'dark', timezone: '' };
let currentUser = null;
let boards = [];
let currentBoard = null;
let authConfig = { needsBootstrap: false, openRegistration: false, inviteCodeSet: false };
let authMode = 'login';
let pollTimer = null;
let historyData = null;
let shopConfig = null;
const ui = { composer: null, draggingId: null, editingLabel: null, subtaskAdding: null, editingCard: null, editingSubtask: null };
let refs = { columns: {} };
let seenCards = new Set(); // cards already animated in — keeps re-renders from re-popping every card
let expandedCards = new Set(); // cards whose subtask checklist is currently expanded (collapsed by default)

const boardCols = () => (currentBoard && currentBoard.columns) || [];
const colByKey = (key) => boardCols().find((c) => c.key === key);
const isSpotlight = () => !!(currentBoard && currentBoard.spotlight);
const userTodayStr = () => { const tz = currentUser && currentUser.timezone; return new Date().toLocaleDateString('en-CA', tz ? { timeZone: tz } : undefined); };
const dayIndex = (ymd) => { const [y, m, d] = ymd.split('-').map(Number); return Math.floor(Date.UTC(y, m - 1, d) / 86400000); };
function spotlightPick(cards) {
  // deterministic, stable per day (in the user's timezone) and stable across reorders
  const pool = cards.slice().sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : (a.id < b.id ? -1 : 1)));
  if (!pool.length) return null;
  const len = pool.length;
  return pool[((dayIndex(userTodayStr()) % len) + len) % len];
}

// ------------------------------------------------------------
// DOM helper + icons
// ------------------------------------------------------------
function el(tag, className = '', text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}
const ICONS = {
  light: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/></svg>`,
  cardboard: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5"><path d="M21 8l-9-5-9 5v8l9 5 9-5V8z"/><path d="M3 8l9 5 9-5"/><path d="M12 13v8"/></svg>`,
  dark:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5"><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/></svg>`,
};
const TRASH_SVG  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V6M10 11v6M14 11v6"/></svg>`;
const PENCIL_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3 w-3"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>`;
const HEART_SVG  = `<svg viewBox="0 0 24 24" fill="currentColor" class="h-3.5 w-3.5"><path d="M12 21s-6.7-4.35-9.33-8.5C1 9.5 2.2 6 5.5 6 7.4 6 8.8 7.1 12 9.5 15.2 7.1 16.6 6 18.5 6c3.3 0 4.5 3.5 2.83 6.5C18.7 16.65 12 21 12 21z"/></svg>`;
const FLAME_SVG  = `<svg viewBox="0 0 24 24" fill="currentColor" class="h-3.5 w-3.5"><path d="M12 2s4.5 4.2 4.5 8.3a4.5 4.5 0 0 1-9 0c0-1 .3-1.9.8-2.7C7 8.7 6 10.8 6 13a6 6 0 0 0 12 0c0-5.2-6-11-6-11z"/></svg>`;
const DOWN_SVG   = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>`;
const CHEV_SVG   = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5"><path d="M6 9l6 6 6-6"/></svg>`;
const MOVE_SVG   = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5"><path d="M14 5l7 7-7 7"/><path d="M21 12H3"/></svg>`;
const PLUS_SVG   = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3 w-3"><path d="M12 5v14M5 12h14"/></svg>`;
const MINUS_SVG  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3 w-3"><path d="M5 12h14"/></svg>`;
const DOTS_SVG   = `<svg viewBox="0 0 24 24" fill="currentColor" class="h-3.5 w-3.5"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>`;

// ------------------------------------------------------------
// API layer
// ------------------------------------------------------------
async function request(path, options = {}) {
  const res = await fetch(API_BASE + path, { headers: { 'Content-Type': 'application/json' }, ...options });
  if (res.status === 204) return {};
  const body = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(body.error || `Request failed (${res.status})`); e.status = res.status; throw e; }
  return body;
}
function handleApiError(err) { if (err && err.status === 401) { forceReauth(); return true; } toast(err.message); return false; }

// ------------------------------------------------------------
// Auth
// ------------------------------------------------------------
async function bootstrap() {
  try { const { user } = await request('/auth/me'); currentUser = user; await enterApp(); }
  catch (_) {
    try { authConfig = await request('/auth/config'); } catch (e) {}
    setAuthMode(authConfig.needsBootstrap ? 'register' : 'login');
    showScreen('auth');
  }
}
function showScreen(which) {
  $('#auth-screen').classList.toggle('hidden', which !== 'auth');
  $('#app').classList.toggle('hidden', which !== 'app');
  $('#app').classList.toggle('flex', which === 'app');
}
async function enterApp() {
  settings = { theme: currentUser.theme || 'dark', timezone: currentUser.timezone || '' };
  applyTheme(settings.theme);
  showScreen('app');
  renderUserMenu();
  renderThemeToggle();
  renderDonate();
  loadShop();
  renderStreak();
  setDate();
  try { await loadBoards(); } catch (err) { handleApiError(err); return; }
  buildBoard();
  renderBoardSwitcher();
  loadCards();
  if (currentBoard) touchBoard(currentBoard.id);
  startPolling();
}
function setAuthMode(mode) {
  authMode = mode;
  const reg = mode === 'register';
  const recover = mode === 'recover';
  const canRegister = authConfig.needsBootstrap || authConfig.openRegistration || authConfig.inviteCodeSet;
  $('#auth-subtitle').textContent = recover ? 'Use a recovery code to set a new password.'
    : reg ? (authConfig.needsBootstrap ? 'Create the first account — it becomes the admin.' : 'Create your board.')
    : 'Sign in to your board.';
  $('#auth-submit').textContent = recover ? 'Reset password' : reg ? (authConfig.needsBootstrap ? 'Create admin account' : 'Create account') : 'Sign in';
  $('#auth-password').setAttribute('autocomplete', (reg || recover) ? 'new-password' : 'current-password');
  $('#auth-password').setAttribute('placeholder', recover ? 'New password' : 'Password');
  $('#auth-recovery-wrap').classList.toggle('hidden', !recover);
  $('#auth-code-wrap').classList.toggle('hidden', !(reg && authConfig.inviteCodeSet && !authConfig.openRegistration && !authConfig.needsBootstrap));
  $('#auth-toggle').textContent = recover ? 'Back to sign in' : reg ? 'Have an account? Sign in' : 'Need an account? Register';
  $('#auth-toggle').classList.toggle('hidden', !recover && !reg && !canRegister);
  $('#auth-forgot').classList.toggle('hidden', recover || reg);
  hideAuthError();
}
function hideAuthError() { $('#auth-error').classList.add('hidden'); }
function showAuthError(msg) { const e = $('#auth-error'); e.textContent = msg; e.classList.remove('hidden'); }
async function submitAuth(e) {
  e.preventDefault();
  const username = $('#auth-username').value.trim();
  const password = $('#auth-password').value;
  const code = $('#auth-code').value.trim();
  if (authMode === 'recover') {
    const recoveryCode = $('#auth-recovery-code').value.trim();
    if (!username || !recoveryCode || !password) return showAuthError('Enter your username, a recovery code, and a new password.');
    try {
      const { user } = await request('/auth/recover', { method: 'POST', body: JSON.stringify({ username, code: recoveryCode, newPassword: password }) });
      currentUser = user; $('#auth-form').reset(); await enterApp(); toast('Password reset — you’re signed in');
    } catch (err) { showAuthError(err.message); }
    return;
  }
  if (!username || !password) return showAuthError('Enter a username and password.');
  const reg = authMode === 'register';
  try {
    const resp = await request(reg ? '/auth/register' : '/auth/login', { method: 'POST', body: JSON.stringify(reg ? { username, password, code, hp: ($('#hp-field').value || '') } : { username, password }) });
    currentUser = resp.user; $('#auth-form').reset(); await enterApp();
    if (reg && resp.recoveryCodes) showRecoveryCodes(resp.recoveryCodes, true);
  } catch (err) { showAuthError(err.message); }
}
async function logout() { try { await request('/auth/logout', { method: 'POST' }); } catch (_) {} forceReauth(); }
function forceReauth() {
  stopPolling(); currentUser = null; state.cards = []; boards = []; currentBoard = null;
  ['#account-modal', '#admin-modal', '#history-modal', '#archive-modal', '#boards-modal', '#help-modal'].forEach(closeModal);
  request('/auth/config').then((c) => { authConfig = c; }).catch(() => {}).finally(() => setAuthMode('login'));
  showScreen('auth');
}

// ------------------------------------------------------------
// Boards
// ------------------------------------------------------------
async function loadBoards() {
  const { boards: bs } = await request('/boards');
  boards = bs;
  let saved = null; try { saved = localStorage.getItem('tf-board'); } catch (_) {}
  currentBoard = boards.find((b) => b.id === saved) || boards[0] || null;
  if (currentBoard) { try { localStorage.setItem('tf-board', currentBoard.id); } catch (_) {} }
}
function selectBoard(id) {
  const b = boards.find((x) => x.id === id);
  if (!b || (currentBoard && b.id === currentBoard.id)) return;
  currentBoard = b;
  try { localStorage.setItem('tf-board', id); } catch (_) {}
  ui.composer = null; ui.editingLabel = null; ui.editingCard = null; ui.editingSubtask = null; ui.subtaskAdding = null;
  buildBoard(); renderBoardSwitcher(); loadCards(); touchBoard(id);
}
// Mark a board as just-used so it sorts to the top of the dropdown (Today's Focus stays pinned).
async function touchBoard(id) {
  try { const { boards: bs } = await request('/boards/' + id + '/touch', { method: 'POST' }); boards = bs; renderBoardSwitcher(); }
  catch (_) {}
}
function renderBoardSwitcher() {
  const wrap = $('#board-switcher');
  if (!wrap) return;
  wrap.innerHTML = '';
  const btn = el('button', 'flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-semibold text-ink transition hover:bg-edge');
  btn.append(el('span', 'text-base leading-none', currentBoard ? currentBoard.icon : '🎯'), el('span', 'max-w-[12rem] truncate', currentBoard ? currentBoard.name : "Today's Focus"));
  const chev = el('span', 'text-ink-faint'); chev.innerHTML = CHEV_SVG; btn.append(chev);

  const menu = el('div', 'absolute left-0 top-full z-30 mt-2 hidden w-64 overflow-hidden rounded-xl border border-edge bg-panel py-1 text-sm themed-shadow');
  boards.forEach((b) => {
    const active = currentBoard && b.id === currentBoard.id;
    const it = el('button', `flex w-full items-center gap-2 px-3 py-2 text-left transition hover:bg-edge ${active ? 'text-ink' : 'text-ink-soft'}`);
    it.append(el('span', 'text-base leading-none', b.icon), el('span', 'flex-1 truncate', b.name));
    if (b.streak) { const f = el('span', 'text-ink-faint'); f.innerHTML = FLAME_SVG; it.append(f); }
    it.addEventListener('click', () => { menu.classList.add('hidden'); selectBoard(b.id); });
    menu.append(it);
  });
  menu.append(el('div', 'my-1 border-t border-edge'));
  const action = (label, fn) => { const b = el('button', 'flex w-full items-center px-3 py-2 text-left text-ink-soft transition hover:bg-edge hover:text-ink', label); b.addEventListener('click', () => { menu.classList.add('hidden'); fn(); }); return b; };
  menu.append(action('＋  New board', () => openBoardEditor(null)), action('⚙  Manage boards', openBoardsModal));

  btn.addEventListener('click', (e) => { e.stopPropagation(); menu.classList.toggle('hidden'); });
  document.addEventListener('click', (e) => { if (!wrap.contains(e.target)) menu.classList.add('hidden'); });
  wrap.append(btn, menu);
}

function openBoardsModal() {
  const modal = $('#boards-modal'); modal.innerHTML = '';
  const panel = modalShell('Boards', () => closeModal('#boards-modal'));
  const newBtn = el('button', 'btn-accent mb-3 w-full rounded-lg px-4 py-2 text-sm font-semibold transition hover:opacity-90', '+ New board');
  newBtn.addEventListener('click', () => openBoardEditor(null));
  panel.append(newBtn);
  panel.append(el('p', 'mb-2 text-xs text-ink-faint', 'Ordered by most recently used — Today’s Focus stays on top.'));
  const list = el('div', 'space-y-1');
  boards.forEach((b) => {
    const row = el('div', 'flex items-center gap-2 rounded-lg border border-edge px-3 py-2');
    row.append(el('span', 'text-base leading-none', b.icon), el('span', 'flex-1 truncate text-sm text-ink', b.name));
    if (b.pinned) row.append(el('span', 'text-[10px] uppercase tracking-wider text-ink-faint', 'pinned'));
    if (b.spotlight) row.append(el('span', 'text-[10px] uppercase tracking-wider text-ink-faint', 'daily'));
    const ed = el('button', 'rounded-md px-2 py-1 text-xs text-ink-soft transition hover:bg-edge hover:text-ink', 'Edit'); ed.addEventListener('click', () => openBoardEditor(b));
    row.append(ed); list.append(row);
  });
  panel.append(list); modal.append(panel); openModal('#boards-modal');
}

function openBoardEditor(board) {
  const modal = $('#boards-modal'); modal.innerHTML = '';
  const panel = modalShell(board ? 'Edit board' : 'New board', () => closeModal('#boards-modal'));
  panel.classList.add('max-w-lg');

  const name = el('input', 'field'); name.placeholder = 'Board name'; name.value = board ? board.name : '';
  let chosenIcon = board ? board.icon : '🎯';
  const iconRow = el('div', 'flex flex-wrap gap-1'); const iconBtns = [];
  BOARD_ICONS.forEach((em) => {
    const b = el('button', 'grid h-8 w-8 place-items-center rounded-lg border border-edge text-base', em); b.type = 'button';
    if (em === chosenIcon) b.classList.add('border-edge-strong');
    b.addEventListener('click', () => { chosenIcon = em; iconBtns.forEach((x) => x.classList.remove('border-edge-strong')); b.classList.add('border-edge-strong'); });
    iconBtns.push(b); iconRow.append(b);
  });
  const flabel = el('input', 'field'); flabel.placeholder = 'e.g. Currently Reading, Quote of the Day'; flabel.value = board ? board.focusLabel : 'Focus';
  const spotRow = el('label', 'flex items-center justify-between gap-2 text-sm text-ink');
  spotRow.append(el('span', '', 'Auto "of the day" — feature one card automatically each day'));
  const spotChk = el('input', ''); spotChk.type = 'checkbox'; spotChk.checked = board ? board.spotlight : false; spotRow.append(spotChk);
  const streakRow = el('label', 'mt-2 flex items-center justify-between gap-2 text-sm text-ink');
  streakRow.append(el('span', '', 'Count focusing here toward my daily 🔥 streak'));
  const streakChk = el('input', ''); streakChk.type = 'checkbox'; streakChk.checked = board ? board.streak : false; streakRow.append(streakChk);
  const syncSpot = () => { streakRow.style.display = spotChk.checked ? 'none' : ''; if (spotChk.checked) streakChk.checked = false; };
  spotChk.addEventListener('change', syncSpot); syncSpot();

  const colsList = el('div', 'space-y-2');
  let editCols = board ? board.columns.map((c) => ({ key: c.key, label: c.label, accent: c.accent })) : [
    { label: 'To do', accent: '#60a5fa' }, { label: 'Doing', accent: '#f472b6' }, { label: 'Done', accent: '#34d399' },
  ];
  function renderCols() {
    colsList.innerHTML = '';
    editCols.forEach((c, i) => {
      const row = el('div', 'flex items-center gap-2');
      const lab = el('input', 'field flex-1'); lab.value = c.label; lab.placeholder = 'Column name'; lab.maxLength = MAX_LABEL_LEN; lab.addEventListener('input', () => { c.label = lab.value; });
      const col = el('input', 'h-9 w-9 shrink-0 rounded border border-edge bg-transparent'); col.type = 'color'; col.value = c.accent || '#60a5fa'; col.addEventListener('input', () => { c.accent = col.value; });
      const rm = el('button', 'grid h-8 w-8 shrink-0 place-items-center rounded-md text-ink-faint transition hover:text-red-400', '✕'); rm.type = 'button'; rm.addEventListener('click', () => { editCols.splice(i, 1); renderCols(); });
      row.append(lab, col, rm); colsList.append(row);
    });
  }
  renderCols();
  const addCol = el('button', 'mt-2 text-xs font-medium text-ink-soft transition hover:text-ink', '+ Add column'); addCol.type = 'button';
  addCol.addEventListener('click', () => { if (editCols.length < 8) { editCols.push({ label: 'New column', accent: COLUMN_ACCENTS[editCols.length % COLUMN_ACCENTS.length] }); renderCols(); } });

  const err = el('p', 'mt-1 hidden text-xs text-red-400');
  const save = el('button', 'btn-accent mt-3 w-full rounded-lg px-4 py-2 text-sm font-semibold transition hover:opacity-90', 'Save board');
  save.addEventListener('click', async () => {
    err.classList.add('hidden');
    const columns = editCols.filter((c) => c.label.trim()).map((c) => ({ key: c.key, label: c.label.trim(), accent: c.accent }));
    if (!name.value.trim()) return showErr('A board name is required.');
    if (!columns.length) return showErr('Add at least one column.');
    const payload = { name: name.value, icon: chosenIcon, focusLabel: flabel.value, columns, streak: streakChk.checked, spotlight: spotChk.checked };
    try {
      const result = board ? await request('/boards/' + board.id, { method: 'PATCH', body: JSON.stringify(payload) }) : await request('/boards', { method: 'POST', body: JSON.stringify(payload) });
      boards = result.boards; currentBoard = result.board;
      try { localStorage.setItem('tf-board', currentBoard.id); } catch (_) {}
      closeModal('#boards-modal'); buildBoard(); renderBoardSwitcher(); loadCards();
      toast(board ? 'Board updated' : 'Board created');
    } catch (e) { showErr(e.message); }
  });
  function showErr(m) { err.textContent = m; err.classList.remove('hidden'); }

  panel.append(
    el('label', 'mb-1 block text-xs text-ink-soft', 'Name'), name,
    el('label', 'mb-1 mt-3 block text-xs text-ink-soft', 'Icon'), iconRow,
    el('label', 'mb-1 mt-3 block text-xs text-ink-soft', 'Focus area label'), flabel,
    el('div', 'mt-3'), spotRow, streakRow,
    el('label', 'mb-1 mt-3 block text-xs text-ink-soft', 'Columns'), colsList, addCol,
    err, save,
  );
  if (board) {
    const del = el('button', 'mt-2 w-full rounded-lg border border-edge px-4 py-2 text-sm font-medium text-red-400 transition hover:bg-edge', 'Delete this board');
    del.addEventListener('click', async () => {
      if (!confirm(`Delete "${board.name}" and all its cards? This cannot be undone.`)) return;
      try {
        const { boards: bs } = await request('/boards/' + board.id, { method: 'DELETE' });
        boards = bs;
        if (!currentBoard || currentBoard.id === board.id) { currentBoard = boards[0]; try { localStorage.setItem('tf-board', currentBoard.id); } catch (_) {} }
        closeModal('#boards-modal'); buildBoard(); renderBoardSwitcher(); loadCards(); toast('Board deleted');
      } catch (e) { handleApiError(e); }
    });
    panel.append(del);
  }
  modal.append(panel); openModal('#boards-modal');
}

// ------------------------------------------------------------
// Donate · shop · streak · history
// ------------------------------------------------------------
async function renderDonate() {
  const slot = $('#donate-slot'); if (!slot) return;
  slot.innerHTML = '';
  let cfg = {}; try { cfg = await request('/donate'); } catch (_) { return; }
  if (!cfg.enabled || !cfg.url) return;
  const a = document.createElement('a');
  a.className = 'flex items-center gap-1.5 rounded-full border border-edge bg-panel px-3 py-1.5 text-xs font-medium text-ink-soft transition hover:border-edge-strong hover:text-ink themed-shadow';
  a.href = cfg.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
  a.innerHTML = HEART_SVG; a.appendChild(el('span', 'hidden sm:inline', cfg.label || 'Donate'));
  slot.appendChild(a);
}
async function loadShop() { try { shopConfig = await request('/shop'); } catch (_) { shopConfig = null; } renderUserMenu(); }

async function renderStreak() {
  const slot = $('#streak-slot'); if (!slot) return;
  try { historyData = await request('/history'); } catch (_) { return; }
  slot.innerHTML = '';
  if (!historyData || !historyData.current) return;
  const btn = el('button', 'flex items-center gap-1 rounded-full border border-edge bg-panel px-2.5 py-1.5 text-xs font-semibold transition hover:border-edge-strong themed-shadow');
  btn.style.color = 'var(--accent)';
  btn.innerHTML = FLAME_SVG; btn.appendChild(el('span', '', String(historyData.current)));
  btn.title = `${historyData.current}-day focus streak — view history`;
  btn.addEventListener('click', openHistoryModal);
  slot.appendChild(btn);
}
function formatDay(day) { const [y, m, d] = day.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' }); }
async function openHistoryModal() {
  const modal = $('#history-modal'); modal.innerHTML = '';
  const panel = modalShell('Focus history', () => closeModal('#history-modal'));
  try { historyData = await request('/history'); } catch (err) { return void handleApiError(err); }
  const stats = el('div', 'mb-4 grid grid-cols-3 gap-2 text-center');
  const stat = (n, label) => { const b = el('div', 'rounded-xl border border-edge p-3'); b.append(el('div', 'text-2xl font-extrabold text-ink-strong', String(n)), el('div', 'mt-0.5 text-[10px] uppercase tracking-wider text-ink-faint', label)); return b; };
  stats.append(stat(historyData.current, 'Day streak'), stat(historyData.longest, 'Longest'), stat(historyData.total, 'Days focused'));
  panel.append(stats);
  if (!historyData.history.length) panel.append(el('p', 'text-sm text-ink-faint', 'No focus days yet — set a focus on a streak-tracking board to begin.'));
  else {
    panel.append(el('h3', 'mb-2 text-xs font-semibold uppercase tracking-wider text-ink-faint', 'Recent'));
    const list = el('div', 'space-y-1');
    historyData.history.forEach((h) => { const r = el('div', 'flex items-baseline justify-between gap-3 rounded-lg border border-edge px-3 py-2'); r.append(el('span', 'truncate text-sm text-ink', h.title), el('span', 'shrink-0 text-xs tabular-nums text-ink-faint', formatDay(h.day))); list.append(r); });
    panel.append(list);
  }
  modal.append(panel); openModal('#history-modal');
}
function triggerDownload(url) { const a = document.createElement('a'); a.href = url; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove(); }

// ---- recovery codes: shown ONCE, on first sign-up or after regenerating ----
function showRecoveryCodes(codes, isFirstTime) {
  const modal = $('#recovery-modal'); modal.innerHTML = '';
  const panel = modalShell('Recovery codes', () => closeModal('#recovery-modal'));
  panel.classList.add('max-w-md');
  panel.append(el('p', 'mb-3 text-sm text-ink-soft', isFirstTime
    ? 'Save these somewhere safe. They are the only way back into your account if you forget your password — there is no email reset. Each code works once.'
    : 'Your old codes no longer work. Save these new ones somewhere safe — each works once.'));
  const grid = el('div', 'grid grid-cols-2 gap-2 rounded-xl border border-edge bg-inputbg p-3 font-mono text-sm text-ink');
  codes.forEach((c) => grid.append(el('div', 'tracking-wide', c)));
  panel.append(grid);
  const row = el('div', 'mt-3 flex gap-2');
  const copy = el('button', 'flex-1 rounded-lg border border-edge px-3 py-2 text-xs font-medium text-ink-soft transition hover:text-ink', 'Copy all');
  copy.addEventListener('click', () => navigator.clipboard.writeText(codes.join('\n')).then(() => toast('Codes copied')).catch(() => {}));
  const dl = el('button', 'flex-1 rounded-lg border border-edge px-3 py-2 text-xs font-medium text-ink-soft transition hover:text-ink', 'Download .txt');
  dl.addEventListener('click', () => {
    const who = currentUser ? currentUser.username : '';
    const blob = new Blob([`Today's Focus — recovery codes for ${who}\nKeep these safe. Each code works once.\n\n${codes.join('\n')}\n`], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'todays-focus-recovery-codes.txt'; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  });
  row.append(copy, dl); panel.append(row);
  const done = el('button', 'btn-accent mt-3 w-full rounded-lg px-4 py-2 text-sm font-semibold transition hover:opacity-90', 'I’ve saved them');
  done.addEventListener('click', () => closeModal('#recovery-modal'));
  panel.append(done);
  modal.append(panel); openModal('#recovery-modal');
}

function openHelpModal() {
  const modal = $('#help-modal'); modal.innerHTML = '';
  const panel = modalShell('Help & tips', () => closeModal('#help-modal'));
  panel.classList.add('max-w-lg');

  const sec = (title, first) => panel.append(el('h3', `mb-3 text-xs font-semibold uppercase tracking-wider text-ink-faint${first ? '' : ' mt-5 border-t border-edge pt-4'}`, title));
  const tip = (icon, label, detail) => {
    const row = el('div', 'mb-3 flex gap-3');
    row.append(el('div', 'w-5 shrink-0 text-center text-base leading-snug select-none', icon));
    const right = el('div', '');
    right.append(el('p', 'text-sm font-medium text-ink', label));
    if (detail) right.append(el('p', 'mt-0.5 text-xs leading-relaxed text-ink-soft', detail));
    row.append(right); panel.append(row);
  };

  sec('Using the app', true);
  tip('👆', 'Double-tap a card to focus it', 'The card moves into the focus zone at the top — only one can be focused at a time. Double-tap the focused card, or tap "Release", to send it back to its column.');
  tip('↕', 'Drag to reorder or move', 'Drag a card to a different column to move it, drag within a column to reorder, or drag directly into the focus zone to feature it.');
  tip('⋯', 'Card menu', 'Hover a card and tap ⋯ to edit the title, move it to another board, or archive it.');
  tip('+', 'Subtasks', 'Tap + on a card to add a checklist. A coloured dot badge means there are hidden subtasks — tap +/− to show or hide them.');
  tip('🗂', 'Boards', 'Tap the board name in the top-left to switch boards, create new ones, or manage existing ones. Today\'s Focus stays pinned at the top.');
  tip('✏️', 'Rename columns', 'Tap any column heading to rename it — saves immediately.');
  tip('🔥', 'Streak & history', 'Tap the flame counter in the header to review every card you\'ve ever focused on, your current streak, and your longest run.');
  tip('🗄', 'Archive', 'Archived cards aren\'t deleted — find them in the user menu → Archive to restore or permanently delete them.');

  sec('Install on your device');
  tip('📱', 'iPhone / iPad (Safari)', 'Tap the Share button (box with arrow) at the bottom of the screen → "Add to Home Screen". The app opens full-screen with no browser bar, like a native app.');
  tip('🤖', 'Android (Chrome)', 'Tap ⋮ in the top-right → "Add to Home Screen" or "Install app".');
  tip('💻', 'Desktop (Chrome / Edge)', 'Look for a ⊕ or download icon in the address bar and click "Install". Or open the browser menu → "Install Today\'s Focus".');

  sec('Automation API');
  tip('🔑', 'Your API token', 'Open the user menu → Account & API token. The token lets scripts, n8n, and other automation tools add cards without a browser session. Keep it secret.');
  const code = el('pre', 'mt-1 overflow-x-auto rounded-lg border border-edge bg-inputbg p-3 text-[11px] text-ink-soft');
  code.textContent = `curl -X POST ${location.origin}/api/cards \\\n  -H "Authorization: Bearer <your-token>" \\\n  -H "Content-Type: application/json" \\\n  -d '{"title":"Idea from n8n","type":"thought"}'`;
  panel.append(code);
  panel.append(el('p', 'mt-2 text-xs text-ink-faint', 'Set "type" to the column key you want — e.g. "thought", "project", or "goal" on the default board. Cards are added to your most-recently-used board by default.'));

  modal.append(panel); openModal('#help-modal');
}

async function openArchiveModal() {
  const modal = $('#archive-modal'); modal.innerHTML = '';
  const panel = modalShell('Archive', () => closeModal('#archive-modal'));
  const listWrap = el('div', 'space-y-1'); panel.append(listWrap);
  modal.append(panel); openModal('#archive-modal');
  await loadArchive(listWrap);
}
async function loadArchive(listWrap) {
  listWrap.innerHTML = '';
  let archived = [];
  try { archived = (await request('/archive')).archived; } catch (err) { return void handleApiError(err); }
  if (!archived.length) { listWrap.append(el('p', 'text-sm text-ink-faint', 'Nothing archived. Cards you remove from a board land here.')); return; }
  archived.forEach((c) => {
    const row = el('div', 'flex items-center justify-between gap-2 rounded-lg border border-edge px-3 py-2');
    row.append(el('span', 'truncate text-sm text-ink', c.title));
    const actions = el('div', 'flex shrink-0 items-center gap-1');
    const restore = el('button', 'rounded-md px-2 py-1 text-xs text-ink-soft transition hover:bg-edge hover:text-ink', 'Restore');
    restore.addEventListener('click', async () => { try { const r = await request(`/cards/${c.id}/restore`, { method: 'POST' }); if (currentBoard && c.boardId === currentBoard.id) { state.cards = r.cards; render(); } toast('Card restored'); loadArchive(listWrap); } catch (err) { handleApiError(err); } });
    const del = el('button', 'rounded-md px-2 py-1 text-xs text-red-400 transition hover:bg-edge', 'Delete');
    del.addEventListener('click', async () => { if (!confirm(`Permanently delete "${c.title}"? This cannot be undone.`)) return; try { await request(`/cards/${c.id}`, { method: 'DELETE' }); toast('Permanently deleted'); loadArchive(listWrap); } catch (err) { handleApiError(err); } });
    actions.append(restore, del); row.append(actions); listWrap.append(row);
  });
}

// ------------------------------------------------------------
// User menu + modals shell
// ------------------------------------------------------------
function renderUserMenu() {
  const wrap = $('#user-menu'); if (!wrap || !currentUser) return;
  wrap.innerHTML = '';
  const btn = el('button', 'flex items-center gap-2 rounded-full border border-edge bg-panel px-3 py-1.5 text-xs font-medium text-ink-soft transition hover:text-ink themed-shadow');
  const dot = el('span', 'grid h-5 w-5 place-items-center rounded-full text-[10px] font-bold'); dot.style.background = 'var(--accent)'; dot.style.color = 'var(--bg)'; dot.textContent = (currentUser.username[0] || '?').toUpperCase();
  btn.append(dot, el('span', 'max-w-[10rem] truncate', currentUser.username));
  const menu = el('div', 'absolute right-0 top-full z-30 mt-2 hidden w-44 overflow-hidden rounded-xl border border-edge bg-panel py-1 text-sm themed-shadow');
  const item = (label, onClick, danger) => { const b = el('button', `flex w-full items-center px-3 py-2 text-left transition hover:bg-edge ${danger ? 'text-red-400' : 'text-ink'}`, label); b.addEventListener('click', () => { menu.classList.add('hidden'); onClick(); }); return b; };
  const themeSection = el('div', 'flex md:hidden items-center justify-center gap-1 border-b border-edge px-2 py-2');
  THEMES.forEach((t) => { const active = settings.theme === t.id; const b = el('button', `grid h-7 w-7 place-items-center rounded-full text-xs transition ${active ? 'btn-accent' : 'text-ink-soft hover:text-ink'}`); b.type = 'button'; b.title = `${t.label} theme`; b.innerHTML = ICONS[t.id] || ''; b.addEventListener('click', () => { setTheme(t.id); renderUserMenu(); }); themeSection.append(b); });
  menu.append(themeSection);
  if (currentUser.role === 'admin') menu.append(el('div', 'px-3 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-ink-faint', 'Admin'), item('Manage users', openAdminModal));
  if (shopConfig && shopConfig.enabled && shopConfig.url) menu.append(item(shopConfig.label || 'Get the 3D-printed version', () => window.open(shopConfig.url, '_blank', 'noopener')));
  menu.append(item('Focus history', openHistoryModal), item('Archive', openArchiveModal), item('Help & tips', openHelpModal), item('Account & API token', openAccountModal), item('Log out', logout, true));
  btn.addEventListener('click', (e) => { e.stopPropagation(); menu.classList.toggle('hidden'); });
  document.addEventListener('click', (e) => { if (!wrap.contains(e.target)) menu.classList.add('hidden'); });
  wrap.append(btn, menu);
}
function openModal(sel) { const m = $(sel); m.classList.remove('hidden'); m.classList.add('flex'); }
function closeModal(sel) { const m = $(sel); m.classList.add('hidden'); m.classList.remove('flex'); }
function modalShell(title, onClose) {
  const panel = el('div', 'w-full max-w-md rounded-2xl border border-edge bg-panel p-5 themed-shadow max-h-[85vh] overflow-y-auto clean-scroll');
  const head = el('div', 'mb-4 flex items-center justify-between');
  head.append(el('h2', 'text-base font-semibold text-ink', title));
  const x = el('button', 'grid h-7 w-7 place-items-center rounded-lg text-ink-soft transition hover:bg-edge hover:text-ink', '✕'); x.addEventListener('click', onClose);
  head.append(x); panel.append(head); return panel;
}

// ---- Account modal ----
async function openAccountModal() {
  const modal = $('#account-modal'); modal.innerHTML = '';
  const close = () => closeModal('#account-modal');
  const panel = modalShell('Account', close);
  panel.append(el('h3', 'mb-1 text-xs font-semibold uppercase tracking-wider text-ink-faint', 'Automation API token'));
  panel.append(el('p', 'mb-2 text-xs text-ink-soft', 'Add cards to your default board from n8n or scripts. Keep it secret.'));
  const tokenRow = el('div', 'flex gap-2'); const tokenInput = el('input', 'field flex-1 font-mono text-xs'); tokenInput.readOnly = true; tokenInput.value = 'Loading…';
  const copyBtn = el('button', 'rounded-lg border border-edge px-3 text-xs text-ink-soft transition hover:text-ink', 'Copy');
  copyBtn.addEventListener('click', () => navigator.clipboard.writeText(tokenInput.value).then(() => toast('Token copied')));
  tokenRow.append(tokenInput, copyBtn); panel.append(tokenRow);
  const regenBtn = el('button', 'mt-2 text-xs font-medium text-ink-soft transition hover:text-ink', 'Regenerate token (invalidates the old one)');
  regenBtn.addEventListener('click', async () => { if (!confirm('Regenerate your API token? Old automations will stop working.')) return; try { const { apiToken } = await request('/auth/token', { method: 'POST' }); tokenInput.value = apiToken; toast('New token generated'); } catch (err) { handleApiError(err); } });
  panel.append(regenBtn);
  const curl = el('pre', 'mt-3 overflow-x-auto rounded-lg border border-edge bg-inputbg p-3 text-[11px] text-ink-soft');
  curl.textContent = `curl -X POST ${location.origin}/api/cards \\\n  -H "Authorization: Bearer <token>" \\\n  -H "Content-Type: application/json" \\\n  -d '{"title":"From n8n","type":"thought"}'`;
  panel.append(curl);

  panel.append(el('div', 'my-4 border-t border-edge'), el('h3', 'mb-2 text-xs font-semibold uppercase tracking-wider text-ink-faint', 'Change password'));
  const pwForm = el('form', 'space-y-2');
  const curPw = el('input', 'field'); curPw.type = 'password'; curPw.placeholder = 'Current password'; curPw.autocomplete = 'current-password';
  const newPw = el('input', 'field'); newPw.type = 'password'; newPw.placeholder = 'New password (min 8)'; newPw.autocomplete = 'new-password';
  const pwErr = el('p', 'hidden text-xs text-red-400');
  const pwBtn = el('button', 'btn-accent w-full rounded-lg px-4 py-2 text-sm font-semibold transition hover:opacity-90', 'Update password'); pwBtn.type = 'submit';
  pwForm.append(curPw, newPw, pwErr, pwBtn);
  pwForm.addEventListener('submit', async (e) => { e.preventDefault(); pwErr.classList.add('hidden'); try { await request('/auth/password', { method: 'POST', body: JSON.stringify({ currentPassword: curPw.value, newPassword: newPw.value }) }); toast('Password updated'); close(); } catch (err) { pwErr.textContent = err.message; pwErr.classList.remove('hidden'); } });
  panel.append(pwForm);

  panel.append(el('div', 'my-4 border-t border-edge'), el('h3', 'mb-2 text-xs font-semibold uppercase tracking-wider text-ink-faint', 'Recovery codes'));
  const recInfo = el('p', 'mb-2 text-xs text-ink-soft', 'Loading…');
  const recBtn = el('button', 'rounded-lg border border-edge px-3 py-1.5 text-xs font-medium text-ink-soft transition hover:text-ink', 'Generate codes');
  const refreshRec = async () => {
    try {
      const { remaining } = await request('/auth/recovery');
      recInfo.textContent = remaining > 0
        ? `${remaining} unused code${remaining === 1 ? '' : 's'} left — use one to reset your password if you forget it (there’s no email reset).`
        : 'No recovery codes yet. Generate a set so you can reset your password if you ever forget it.';
      recBtn.textContent = remaining > 0 ? 'Regenerate codes' : 'Generate codes';
    } catch (_) {}
  };
  recBtn.addEventListener('click', async () => {
    if (!confirm('Generate a fresh set of recovery codes? Any previous codes will stop working.')) return;
    try { const { recoveryCodes } = await request('/auth/recovery/regenerate', { method: 'POST' }); showRecoveryCodes(recoveryCodes, false); refreshRec(); }
    catch (err) { handleApiError(err); }
  });
  panel.append(recInfo, recBtn);
  refreshRec();

  panel.append(el('div', 'my-4 border-t border-edge'), el('h3', 'mb-2 text-xs font-semibold uppercase tracking-wider text-ink-faint', 'Username'));
  const unForm = el('form', 'flex gap-2');
  const unInput = el('input', 'field flex-1'); unInput.value = currentUser.username; unInput.autocapitalize = 'none';
  const unBtn = el('button', 'rounded-lg border border-edge px-3 text-xs font-medium text-ink-soft transition hover:text-ink', 'Save'); unBtn.type = 'submit';
  const unErr = el('p', 'mt-1 hidden text-xs text-red-400'); unForm.append(unInput, unBtn);
  unForm.addEventListener('submit', async (e) => { e.preventDefault(); unErr.classList.add('hidden'); try { const { user } = await request('/auth/username', { method: 'POST', body: JSON.stringify({ username: unInput.value.trim() }) }); currentUser = user; renderUserMenu(); toast('Username updated'); } catch (err) { unErr.textContent = err.message; unErr.classList.remove('hidden'); } });
  panel.append(unForm, unErr);

  panel.append(el('div', 'my-4 border-t border-edge'), el('h3', 'mb-2 text-xs font-semibold uppercase tracking-wider text-ink-faint', 'Your data'));
  const dl = el('button', 'flex items-center gap-2 rounded-lg border border-edge px-3 py-2 text-xs font-medium text-ink-soft transition hover:text-ink'); dl.innerHTML = DOWN_SVG; dl.appendChild(el('span', '', 'Download my boards & history (JSON)'));
  dl.addEventListener('click', () => triggerDownload('/api/export')); panel.append(dl);

  panel.append(el('div', 'my-4 border-t border-edge'), el('h3', 'mb-2 text-xs font-semibold uppercase tracking-wider text-ink-faint', 'Timezone'));
  const tzForm = el('form', 'flex gap-2'); const tzSel = el('select', 'field flex-1');
  const optAuto = el('option', '', 'Auto (server default)'); optAuto.value = ''; tzSel.appendChild(optAuto);
  let zones = []; try { zones = Intl.supportedValuesOf('timeZone'); } catch (_) {}
  zones.forEach((z) => { const o = el('option', '', z); o.value = z; tzSel.appendChild(o); });
  tzSel.value = currentUser.timezone || '';
  const tzBtn = el('button', 'rounded-lg border border-edge px-3 text-xs font-medium text-ink-soft transition hover:text-ink', 'Save'); tzBtn.type = 'submit'; tzForm.append(tzSel, tzBtn);
  let detected = 'UTC'; try { detected = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (_) {}
  tzForm.addEventListener('submit', async (e) => { e.preventDefault(); try { const { settings: s } = await request('/settings', { method: 'PUT', body: JSON.stringify({ timezone: tzSel.value }) }); currentUser.timezone = s.timezone || ''; settings = s; setDate(); renderStreak(); toast('Timezone saved'); } catch (err) { handleApiError(err); } });
  panel.append(tzForm, el('p', 'mt-1 text-[11px] text-ink-faint', `This device looks like ${detected}.`));

  modal.append(panel); openModal('#account-modal');
  try { const { apiToken } = await request('/auth/me'); tokenInput.value = apiToken || '(none)'; } catch (err) { tokenInput.value = '(unavailable)'; handleApiError(err); }
}

// ---- Admin modal ----
async function openAdminModal() {
  const modal = $('#admin-modal'); modal.innerHTML = '';
  const panel = modalShell('Manage users', () => closeModal('#admin-modal'));
  panel.classList.add('max-w-lg');

  const backupBtn = el('button', 'mb-4 flex w-full items-center justify-center gap-2 rounded-lg border border-edge px-3 py-2 text-xs font-medium text-ink-soft transition hover:text-ink'); backupBtn.innerHTML = DOWN_SVG; backupBtn.appendChild(el('span', '', 'Download database backup (.db)'));
  backupBtn.addEventListener('click', () => triggerDownload('/api/admin/backup')); panel.append(backupBtn);

  const reg = el('div', 'mb-4 rounded-xl border border-edge p-3');
  reg.append(el('h3', 'mb-2 text-xs font-semibold uppercase tracking-wider text-ink-faint', 'Registration'));
  const openRow = el('label', 'flex items-center justify-between gap-2 text-sm text-ink'); openRow.append(el('span', '', 'Allow open registration (anyone can sign up)'));
  const openToggle = el('input', ''); openToggle.type = 'checkbox'; openRow.append(openToggle);
  const codeRow = el('div', 'mt-3'); codeRow.append(el('label', 'mb-1 block text-xs text-ink-soft', 'Invite code (blank = no invite signup)'));
  const codeInput = el('input', 'field'); codeInput.placeholder = 'invite code';
  const saveReg = el('button', 'mt-2 rounded-lg border border-edge px-3 py-1.5 text-xs font-medium text-ink-soft transition hover:text-ink', 'Save registration settings');
  codeRow.append(codeInput, saveReg); reg.append(openRow, codeRow);
  saveReg.addEventListener('click', async () => { try { await request('/admin/settings', { method: 'PATCH', body: JSON.stringify({ openRegistration: openToggle.checked, inviteCode: codeInput.value }) }); toast('Registration settings saved'); } catch (err) { handleApiError(err); } });
  panel.append(reg);

  const don = el('div', 'mb-4 rounded-xl border border-edge p-3');
  don.append(el('h3', 'mb-2 text-xs font-semibold uppercase tracking-wider text-ink-faint', 'Donations'));
  const donRow = el('label', 'flex items-center justify-between gap-2 text-sm text-ink'); donRow.append(el('span', '', 'Show a donate button to everyone'));
  const donToggle = el('input', ''); donToggle.type = 'checkbox'; donRow.append(donToggle);
  const preset = el('select', 'field mt-3'); DONATE_PRESETS.forEach((p, i) => { const o = el('option', '', p.label); o.value = String(i); preset.appendChild(o); });
  const donLabel = el('input', 'field mt-2'); donLabel.placeholder = 'Button label'; donLabel.maxLength = 60;
  const donUrl = el('input', 'field mt-2'); donUrl.placeholder = 'https://… donation link';
  const donErr = el('p', 'mt-1 hidden text-xs text-red-400');
  const saveDon = el('button', 'mt-2 rounded-lg border border-edge px-3 py-1.5 text-xs font-medium text-ink-soft transition hover:text-ink', 'Save donation settings');
  preset.addEventListener('change', () => { const p = DONATE_PRESETS[Number(preset.value)]; if (!p) return; if (p.url) donUrl.value = p.url; if (p.label && p.label !== 'Custom…') donLabel.value = p.label; });
  saveDon.addEventListener('click', async () => { donErr.classList.add('hidden'); try { await request('/admin/settings', { method: 'PATCH', body: JSON.stringify({ donateEnabled: donToggle.checked, donateLabel: donLabel.value, donateUrl: donUrl.value }) }); toast('Donation settings saved'); renderDonate(); } catch (err) { donErr.textContent = err.message; donErr.classList.remove('hidden'); } });
  don.append(donRow, preset, donLabel, donUrl, donErr, saveDon); panel.append(don);

  const shop = el('div', 'mb-4 rounded-xl border border-edge p-3');
  shop.append(el('h3', 'mb-2 text-xs font-semibold uppercase tracking-wider text-ink-faint', '3D-print shop'));
  const shopRow = el('label', 'flex items-center justify-between gap-2 text-sm text-ink'); shopRow.append(el('span', '', 'Show a "buy the 3D-printed version" link in the menu'));
  const shopToggle = el('input', ''); shopToggle.type = 'checkbox'; shopRow.append(shopToggle);
  const shopLabel = el('input', 'field mt-3'); shopLabel.placeholder = 'Link label'; shopLabel.maxLength = 60;
  const shopUrl = el('input', 'field mt-2'); shopUrl.placeholder = 'https://… your shop / product page';
  const shopErr = el('p', 'mt-1 hidden text-xs text-red-400');
  const saveShop = el('button', 'mt-2 rounded-lg border border-edge px-3 py-1.5 text-xs font-medium text-ink-soft transition hover:text-ink', 'Save shop link');
  saveShop.addEventListener('click', async () => { shopErr.classList.add('hidden'); try { await request('/admin/settings', { method: 'PATCH', body: JSON.stringify({ shopEnabled: shopToggle.checked, shopLabel: shopLabel.value, shopUrl: shopUrl.value }) }); toast('Shop link saved'); loadShop(); } catch (err) { shopErr.textContent = err.message; shopErr.classList.remove('hidden'); } });
  shop.append(shopRow, shopLabel, shopUrl, shopErr, saveShop); panel.append(shop);

  const create = el('form', 'mb-4 rounded-xl border border-edge p-3 space-y-2');
  create.append(el('h3', 'text-xs font-semibold uppercase tracking-wider text-ink-faint', 'Create account'));
  const cuName = el('input', 'field'); cuName.placeholder = 'username'; cuName.autocapitalize = 'none';
  const cuPass = el('input', 'field'); cuPass.type = 'text'; cuPass.placeholder = 'password (min 8)';
  const cuRole = el('select', 'field'); cuRole.innerHTML = '<option value="user">user</option><option value="admin">admin</option>';
  const cuErr = el('p', 'hidden text-xs text-red-400');
  const cuBtn = el('button', 'btn-accent w-full rounded-lg px-4 py-2 text-sm font-semibold transition hover:opacity-90', 'Create account'); cuBtn.type = 'submit';
  create.append(cuName, cuPass, cuRole, cuErr, cuBtn);
  create.addEventListener('submit', async (e) => { e.preventDefault(); cuErr.classList.add('hidden'); try { await request('/admin/users', { method: 'POST', body: JSON.stringify({ username: cuName.value.trim(), password: cuPass.value, role: cuRole.value }) }); toast(`Created "${cuName.value.trim()}"`); cuName.value = ''; cuPass.value = ''; loadAdminUsers(listWrap); } catch (err) { cuErr.textContent = err.message; cuErr.classList.remove('hidden'); } });
  panel.append(create);

  panel.append(el('h3', 'mb-2 text-xs font-semibold uppercase tracking-wider text-ink-faint', 'Accounts'));
  const listWrap = el('div', 'space-y-1'); panel.append(listWrap);
  modal.append(panel); openModal('#admin-modal');
  try { const s = await request('/admin/settings'); openToggle.checked = s.openRegistration; codeInput.value = s.inviteCode || ''; donToggle.checked = !!s.donateEnabled; donLabel.value = s.donateLabel || ''; donUrl.value = s.donateUrl || ''; shopToggle.checked = !!s.shopEnabled; shopLabel.value = s.shopLabel || ''; shopUrl.value = s.shopUrl || ''; } catch (err) { handleApiError(err); }
  loadAdminUsers(listWrap);
}
async function loadAdminUsers(listWrap) {
  listWrap.innerHTML = '';
  let users = [];
  try { users = (await request('/admin/users')).users; } catch (err) { return void handleApiError(err); }
  users.forEach((u) => {
    const row = el('div', 'flex items-center justify-between gap-2 rounded-lg border border-edge px-3 py-2');
    const name = el('div', 'flex min-w-0 items-center gap-2');
    name.append(el('span', 'truncate text-sm text-ink', u.username));
    if (u.role === 'admin') name.append(el('span', 'rounded bg-edge px-1.5 py-0.5 text-[10px] font-semibold uppercase text-ink-soft', 'admin'));
    if (u.id === currentUser.id) name.append(el('span', 'text-[10px] text-ink-faint', '(you)'));
    row.append(name);
    if (u.id !== currentUser.id) {
      const actions = el('div', 'flex shrink-0 items-center gap-1');
      const reset = el('button', 'rounded-md px-2 py-1 text-xs text-ink-soft transition hover:bg-edge hover:text-ink', 'Reset PW');
      reset.addEventListener('click', async () => { const np = prompt(`New password for "${u.username}" (min 8 characters):`); if (np == null) return; try { await request(`/admin/users/${u.id}/password`, { method: 'POST', body: JSON.stringify({ newPassword: np }) }); toast(`Password reset for "${u.username}"`); } catch (err) { handleApiError(err); } });
      const del = el('button', 'rounded-md px-2 py-1 text-xs text-red-400 transition hover:bg-edge', 'Delete');
      del.addEventListener('click', async () => { if (!confirm(`Delete "${u.username}" and all their data? This cannot be undone.`)) return; try { await request(`/admin/users/${u.id}`, { method: 'DELETE' }); toast(`Deleted "${u.username}"`); loadAdminUsers(listWrap); } catch (err) { handleApiError(err); } });
      actions.append(reset, del); row.append(actions);
    }
    listWrap.append(row);
  });
}

// ------------------------------------------------------------
// Theme
// ------------------------------------------------------------
function applyTheme(theme) { document.documentElement.dataset.theme = theme; try { localStorage.setItem('tf-theme', theme); } catch (_) {} }
function setTheme(theme) { settings.theme = theme; applyTheme(theme); renderThemeToggle(); if (currentUser) request('/settings', { method: 'PUT', body: JSON.stringify({ theme }) }).catch(() => {}); }
function renderThemeToggle() {
  $$('.js-theme-toggle').forEach((wrap) => {
    wrap.innerHTML = '';
    THEMES.forEach((t) => {
      const active = settings.theme === t.id;
      const btn = el('button', `flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition ${active ? 'btn-accent' : 'text-ink-soft hover:text-ink'}`);
      btn.innerHTML = `${ICONS[t.id] || ''}<span class="hidden sm:inline">${t.label}</span>`; btn.type = 'button'; btn.title = `${t.label} theme`;
      btn.addEventListener('click', () => setTheme(t.id)); wrap.appendChild(btn);
    });
  });
}

// ------------------------------------------------------------
// Board rendering (focus zone + dynamic columns)
// ------------------------------------------------------------
function buildBoard() {
  const wrap = $('#columns'); wrap.innerHTML = ''; refs = { columns: {} }; seenCards = new Set(); expandedCards = new Set();
  const cols = boardCols();
  const n = Math.min(Math.max(cols.length, 1), 4);
  wrap.className = `grid min-h-0 flex-[7] grid-cols-1 gap-4 md:grid-cols-${n}`;
  cols.forEach((col) => {
    const section = el('section', 'themed-shadow flex min-h-0 flex-col overflow-hidden rounded-2xl border border-edge bg-panel');
    const header = el('header', 'flex items-center justify-between gap-2 border-b border-edge px-4 py-3');
    const left = el('div', 'flex items-center gap-2');
    const dot = el('span', 'h-2.5 w-2.5 shrink-0 rounded-full'); dot.style.background = col.accent || '#60a5fa';
    const labelSlot = el('div', 'flex items-center');
    const count = el('span', 'text-xs tabular-nums text-ink-faint');
    left.append(dot, labelSlot, count);
    const addBtn = el('button', 'grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-edge text-lg leading-none text-ink-soft transition duration-200 hover:border-edge-strong hover:text-ink');
    addBtn.textContent = '+'; addBtn.title = 'Add a card'; addBtn.addEventListener('click', () => toggleComposer(col.key));
    header.append(left, addBtn);
    const composer = el('div', 'hidden px-3 pt-3');
    const body = el('div', 'clean-scroll flex-1 space-y-2 overflow-y-auto p-3 max-h-[55vh] md:max-h-none');
    body.dataset.dropzone = 'column'; body.dataset.type = col.key;
    attachColumnSortable(body, col.key);
    section.append(header, composer, body); wrap.appendChild(section);
    refs.columns[col.key] = { cards: body, composer, count, addBtn, labelSlot };
  });
  renderLabels();
}
function render() { renderFocus(); boardCols().forEach(renderColumn); }
function renderFocus() {
  const zone = $('#focus-zone');
  const flabel = (currentBoard && currentBoard.focusLabel) || 'Focus';
  const spotlight = isSpotlight();
  const feature = spotlight ? spotlightPick(state.cards) : state.cards.find((c) => c.focused);
  zone.classList.toggle('is-active', Boolean(feature));
  zone.innerHTML = '';

  if (!feature) {
    const empty = el('div', 'flex h-full w-full flex-col items-center justify-center gap-5 overflow-y-auto px-6 text-center');
    empty.append(el('span', 'text-xs font-semibold uppercase tracking-[0.35em] text-ink-soft md:text-sm', flabel),
                 el('p', 'max-w-md text-base text-ink-faint md:text-lg', spotlight ? 'Add cards to this board to get a daily pick.' : 'Drag a card here to feature it.'));
    zone.appendChild(empty); return;
  }

  // Title takes the centre; the checklist sits in its own panel off to the right
  // (stacks underneath only on narrow screens). Flexbox keeps them from ever overlapping.
  const inner = el('div', 'flex h-full w-full flex-col items-center justify-center gap-6 overflow-y-auto px-6 md:flex-row md:gap-10');

  const editingTitle = !spotlight && ui.editingCard === feature.id;
  const main = el('div', 'flex min-w-0 flex-col items-center text-center md:flex-1');
  const cwrap = el('div', `relative w-full max-w-3xl select-none ${(!spotlight && !editingTitle) ? 'cursor-grab active:cursor-grabbing' : ''}`);
  if (!spotlight && !editingTitle) { cwrap.draggable = true; cwrap.dataset.cardId = feature.id; cwrap.title = 'Drag back to a column, or double-click to release'; cwrap.addEventListener('dblclick', () => moveCard(feature.id, { focused: false })); }
  cwrap.append(el('span', 'mb-3 block text-[10px] font-semibold uppercase tracking-[0.4em] text-accent md:text-xs', flabel));
  if (editingTitle) {
    cwrap.append(cardTitleEditor(feature, cwrap, { large: true }));
  } else {
    const text = el('p', 'break-words font-extrabold leading-[1.04] tracking-tight text-ink-strong text-3xl sm:text-5xl md:text-6xl lg:text-7xl'); text.textContent = feature.title;
    cwrap.append(text);
  }
  main.append(cwrap);
  if (!spotlight && !editingTitle) {
    const btnRow = el('div', 'mt-5 flex items-center justify-center gap-2');
    const edit = el('button', 'inline-flex items-center gap-1.5 rounded-full border border-edge px-4 py-1.5 text-xs font-medium text-ink-soft transition hover:border-edge-strong hover:text-ink');
    edit.innerHTML = PENCIL_SVG; edit.append(el('span', '', 'Edit')); edit.addEventListener('click', () => { ui.editingCard = feature.id; render(); });
    const release = el('button', 'inline-flex items-center gap-2 rounded-full border border-edge px-4 py-1.5 text-xs font-medium text-ink-soft transition hover:border-edge-strong hover:text-ink', 'Release'); release.addEventListener('click', () => moveCard(feature.id, { focused: false }));
    btnRow.append(edit, release); main.append(btnRow);
  }
  inner.append(main);

  if (!spotlight && subtasksOf(feature).length > 0) { // only show the side panel when the card actually has subtasks
    const aside = el('div', 'clean-scroll w-full shrink-0 self-center md:max-h-full md:w-72 md:overflow-y-auto md:border-l md:border-edge md:pl-8');
    aside.append(subtaskSection(feature, cwrap, { large: true }));
    inner.append(aside);
  }

  zone.appendChild(inner);
}
function renderColumn(col) {
  const ref = refs.columns[col.key]; if (!ref) return;
  const items = state.cards.filter((c) => c.type === col.key && (isSpotlight() || !c.focused)).sort((a, b) => (a.position - b.position) || (a.createdAt < b.createdAt ? -1 : 1));
  ref.count.textContent = items.length ? String(items.length) : '';
  ref.cards.innerHTML = '';
  if (!items.length) { ref.cards.appendChild(el('p', 'select-none px-1 py-6 text-center text-sm text-ink-faint', col.hint || `Add to ${col.label}`)); return; }
  items.forEach((c) => ref.cards.appendChild(cardEl(c)));
}
function cardEl(card) {
  const editing = ui.editingCard === card.id;
  const expanded = expandedCards.has(card.id);
  const fresh = !seenCards.has(card.id); seenCards.add(card.id);
  const node = el('article', `${fresh ? 'card-enter ' : ''}themed-shadow group relative select-none rounded-xl border border-edge bg-card px-4 py-3 text-sm text-ink transition hover:border-edge-strong ${editing ? '' : 'cursor-grab active:cursor-grabbing'}`);
  node.draggable = !editing; node.dataset.cardId = card.id; node.title = 'Drag to reorder/move · double-click to focus';
  node.addEventListener('dblclick', () => { if (isSpotlight() || ui.editingCard === card.id) return; moveCard(card.id, { focused: true }); });
  if (card.priority) {
    const PRIO_HEX  = ['','#60a5fa','#fbbf24','#f87171'];
    const PRIO_RGBA = ['','rgba(96,165,250,0.10)','rgba(251,191,36,0.10)','rgba(248,113,113,0.10)'];
    const h = PRIO_HEX[card.priority], r = PRIO_RGBA[card.priority];
    node.style.borderLeftColor = h;
    node.style.borderLeftWidth = '2px';
    const wash = document.createElement('span');
    wash.className = 'pointer-events-none absolute inset-y-0 left-0 rounded-l-xl';
    wash.style.cssText = `width:45%;background:linear-gradient(to right,${r},transparent)`;
    node.appendChild(wash);
  }

  if (editing) {
    node.appendChild(cardTitleEditor(card, node));
  } else {
    const multiBoard = boards.length > 1;
    const subs = subtasksOf(card);
    const hasSubs = subs.length > 0;
    const text = el('p', 'pr-14 leading-snug break-words'); text.textContent = card.title; node.appendChild(text);

    const actions = el('div', 'absolute right-1.5 top-1.5 flex items-center gap-0.5');
    // subtasks show/hide toggle — always visible when there are subtasks, so they're discoverable
    const tog = el('button', `relative grid h-6 w-6 place-items-center rounded-md text-ink-faint transition hover:bg-edge hover:text-ink ${(hasSubs || expanded) ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`);
    tog.innerHTML = expanded ? MINUS_SVG : PLUS_SVG;
    tog.title = expanded ? 'Hide subtasks' : (hasSubs ? `Show ${subs.length} subtask${subs.length === 1 ? '' : 's'}` : 'Add subtasks');
    tog.setAttribute('aria-label', tog.title);
    if (hasSubs && !expanded) { const badge = el('span', 'absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full'); badge.style.background = 'var(--accent)'; tog.append(badge); }
    guardDrag(tog, node);
    tog.addEventListener('click', (e) => {
      e.stopPropagation();
      if (expandedCards.has(card.id)) { expandedCards.delete(card.id); if (ui.subtaskAdding === card.id) ui.subtaskAdding = null; }
      else { expandedCards.add(card.id); if (!subtasksOf(card).length) ui.subtaskAdding = card.id; }
      render();
    });
    actions.append(tog);
    const dots = el('button', 'grid h-6 w-6 place-items-center rounded-md text-ink-faint opacity-0 transition hover:bg-edge hover:text-ink group-hover:opacity-100');
    dots.innerHTML = DOTS_SVG; dots.title = 'More actions'; dots.setAttribute('aria-label', 'More actions');
    guardDrag(dots, node);
    dots.addEventListener('click', (e) => { e.stopPropagation(); openCardMenu(card, dots, { multiBoard }); });
    actions.append(dots); node.appendChild(actions);
  }

  if (expanded) node.appendChild(subtaskSection(card, node));
  return node;
}
// Inline title editor used by both column cards and the focus zone.
function cardTitleEditor(card, cardNode, opts = {}) {
  const input = el('input', `w-full rounded-md border border-edge bg-inputbg px-2 py-1 text-ink outline-none focus:border-edge-strong ${opts.large ? 'text-center text-2xl font-extrabold tracking-tight sm:text-3xl' : 'text-sm'}`);
  input.value = card.title; input.maxLength = MAX_TITLE_LEN;
  guardDrag(input, cardNode);
  input.addEventListener('click', (e) => e.stopPropagation());
  input.addEventListener('dblclick', (e) => e.stopPropagation());
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); commitCardTitle(card.id, input.value); }
    else if (e.key === 'Escape') { ui.editingCard = null; render(); }
  });
  input.addEventListener('blur', () => { if (ui.editingCard === card.id) commitCardTitle(card.id, input.value); });
  setTimeout(() => { input.focus(); input.select(); }, 0);
  return input;
}
async function commitCardTitle(id, value) {
  value = (value || '').trim().slice(0, MAX_TITLE_LEN);
  const card = state.cards.find((c) => c.id === id);
  ui.editingCard = null;
  if (!card || !value || value === card.title) { render(); return; }
  card.title = value; render();
  try { const { cards } = await request(`/cards/${id}`, { method: 'PATCH', body: JSON.stringify({ title: value }) }); state.cards = cards; render(); }
  catch (err) { if (!handleApiError(err)) loadCards(); }
}

// ---- editable column labels (edits the board's columns) ----
function renderLabels() {
  boardCols().forEach((col) => {
    const ref = refs.columns[col.key]; if (!ref) return;
    ref.labelSlot.innerHTML = '';
    if (ui.editingLabel === col.key) {
      const input = el('input', 'w-32 rounded-md border border-edge bg-inputbg px-1.5 py-0.5 text-xs font-semibold uppercase tracking-[0.18em] text-ink outline-none focus:border-edge-strong');
      input.value = col.label; input.maxLength = MAX_LABEL_LEN;
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commitLabel(col.key, input.value); } else if (e.key === 'Escape') { ui.editingLabel = null; renderLabels(); } });
      input.addEventListener('blur', () => { if (ui.editingLabel === col.key) commitLabel(col.key, input.value); });
      ref.labelSlot.appendChild(input); input.focus(); input.select();
    } else {
      const btn = el('button', 'group/label flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.18em] text-ink-soft transition hover:text-ink');
      btn.appendChild(el('span', '', col.label));
      const pencil = el('span', 'opacity-0 transition group-hover/label:opacity-60'); pencil.innerHTML = PENCIL_SVG; btn.appendChild(pencil);
      btn.title = 'Click to rename'; btn.addEventListener('click', () => { ui.editingLabel = col.key; renderLabels(); });
      ref.labelSlot.appendChild(btn);
    }
  });
}
async function commitLabel(key, value) {
  value = (value || '').trim().slice(0, MAX_LABEL_LEN);
  const col = colByKey(key); const prev = col ? col.label : '';
  ui.editingLabel = null;
  if (col && value && value !== prev) {
    col.label = value; renderLabels();
    try { const { board, boards: bs } = await request('/boards/' + currentBoard.id, { method: 'PATCH', body: JSON.stringify({ columns: currentBoard.columns }) }); boards = bs; currentBoard = board; }
    catch (err) { handleApiError(err); }
  } else renderLabels();
}

// ------------------------------------------------------------
// Cards API
// ------------------------------------------------------------
async function loadCards() {
  if (!currentBoard) return;
  try { const { cards } = await request(`/boards/${currentBoard.id}/cards`); state.cards = cards; render(); }
  catch (err) { handleApiError(err); }
}
async function createCard(colKey, title) {
  title = (title || '').trim(); if (!title || !currentBoard) return;
  try { const { cards } = await request('/cards', { method: 'POST', body: JSON.stringify({ title, type: colKey, boardId: currentBoard.id }) }); state.cards = cards; render(); }
  catch (err) { handleApiError(err); }
}
async function moveCard(id, patch) {
  const card = state.cards.find((c) => c.id === id); if (!card) return;
  applyLocal(card, patch); render();
  try { const { cards } = await request(`/cards/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }); state.cards = cards; render(); if (patch.focused === true) renderStreak(); }
  catch (err) { if (!handleApiError(err)) loadCards(); }
}
async function archiveCard(id) {
  state.cards = state.cards.filter((c) => c.id !== id); render();
  try { const { cards } = await request(`/cards/${id}/archive`, { method: 'POST' }); state.cards = cards; render(); toast('Card archived'); }
  catch (err) { if (!handleApiError(err)) loadCards(); }
}
async function reorderColumn(colKey, ids) {
  if (!currentBoard) return;
  ids.forEach((id, i) => { const c = state.cards.find((x) => x.id === id); if (c) { c.type = colKey; c.focused = false; c.position = i; } });
  render();
  try { const { cards } = await request('/cards/order', { method: 'PUT', body: JSON.stringify({ boardId: currentBoard.id, type: colKey, ids }) }); state.cards = cards; render(); }
  catch (err) { if (!handleApiError(err)) loadCards(); }
}
function applyLocal(card, patch) {
  if (typeof patch.type === 'string') card.type = patch.type;
  if (patch.focused === true) state.cards.forEach((c) => { c.focused = c === card; });
  else if (patch.focused === false) card.focused = false;
  if (typeof patch.priority === 'number') card.priority = patch.priority;
}

// ---- send a card to another board ----
async function moveCardToBoard(id, boardId) {
  if (!state.cards.some((c) => c.id === id)) return;
  state.cards = state.cards.filter((c) => c.id !== id); render(); // optimistic: leave the current board
  try {
    const { cards } = await request(`/cards/${id}/move`, { method: 'POST', body: JSON.stringify({ boardId }) });
    state.cards = cards; render();
    const b = boards.find((x) => x.id === boardId);
    toast(b ? `Moved to ${b.name}` : 'Card moved');
  } catch (err) { if (!handleApiError(err)) loadCards(); }
}

// ------------------------------------------------------------
// Subtasks (a checklist living inside each card)
// ------------------------------------------------------------
const subtasksOf = (card) => (Array.isArray(card.subtasks) ? card.subtasks : []);
const newId = () => { try { return crypto.randomUUID(); } catch (_) { return 's-' + Date.now().toString(36) + Math.random().toString(16).slice(2, 8); } };
async function setSubtasks(id, subtasks) {
  const card = state.cards.find((c) => c.id === id); if (!card) return;
  card.subtasks = subtasks; render();
  try { const { cards } = await request(`/cards/${id}`, { method: 'PATCH', body: JSON.stringify({ subtasks }) }); state.cards = cards; render(); }
  catch (err) { if (!handleApiError(err)) loadCards(); }
}
const toggleSubtask = (card, sid) => setSubtasks(card.id, subtasksOf(card).map((s) => (s.id === sid ? { ...s, done: !s.done } : s)));
const deleteSubtask = (card, sid) => setSubtasks(card.id, subtasksOf(card).filter((s) => s.id !== sid));
function addSubtask(card, text) {
  text = (text || '').trim(); if (!text) return;
  setSubtasks(card.id, subtasksOf(card).concat({ id: newId(), text: text.slice(0, 200), done: false }));
}
function commitSubtaskText(card, sid, value) {
  value = (value || '').trim().slice(0, 200);
  ui.editingSubtask = null;
  const cur = subtasksOf(card).find((s) => s.id === sid);
  if (!cur) { render(); return; }
  if (!value) { deleteSubtask(card, sid); return; }       // cleared text removes the subtask
  if (value === cur.text) { render(); return; }
  setSubtasks(card.id, subtasksOf(card).map((s) => (s.id === sid ? { ...s, text: value } : s)));
}
// Stop a card's native drag while the pointer is busy in one of its controls (checkbox / input / button).
function guardDrag(elm, cardNode) {
  if (!cardNode) return;
  elm.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    cardNode.draggable = false;
    const restore = () => { cardNode.draggable = true; document.removeEventListener('mouseup', restore); };
    document.addEventListener('mouseup', restore);
  });
}
// Build the checklist UI shared by column cards and the focus zone. `cardNode` is the draggable card element.
function subtaskSection(card, cardNode, opts = {}) {
  const large = !!opts.large;
  const subs = subtasksOf(card);
  const hasSubs = subs.length > 0;
  const wrap = el('div', large ? 'w-full text-left' : (hasSubs ? 'mt-2.5 border-t border-edge pt-2.5' : 'mt-1.5'));
  wrap.addEventListener('dblclick', (e) => e.stopPropagation());

  if (subs.length) {
    const done = subs.filter((s) => s.done).length;
    const meta = el('div', `mb-1.5 flex items-center gap-2 ${large ? 'text-xs' : 'text-[10px]'} font-medium uppercase tracking-wider text-ink-faint`);
    const bar = el('div', 'h-1 flex-1 overflow-hidden rounded-full bg-edge');
    const fill = el('div', 'h-full rounded-full transition-all'); fill.style.width = `${Math.round((done / subs.length) * 100)}%`; fill.style.background = 'var(--accent)';
    bar.append(fill); meta.append(el('span', '', `${done}/${subs.length}`), bar);
    wrap.append(meta);

    const list = el('div', large ? 'space-y-1.5' : 'space-y-1');
    subs.forEach((s) => {
      if (ui.editingSubtask === s.id) {
        const erow = el('div', `flex items-center gap-2 ${large ? 'text-base' : 'text-[13px]'}`);
        const inp = el('input', `flex-1 rounded-md border border-edge bg-inputbg px-2 py-1 ${large ? 'text-sm' : 'text-xs'} text-ink outline-none focus:border-edge-strong`);
        inp.value = s.text; inp.maxLength = 200;
        guardDrag(inp, cardNode);
        inp.addEventListener('click', (e) => e.stopPropagation());
        inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); commitSubtaskText(card, s.id, inp.value); } else if (e.key === 'Escape') { ui.editingSubtask = null; render(); } });
        inp.addEventListener('blur', () => { if (ui.editingSubtask === s.id) commitSubtaskText(card, s.id, inp.value); });
        erow.append(inp); list.append(erow);
        setTimeout(() => { inp.focus(); inp.select(); }, 0);
        return;
      }
      const row = el('label', `group/sub flex items-start gap-2 ${large ? 'text-base' : 'text-[13px]'} cursor-pointer`);
      const box = el('input', 'mt-0.5 h-3.5 w-3.5 shrink-0 cursor-pointer'); box.type = 'checkbox'; box.checked = !!s.done; box.style.accentColor = 'var(--accent)';
      guardDrag(box, cardNode);
      box.addEventListener('click', (e) => e.stopPropagation());
      box.addEventListener('change', (e) => { e.stopPropagation(); toggleSubtask(card, s.id); });
      const txt = el('span', `flex-1 leading-snug break-words ${s.done ? 'text-ink-faint line-through' : 'text-ink-soft'}`, s.text);
      const ed = el('button', 'shrink-0 text-ink-faint opacity-0 transition hover:text-ink group-hover/sub:opacity-100'); ed.type = 'button'; ed.innerHTML = PENCIL_SVG; ed.title = 'Edit subtask';
      guardDrag(ed, cardNode);
      ed.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); ui.editingSubtask = s.id; render(); });
      const del = el('button', 'shrink-0 text-ink-faint opacity-0 transition hover:text-red-400 group-hover/sub:opacity-100'); del.type = 'button'; del.textContent = '✕'; del.title = 'Remove subtask';
      guardDrag(del, cardNode);
      del.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); deleteSubtask(card, s.id); });
      row.append(box, txt, ed, del); list.append(row);
    });
    wrap.append(list);
  }

  if (ui.subtaskAdding === card.id) {
    const input = el('input', `mt-1.5 w-full rounded-md border border-edge bg-inputbg px-2 py-1 ${large ? 'text-sm' : 'text-xs'} text-ink outline-none focus:border-edge-strong`);
    input.placeholder = 'Subtask, then Enter'; input.maxLength = 200;
    guardDrag(input, cardNode);
    input.addEventListener('click', (e) => e.stopPropagation());
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); const v = input.value; input.value = ''; addSubtask(card, v); }
      else if (e.key === 'Escape') { ui.subtaskAdding = null; render(); }
    });
    input.addEventListener('blur', () => { if (ui.subtaskAdding === card.id && !input.value.trim()) { ui.subtaskAdding = null; render(); } });
    wrap.append(input);
    setTimeout(() => input.focus(), 0);
  } else {
    const subtle = !large && !hasSubs; // on a bare card, reveal the affordance on hover only
    const add = el('button', `mt-1 inline-flex items-center gap-1 ${large ? 'text-sm' : 'text-[11px]'} font-medium text-ink-faint transition hover:text-ink ${subtle ? 'opacity-0 focus:opacity-100 group-hover:opacity-100' : ''}`);
    add.type = 'button'; add.innerHTML = PLUS_SVG; add.append(el('span', '', hasSubs ? 'Subtask' : 'Add subtask'));
    guardDrag(add, cardNode);
    add.addEventListener('click', (e) => { e.stopPropagation(); ui.subtaskAdding = card.id; render(); });
    wrap.append(add);
  }
  return wrap;
}
// Floating "move to board" menu (kept out of the column's overflow so it never clips).
let moveMenuCleanup = null;
function closeMoveMenu() { const m = document.querySelector('.tf-move-menu'); if (m) m.remove(); if (moveMenuCleanup) { moveMenuCleanup(); moveMenuCleanup = null; } }
function openMoveMenu(card, anchorEl) {
  closeMoveMenu();
  const others = boards.filter((b) => !currentBoard || b.id !== currentBoard.id);
  if (!others.length) { toast('No other board to move to'); return; }
  const menu = el('div', 'tf-move-menu fixed z-50 max-h-72 w-56 overflow-y-auto overflow-x-hidden rounded-xl border border-edge bg-panel py-1 text-sm themed-shadow clean-scroll');
  menu.append(el('div', 'px-3 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-ink-faint', 'Move to board'));
  others.forEach((b) => {
    const it = el('button', 'flex w-full items-center gap-2 px-3 py-2 text-left text-ink-soft transition hover:bg-edge hover:text-ink');
    it.append(el('span', 'text-base leading-none', b.icon), el('span', 'flex-1 truncate', b.name));
    it.addEventListener('click', (e) => { e.stopPropagation(); closeMoveMenu(); moveCardToBoard(card.id, b.id); });
    menu.append(it);
  });
  document.body.appendChild(menu);
  const r = anchorEl.getBoundingClientRect(), mw = 224;
  let left = Math.max(8, Math.min(r.right - mw, window.innerWidth - mw - 8));
  let top = r.bottom + 6;
  if (top + menu.offsetHeight > window.innerHeight - 8) top = Math.max(8, r.top - menu.offsetHeight - 6);
  menu.style.left = left + 'px'; menu.style.top = top + 'px';
  const away = (e) => { if (!menu.contains(e.target)) closeMoveMenu(); };
  const onKey = (e) => { if (e.key === 'Escape') closeMoveMenu(); };
  const onScroll = () => closeMoveMenu();
  moveMenuCleanup = () => { document.removeEventListener('mousedown', away, true); document.removeEventListener('keydown', onKey, true); window.removeEventListener('scroll', onScroll, true); };
  setTimeout(() => { document.addEventListener('mousedown', away, true); document.addEventListener('keydown', onKey, true); window.addEventListener('scroll', onScroll, true); }, 0);
}

let cardMenuCleanup = null;
function closeCardMenu() { const m = document.querySelector('.tf-card-menu'); if (m) m.remove(); if (cardMenuCleanup) { cardMenuCleanup(); cardMenuCleanup = null; } }
function openCardMenu(card, anchorEl, opts = {}) {
  closeCardMenu();
  const menu = el('div', 'tf-card-menu min-w-[160px] rounded-xl border border-edge bg-panel py-1 shadow-lg');
  menu.style.cssText = 'position:fixed;z-index:50';
  const addItem = (svgStr, label, extraCls, onClick) => {
    const btn = el('button', `flex w-full items-center gap-2.5 px-3 py-2 text-sm transition hover:bg-edge ${extraCls || 'text-ink-soft hover:text-ink'}`);
    const icon = document.createElement('span'); icon.innerHTML = svgStr; btn.appendChild(icon);
    btn.appendChild(document.createTextNode(label));
    btn.addEventListener('click', (e) => { e.stopPropagation(); closeCardMenu(); onClick(); });
    menu.appendChild(btn);
  };
  const pRow = el('div', 'flex items-center gap-1.5 border-b border-edge px-3 pb-2 pt-1.5');
  pRow.append(el('span', 'mr-auto text-[10px] font-semibold uppercase tracking-wider text-ink-faint', 'Priority'));
  [{label:'None',color:null},{label:'Low',color:'#60a5fa'},{label:'Medium',color:'#fbbf24'},{label:'High',color:'#f87171'}].forEach(({label,color},p) => {
    const b = document.createElement('button');
    b.className = 'h-4 w-4 shrink-0 rounded-full border-2 transition hover:scale-110 ' + (card.priority === p ? 'scale-125' : 'opacity-40 hover:opacity-100');
    b.title = label;
    if (color) { b.style.background = color; b.style.borderColor = color; } else { b.style.background = 'transparent'; b.style.borderColor = 'var(--ink-faint)'; }
    b.addEventListener('click', (e) => { e.stopPropagation(); closeCardMenu(); moveCard(card.id, { priority: p }); });
    pRow.appendChild(b);
  });
  menu.appendChild(pRow);
  addItem(PENCIL_SVG, 'Edit text', '', () => { ui.editingCard = card.id; render(); });
  if (opts.multiBoard) addItem(MOVE_SVG, 'Move to board', '', () => openMoveMenu(card, anchorEl));
  addItem(TRASH_SVG, 'Archive', 'text-red-400 hover:text-red-300', () => archiveCard(card.id));
  document.body.appendChild(menu);
  const r = anchorEl.getBoundingClientRect(), mw = 160;
  let left = Math.max(8, Math.min(r.right - mw, window.innerWidth - mw - 8));
  let top = r.bottom + 4;
  if (top + menu.offsetHeight > window.innerHeight - 8) top = Math.max(8, r.top - menu.offsetHeight - 4);
  menu.style.left = left + 'px'; menu.style.top = top + 'px';
  const away = (e) => { if (!menu.contains(e.target)) closeCardMenu(); };
  const onKey = (e) => { if (e.key === 'Escape') closeCardMenu(); };
  const onScroll = () => closeCardMenu();
  cardMenuCleanup = () => { document.removeEventListener('mousedown', away, true); document.removeEventListener('keydown', onKey, true); window.removeEventListener('scroll', onScroll, true); };
  setTimeout(() => { document.addEventListener('mousedown', away, true); document.addEventListener('keydown', onKey, true); window.addEventListener('scroll', onScroll, true); }, 0);
}

// ------------------------------------------------------------
// Composers + drag & drop
// ------------------------------------------------------------
function toggleComposer(key) { ui.composer = ui.composer === key ? null : key; renderComposers(); }
function renderComposers() {
  boardCols().forEach((col) => {
    const ref = refs.columns[col.key]; if (!ref) return;
    const open = ui.composer === col.key;
    ref.addBtn.classList.toggle('rotate-45', open);
    ref.composer.classList.toggle('hidden', !open);
    ref.composer.innerHTML = '';
    if (!open) return;
    const input = el('input', 'w-full rounded-lg border border-edge bg-inputbg px-3 py-2 text-sm text-ink placeholder-ink-faint outline-none transition focus:border-edge-strong');
    input.type = 'text'; input.maxLength = MAX_TITLE_LEN; input.placeholder = col.hint || `Add to ${col.label}`;
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); const v = input.value; input.value = ''; createCard(col.key, v).then(() => input.focus()); } else if (e.key === 'Escape') { ui.composer = null; renderComposers(); } });
    input.addEventListener('blur', () => { if (!input.value.trim()) { ui.composer = null; renderComposers(); } });
    ref.composer.appendChild(input); input.focus();
  });
}
function attachDropzone(target, patchFactory) {
  target.addEventListener('dragover', (e) => { if (!patchFactory()) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; target.classList.add('drag-over'); });
  target.addEventListener('dragleave', (e) => { if (!target.contains(e.relatedTarget)) target.classList.remove('drag-over'); });
  target.addEventListener('drop', (e) => { const patch = patchFactory(); if (!patch) return; e.preventDefault(); target.classList.remove('drag-over'); const id = e.dataTransfer.getData('text/plain') || ui.draggingId; if (id) moveCard(id, patch); });
}
function getDragAfterElement(container, y) {
  const els = [...container.querySelectorAll('[data-card-id]:not(.dragging)')];
  let closest = { offset: Number.NEGATIVE_INFINITY, element: null };
  for (const child of els) { const box = child.getBoundingClientRect(); const offset = y - box.top - box.height / 2; if (offset < 0 && offset > closest.offset) closest = { offset, element: child }; }
  return closest.element;
}
function attachColumnSortable(body, key) {
  body.addEventListener('dragover', (e) => {
    e.preventDefault(); e.dataTransfer.dropEffect = 'move'; body.classList.add('drag-over');
    const dragging = document.querySelector('.dragging'); if (!dragging) return;
    const after = getDragAfterElement(body, e.clientY);
    if (after == null) body.appendChild(dragging); else body.insertBefore(dragging, after);
  });
  body.addEventListener('dragleave', (e) => { if (!body.contains(e.relatedTarget)) body.classList.remove('drag-over'); });
  body.addEventListener('drop', (e) => { e.preventDefault(); body.classList.remove('drag-over'); const ids = [...body.querySelectorAll('[data-card-id]')].map((n) => n.dataset.cardId); if (ids.length) reorderColumn(key, ids); });
}
function initDragTracking() {
  document.addEventListener('dragstart', (e) => { const node = e.target.closest && e.target.closest('[data-card-id]'); if (!node) return; ui.draggingId = node.dataset.cardId; node.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', ui.draggingId); });
  document.addEventListener('dragend', (e) => { const node = e.target.closest && e.target.closest('[data-card-id]'); if (node) node.classList.remove('dragging'); ui.draggingId = null; $$('.drag-over').forEach((n) => n.classList.remove('drag-over')); if (currentUser && currentBoard) render(); });
}

// ------------------------------------------------------------
// Misc
// ------------------------------------------------------------
let toastTimer;
function toast(message) { const t = $('#toast'); t.textContent = message; t.classList.remove('opacity-0', 'translate-y-2'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('opacity-0', 'translate-y-2'), TOAST_MS); }
function setDate() { const node = $('#today'); if (!node) return; const tz = (currentUser && currentUser.timezone) || undefined; node.textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', timeZone: tz }); }
function startPolling() { if (POLL_MS && !pollTimer) pollTimer = setInterval(poll, POLL_MS); }
function stopPolling() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }
async function poll() {
  if (!currentUser || !currentBoard || ui.draggingId || ui.editingLabel || ui.editingCard || ui.editingSubtask || ui.subtaskAdding) return;
  try { const { cards } = await request(`/boards/${currentBoard.id}/cards`); if (JSON.stringify(cards) !== JSON.stringify(state.cards)) { state.cards = cards; render(); } }
  catch (err) { if (err.status === 401) forceReauth(); }
}

// ------------------------------------------------------------
// A little something for the curious ✦
// ------------------------------------------------------------
function celebrate() {
  const colors = ['#fbbf24', '#f472b6', '#34d399', '#60a5fa', '#a78bfa', '#fb7185'];
  for (let i = 0; i < 90; i++) {
    const p = el('div');
    const size = 6 + Math.random() * 9;
    p.style.cssText = `position:fixed;top:-24px;left:${Math.random() * 100}vw;width:${size}px;height:${size}px;background:${colors[i % colors.length]};border-radius:${Math.random() < 0.5 ? '2px' : '50%'};z-index:9999;pointer-events:none`;
    document.body.appendChild(p);
    const dur = 1600 + Math.random() * 1600, drift = (Math.random() - 0.5) * 280;
    p.animate(
      [{ transform: 'translate(0,0) rotate(0deg)', opacity: 1 },
       { transform: `translate(${drift}px, ${window.innerHeight + 80}px) rotate(${Math.random() * 720 - 360}deg)`, opacity: 0.9 }],
      { duration: dur, easing: 'cubic-bezier(.21,.6,.35,1)' }
    ).onfinish = () => p.remove();
  }
  toast('✦  One focus. Zero noise.  — Jon Bassett');
}
function initEasterEgg() {
  // A quiet signature for anyone who opens the console.
  try {
    console.log("%c  Today's Focus  ", 'background:#fbbf24;color:#09090b;font-weight:800;font-size:15px;padding:6px 12px;border-radius:6px');
    console.log('%cOne focus. Zero noise.\n%cDesigned & built by Jon Bassett', 'color:#a1a1aa;font-size:12px', 'color:#71717a;font-size:12px');
    console.log('%c↑ ↑ ↓ ↓ ← → ← → B A', 'color:#52525b;font-size:11px;letter-spacing:3px');
  } catch (_) {}
  // The Konami code → a small celebration (ignored while typing).
  const seq = ['arrowup', 'arrowup', 'arrowdown', 'arrowdown', 'arrowleft', 'arrowright', 'arrowleft', 'arrowright', 'b', 'a'];
  let i = 0;
  document.addEventListener('keydown', (e) => {
    const key = (e.key || '').toLowerCase();
    i = (key === seq[i]) ? i + 1 : (key === seq[0] ? 1 : 0);
    if (i === seq.length) { i = 0; celebrate(); }
  });
}

// ------------------------------------------------------------
// Boot
// ------------------------------------------------------------
function init() {
  settings.theme = (() => { try { return localStorage.getItem('tf-theme') || 'dark'; } catch (_) { return 'dark'; } })();
  attachDropzone($('#focus-zone'), () => (isSpotlight() ? null : { focused: true }));
  initDragTracking();
  renderThemeToggle();
  $('#auth-form').addEventListener('submit', submitAuth);
  $('#auth-toggle').addEventListener('click', () => setAuthMode(authMode === 'login' ? 'register' : 'login'));
  $('#auth-forgot').addEventListener('click', () => setAuthMode('recover'));
  $$('.modal-backdrop').forEach((m) => m.addEventListener('click', (e) => { if (e.target === m) { m.classList.add('hidden'); m.classList.remove('flex'); } }));
  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  initEasterEgg();
  bootstrap();
}
document.addEventListener('DOMContentLoaded', init);
