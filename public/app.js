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
let allCards = [];                     // every active card across boards (smart views + sidebar counts)
let currentView = { kind: 'board' };   // 'board' | 'today' | 'upcoming' | 'all' | 'tag' | 'search' | ...
let activeTag = null;
let searchQuery = '';
let listSort = (() => { try { return localStorage.getItem('tf-sort') || 'smart'; } catch (_) { return 'smart'; } })();
let savedFilters = [];                   // user's saved smart-list filters
let activeFilter = null;                 // the filter object currently applied (view kind 'filter')
let habits = [];                         // habit definitions
let habitCheckins = new Set();           // "habitId|YYYY-MM-DD" for each completed day
let focusViewOn = (() => { try { return localStorage.getItem('tf-focusview') !== '0'; } catch (_) { return true; } })(); // Focus Zone shown by default
let houseData = null;                    // House Plan bridge tasks — null = bridge not enabled for this account
let houseBase = '';                      // public House Plan URL for deep links
let calCursor = null;                   // first-of-month Date shown in the Calendar view
let journalDay = null;                   // YYYY-MM-DD open in the Journal
let journalCursor = null;                // month shown in the Journal mini-calendar
let journalDays = new Set();             // days that have an entry (for calendar dots)
let journalEntries = [];                 // [{day, mood, snippet}] for the entries list
let journalShowAll = false;              // entries list: show all vs last 10
let journalCurMood = '';                 // mood emoji for the open day
let journalSaveTimer = null;
let pushState = { supported: false, enabled: false, publicKey: '' };
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
  await loadActive();
  await loadFilters();
  await loadHabits();
  await loadHouse();
  renderQuickAdd();
  initPush();
  restoreView();
  startPolling();
}
async function loadHouse(fresh = false) {
  try {
    const { tasks, baseUrl } = await request('/house/tasks' + (fresh ? '?fresh' : ''));
    houseData = tasks; houseBase = baseUrl || '';
  } catch (_) { houseData = null; } // 404 = bridge not enabled for this account
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
  ['#account-modal', '#admin-modal', '#history-modal', '#archive-modal', '#boards-modal', '#task-modal', '#filter-modal', '#pomodoro-modal', '#habit-modal', '#help-modal'].forEach(closeModal);
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
  if (currentView.kind === 'board' && currentBoard && id === currentBoard.id) return;
  openBoard(id);
}
// Mark a board as just-used so it sorts to the top of the dropdown (Today's Focus stays pinned).
async function touchBoard(id) {
  try { const { boards: bs } = await request('/boards/' + id + '/touch', { method: 'POST' }); boards = bs; renderBoardSwitcher(); }
  catch (_) {}
}
// The old top-left dropdown is now the sidebar; keep this name as a thin alias
// so existing call-sites (board create/edit/delete, touch) refresh the sidebar.
function renderBoardSwitcher() { renderSidebar(); }

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
      closeModal('#boards-modal'); buildBoard(); setView({ kind: 'board', boardId: currentBoard.id }); loadCards();
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
        closeModal('#boards-modal'); buildBoard(); setView({ kind: 'board', boardId: currentBoard.id }); loadCards(); toast('Board deleted');
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
  const btn = el('button', 'flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-sm font-medium text-ink-soft transition hover:bg-edge hover:text-ink');
  const dot = el('span', 'grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold'); dot.style.background = 'var(--accent)'; dot.style.color = 'var(--bg)'; dot.textContent = (currentUser.username[0] || '?').toUpperCase();
  btn.append(dot, el('span', 'flex-1 truncate text-left', currentUser.username));
  const chev = el('span', 'shrink-0 text-ink-faint'); chev.innerHTML = CHEV_SVG; chev.style.transform = 'rotate(180deg)'; btn.append(chev);
  const menu = el('div', 'absolute bottom-full left-0 z-30 mb-2 hidden w-full min-w-[11rem] overflow-hidden rounded-xl border border-edge bg-panel py-1 text-sm themed-shadow');
  const item = (label, onClick, danger) => { const b = el('button', `flex w-full items-center px-3 py-2 text-left transition hover:bg-edge ${danger ? 'text-red-400' : 'text-ink'}`, label); b.addEventListener('click', () => { menu.classList.add('hidden'); onClick(); }); return b; };
  const themeSection = el('div', 'flex md:hidden items-center justify-center gap-1 border-b border-edge px-2 py-2');
  THEMES.forEach((t) => { const active = settings.theme === t.id; const b = el('button', `grid h-7 w-7 place-items-center rounded-full text-xs transition ${active ? 'btn-accent' : 'text-ink-soft hover:text-ink'}`); b.type = 'button'; b.title = `${t.label} theme`; b.innerHTML = ICONS[t.id] || ''; b.addEventListener('click', () => { setTheme(t.id); renderUserMenu(); }); themeSection.append(b); });
  menu.append(themeSection);
  if (currentUser.role === 'admin') menu.append(el('div', 'px-3 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-ink-faint', 'Admin'), item('Manage users', openAdminModal));
  if (shopConfig && shopConfig.enabled && shopConfig.url) menu.append(item(shopConfig.label || 'Get the 3D-printed version', () => window.open(shopConfig.url, '_blank', 'noopener')));
  if (pushState.supported) menu.append(item(pushState.enabled ? '🔔  Reminders on ✓' : '🔔  Enable reminders', pushState.enabled ? disableReminders : enableReminders));
  menu.append(item('Focus history', openHistoryModal), item('Completed & archive', openArchiveModal), item('Help & tips', openHelpModal), item('Account & API token', openAccountModal), item('Log out', logout, true));
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
  // Equal columns that fill the same set width as the Focus Zone above, and stack below lg (so columns never get too narrow to read).
  wrap.className = `mx-auto grid w-full max-w-6xl grid-cols-1 gap-4 lg:min-h-0 lg:flex-[7] lg:grid-cols-${n}`;
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
    const body = el('div', 'clean-scroll flex-1 space-y-2 overflow-y-auto p-3 max-h-[55vh] lg:max-h-none');
    body.dataset.dropzone = 'column'; body.dataset.type = col.key;
    attachColumnSortable(body, col.key);
    section.append(header, composer, body); wrap.appendChild(section);
    refs.columns[col.key] = { cards: body, composer, count, addBtn, labelSlot };
  });
  renderLabels();
}
function render() { renderFocus(); boardCols().forEach(renderColumn); if (currentView.kind === 'board') $('#view-count').textContent = state.cards.length ? String(state.cards.length) : ''; }
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
  node.draggable = !editing; node.dataset.cardId = card.id; node.title = 'Drag to reorder/move · double-click to focus · right-click for actions';
  node.addEventListener('dblclick', () => { if (isSpotlight() || ui.editingCard === card.id) return; moveCard(card.id, { focused: true }); });
  node.addEventListener('contextmenu', (e) => { if (ui.editingCard === card.id) return; e.preventDefault(); openCardMenu(card, node, { multiBoard: boards.length > 1, x: e.clientX, y: e.clientY }); });
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

    // due / tags / recur meta
    if (card.dueAt || (card.tags && card.tags.length) || card.recur || card.duration || card.note) {
      const meta = el('div', 'mt-1.5 flex flex-wrap items-center gap-1.5 pr-10');
      if (card.dueAt) { const p = el('span', 'due-pill ' + dueClass(card.dueAt)); p.innerHTML = CLOCK_SVG; p.append(el('span', '', formatDue(card.dueAt))); meta.append(p); }
      (card.tags || []).forEach((t) => meta.append(el('span', 'tag-chip', '#' + t)));
      if (card.recur) meta.append(el('span', 'tag-chip', '🔁'));
      if (card.duration) meta.append(el('span', 'tag-chip', '⏱ ' + fmtDur(card.duration)));
      if (card.note) { const nn = el('span', 'tag-chip', '📝'); nn.title = 'Has notes'; meta.append(nn); }
      node.appendChild(meta);
    }

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
  // Inline-edit on the board (where the card is live); a modal everywhere else.
  addItem(PENCIL_SVG, 'Edit text', '', () => { if (currentView.kind === 'board' && state.cards.some((c) => c.id === card.id)) { ui.editingCard = card.id; render(); } else openTaskModal(card); });
  addItem(CLOCK_SVG, 'Details · due · tags', '', () => openTaskModal(card));
  if (opts.multiBoard) addItem(MOVE_SVG, 'Move to board', '', () => openMoveMenu(card, anchorEl));
  addItem(TRASH_SVG, 'Archive', 'text-red-400 hover:text-red-300', () => archiveCard(card.id));
  document.body.appendChild(menu);
  const mw = 160;
  let left, top;
  if (opts.x != null && opts.y != null) { // right-click: open at the cursor
    left = Math.max(8, Math.min(opts.x, window.innerWidth - mw - 8));
    top = (opts.y + menu.offsetHeight > window.innerHeight - 8) ? Math.max(8, opts.y - menu.offsetHeight) : opts.y;
  } else {
    const r = anchorEl.getBoundingClientRect();
    left = Math.max(8, Math.min(r.right - mw, window.innerWidth - mw - 8));
    top = r.bottom + 4;
    if (top + menu.offsetHeight > window.innerHeight - 8) top = Math.max(8, r.top - menu.offsetHeight - 4);
  }
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

// ============================================================
// TICKTICK-STYLE LAYER — smart views, sidebar, due dates, tags,
// quick-add parsing, task detail editor, and push reminders.
// ============================================================
const CLOCK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3 w-3"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
const PRIORITY_HEX = ['', '#60a5fa', '#fbbf24', '#f87171'];
const PRIORITY_LABEL = ['None', 'Low', 'Medium', 'High'];
const priorityColor = (p) => PRIORITY_HEX[p] || null;

// ---- date helpers (device-local) ----
function dayStart(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
const todayStart = () => dayStart(new Date());
const hasTimeOf = (iso) => { const d = new Date(iso); return !Number.isNaN(d.getTime()) && !(d.getHours() === 0 && d.getMinutes() === 0); };
function formatDue(iso) {
  const d = new Date(iso); if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const days = Math.round((dayStart(d) - todayStart()) / 86400000);
  const time = hasTimeOf(iso) ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
  let day;
  if (days === 0) day = 'Today';
  else if (days === 1) day = 'Tomorrow';
  else if (days === -1) day = 'Yesterday';
  else if (days > 1 && days < 7) day = d.toLocaleDateString([], { weekday: 'short' });
  else day = d.toLocaleDateString([], { day: 'numeric', month: 'short', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
  return time ? `${day} ${time}` : day;
}
function dueClass(iso) {
  if (!iso) return '';
  const d = new Date(iso); if (Number.isNaN(d.getTime())) return '';
  const t = todayStart().getTime(), dd = dayStart(d).getTime();
  if (dd < t) return 'overdue';
  if (dd > t) return '';
  return (hasTimeOf(iso) && d.getTime() < Date.now()) ? 'overdue' : 'today';
}
const dueSortKey = (c) => (c.dueAt ? new Date(c.dueAt).getTime() : Number.MAX_SAFE_INTEGER);
function fmtDur(m) { m = Math.round(m || 0); if (!m) return ''; const h = Math.floor(m / 60), mm = m % 60; return h ? (mm ? `${h}h ${mm}m` : `${h}h`) : `${mm}m`; }
function sorterFor(mode) {
  const byCreated = (a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0);
  switch (mode) {
    case 'due': return (a, b) => (dueSortKey(a) - dueSortKey(b)) || byCreated(a, b);
    case 'priority': return (a, b) => ((b.priority || 0) - (a.priority || 0)) || (dueSortKey(a) - dueSortKey(b));
    case 'created': return byCreated;
    case 'alpha': return (a, b) => a.title.localeCompare(b.title);
    default: return (a, b) => (dueSortKey(a) - dueSortKey(b)) || ((b.priority || 0) - (a.priority || 0)) || byCreated(a, b);
  }
}

// ---- quick-add natural-language parser ----
function parseQuickAdd(raw) {
  let text = ' ' + String(raw || '').trim() + ' ';
  const tags = [];
  text = text.replace(/\s#([\p{L}0-9_-]{1,30})/gu, (_, t) => { tags.push(t.toLowerCase()); return ' '; });
  let priority = 0;
  const pm = text.match(/\s(!{1,3})(?=\s)/);
  if (pm) { priority = Math.min(3, pm[1].length); text = text.replace(pm[0], ' '); }
  let recur = '';
  const rec = text.match(/\severy\s+(day|weekday|week|month|year|2\s*weeks|fortnight)\b/i);
  if (rec) { recur = { day: 'daily', weekday: 'weekday', week: 'weekly', month: 'monthly', year: 'yearly', '2weeks': 'biweekly', fortnight: 'biweekly' }[rec[1].toLowerCase().replace(/\s+/g, '')] || ''; text = text.replace(rec[0], ' '); }
  const nd = parseNaturalDate(text);
  text = nd.cleaned;
  const title = text.replace(/\s+/g, ' ').trim();
  return { title, dueAt: nd.dueAt, tags, priority, recur };
}
function parseNaturalDate(text) {
  let cleaned = text;
  const now = new Date();
  let base = null;
  const strip = (re) => { cleaned = cleaned.replace(re, ' '); };
  if (/\btoday\b/i.test(text)) { base = todayStart(); strip(/\btoday\b/i); }
  else if (/\btonight\b/i.test(text)) { base = todayStart(); strip(/\btonight\b/i); }
  else if (/\b(tomorrow|tmr|tmrw)\b/i.test(text)) { const d = todayStart(); d.setDate(d.getDate() + 1); base = d; strip(/\b(tomorrow|tmr|tmrw)\b/i); }
  else if (/\bnext week\b/i.test(text)) { const d = todayStart(); d.setDate(d.getDate() + 7); base = d; strip(/\bnext week\b/i); }
  if (!base) {
    const wd = text.match(/\b(next\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)\b/i);
    if (wd) {
      const map = { sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6, sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
      const target = map[wd[2].toLowerCase()];
      const d = todayStart(); let add = (target - d.getDay() + 7) % 7; if (add === 0) add = 7;
      d.setDate(d.getDate() + add); base = d; cleaned = cleaned.replace(wd[0], ' ');
    }
  }
  let hh = null, mm = 0;
  const t = text.match(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i) || text.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\b/i);
  if (t) {
    hh = parseInt(t[1], 10); mm = t[2] ? parseInt(t[2], 10) : 0;
    const ap = (t[3] || '').toLowerCase();
    if (ap === 'pm' && hh < 12) hh += 12; if (ap === 'am' && hh === 12) hh = 0;
    if (hh >= 0 && hh < 24 && mm < 60) cleaned = cleaned.replace(t[0], ' '); else hh = null;
  }
  if (hh === null && /\bnoon\b/i.test(text)) { hh = 12; strip(/\bnoon\b/i); }
  if (hh === null && /\btonight\b/i.test(text)) hh = 20;
  if (base === null && hh === null) return { dueAt: null, cleaned };
  const d = base ? new Date(base) : todayStart();
  if (hh !== null) d.setHours(hh, mm, 0, 0);
  if (base === null && hh !== null && d.getTime() < Date.now()) d.setDate(d.getDate() + 1);
  return { dueAt: d.toISOString(), cleaned };
}

// ---- active-card cache (all boards) ----
async function loadActive() { try { const { cards } = await request('/active'); allCards = cards; } catch (err) { handleApiError(err); } }
async function loadFilters() { try { const { filters } = await request('/filters'); savedFilters = filters || []; } catch (_) { savedFilters = []; } }

// ---- view routing ----
function openBoard(id) {
  const b = boards.find((x) => x.id === id) || currentBoard || boards[0];
  if (!b) return;
  currentBoard = b; try { localStorage.setItem('tf-board', b.id); } catch (_) {}
  ui.composer = null; ui.editingLabel = null; ui.editingCard = null; ui.editingSubtask = null; ui.subtaskAdding = null;
  buildBoard();
  setView({ kind: 'board', boardId: b.id });
  loadCards();
  touchBoard(b.id);
}
function setView(view) {
  currentView = view;
  try { if (view.kind !== 'search') localStorage.setItem('tf-view', JSON.stringify(view)); } catch (_) {}
  closeSidebarDrawer();
  applyViewLayout();
  renderHeaderForView();
  renderSidebar();
  if (view.kind === 'board') render(); else renderListView();
}
function restoreView() {
  let saved = null; try { saved = JSON.parse(localStorage.getItem('tf-view') || 'null'); } catch (_) {}
  if (saved && saved.kind && saved.kind !== 'board') {
    if (saved.kind === 'tag') activeTag = saved.tag;
    if (saved.kind === 'filter') { const f = savedFilters.find((x) => x.id === saved.id); if (!f) { openBoard(currentBoard ? currentBoard.id : (boards[0] && boards[0].id)); return; } activeFilter = f; }
    setView(saved); return;
  }
  openBoard(currentBoard ? currentBoard.id : (boards[0] && boards[0].id));
}
function applyViewLayout() {
  const board = currentView.kind === 'board';
  $('#list-view').classList.toggle('hidden', board);
  $('#columns').classList.toggle('hidden', !board);
  const showFocus = board && (isSpotlight() || focusViewOn);
  $('#focus-zone').classList.toggle('hidden', !showFocus);
  const ft = $('#focus-toggle');
  ft.classList.toggle('hidden', !board || isSpotlight());
  ft.classList.toggle('btn-accent', showFocus && !isSpotlight());
}
function viewMeta() {
  switch (currentView.kind) {
    case 'focuses': return { icon: '🎯', title: 'In Focus' };
    case 'today': return { icon: '📅', title: 'Today' };
    case 'upcoming': return { icon: '🗓️', title: 'Next 7 days' };
    case 'calendar': return { icon: '📆', title: 'Calendar' };
    case 'timeline': return { icon: '📊', title: 'Timeline' };
    case 'matrix': return { icon: '🔲', title: 'Priority Matrix' };
    case 'habits': return { icon: '🌱', title: 'Habits' };
    case 'house': return { icon: '🏠', title: 'House' };
    case 'journal': return { icon: '📓', title: 'Journal' };
    case 'all': return { icon: '🗂️', title: 'All tasks' };
    case 'tag': return { icon: '#', title: activeTag || '' };
    case 'search': return { icon: '🔍', title: searchQuery ? `“${searchQuery}”` : 'Search' };
    case 'filter': return { icon: '⚡', title: (activeFilter && activeFilter.name) || 'Filter' };
    default: return { icon: currentBoard ? currentBoard.icon : '🎯', title: currentBoard ? currentBoard.name : "Today's Focus" };
  }
}
// The current focus of a board: its focused card, or the daily spotlight pick for "of the day" boards.
function boardFocus(bd) {
  const cards = allCards.filter((c) => c.boardId === bd.id);
  return bd.spotlight ? spotlightPick(cards) : cards.find((c) => c.focused);
}
function renderHeaderForView() { const m = viewMeta(); $('#view-icon').textContent = m.icon; $('#view-title').textContent = m.title; }
function renderCurrentView() { if (currentView.kind === 'board') render(); else renderListView(); }

// ---- sidebar ----
function renderSidebar() { renderSmartViews(); renderProjects(); renderFilters(); renderTags(); }
function renderFilters() {
  const nav = $('#sidebar-filters'); if (!nav) return; nav.innerHTML = '';
  if (!savedFilters.length) { nav.append(el('div', 'px-2 py-1 text-[11px] text-ink-faint', 'No filters yet — tap +')); return; }
  savedFilters.forEach((f) => {
    const row = el('div', 'group/f flex items-center');
    const active = currentView.kind === 'filter' && activeFilter && activeFilter.id === f.id;
    const b = el('button', 'nav-item flex-1' + (active ? ' active' : ''));
    b.append(el('span', 'text-base leading-none', '⚡'), el('span', 'flex-1 truncate', f.name));
    const cnt = filterCards(f).length; if (cnt) b.append(el('span', 'nav-count', String(cnt)));
    b.addEventListener('click', () => { activeFilter = f; setView({ kind: 'filter', id: f.id }); });
    const edit = el('button', 'ml-1 hidden shrink-0 rounded p-1 text-ink-faint transition hover:text-ink group-hover/f:block', '✎');
    edit.title = 'Edit filter'; edit.addEventListener('click', (e) => { e.stopPropagation(); openFilterEditor(f); });
    row.append(b, edit); nav.append(row);
  });
}
function openFilterEditor(filter) {
  const modal = $('#filter-modal'); modal.innerHTML = '';
  const panel = modalShell(filter ? 'Edit filter' : 'New filter', () => closeModal('#filter-modal')); panel.classList.add('max-w-md');
  const draft = filter ? { ...filter, tags: (filter.tags || []).slice(), boards: (filter.boards || []).slice() } : { id: null, name: '', tags: [], priority: 0, due: 'any', boards: [] };

  const name = el('input', 'field'); name.placeholder = 'Filter name'; name.value = draft.name;
  name.addEventListener('input', () => { draft.name = name.value; });
  const tagsWrap = el('div', 'mt-3'); tagsWrap.append(el('label', 'mb-1 block text-xs text-ink-soft', 'Tags — all must match'));
  const tagIn = el('input', 'field'); tagIn.value = draft.tags.join(' '); tagIn.placeholder = 'merlin work';
  tagIn.addEventListener('input', () => { draft.tags = tagIn.value.split(/[\s,]+/).map((t) => t.replace(/^#/, '').toLowerCase()).filter(Boolean); });
  tagsWrap.append(tagIn);
  const prioWrap = el('div', 'mt-3'); prioWrap.append(el('label', 'mb-1 block text-xs text-ink-soft', 'Minimum priority'));
  const prioSel = el('select', 'field'); [['0', 'Any'], ['1', 'Low or higher'], ['2', 'Medium or higher'], ['3', 'High only']].forEach(([v, l]) => { const o = el('option', '', l); o.value = v; prioSel.append(o); }); prioSel.value = String(draft.priority);
  prioSel.addEventListener('change', () => { draft.priority = parseInt(prioSel.value, 10); }); prioWrap.append(prioSel);
  const dueWrap = el('div', 'mt-3'); dueWrap.append(el('label', 'mb-1 block text-xs text-ink-soft', 'Due'));
  const dueSel = el('select', 'field'); [['any', 'Any time'], ['overdue', 'Overdue'], ['today', 'Today or earlier'], ['week', 'Within 7 days']].forEach(([v, l]) => { const o = el('option', '', l); o.value = v; dueSel.append(o); }); dueSel.value = draft.due;
  dueSel.addEventListener('change', () => { draft.due = dueSel.value; }); dueWrap.append(dueSel);
  const boardsWrap = el('div', 'mt-3'); boardsWrap.append(el('label', 'mb-1 block text-xs text-ink-soft', 'Projects — any of (blank = all)'));
  const boardsBox = el('div', 'clean-scroll max-h-40 space-y-1 overflow-y-auto rounded-lg border border-edge p-2');
  boards.forEach((bd) => {
    const row = el('label', 'flex cursor-pointer items-center gap-2 text-sm text-ink');
    const cb = el('input', ''); cb.type = 'checkbox'; cb.checked = draft.boards.includes(bd.id);
    cb.addEventListener('change', () => { if (cb.checked) { if (!draft.boards.includes(bd.id)) draft.boards.push(bd.id); } else draft.boards = draft.boards.filter((x) => x !== bd.id); });
    row.append(cb, el('span', '', bd.icon + ' ' + bd.name)); boardsBox.append(row);
  });
  boardsWrap.append(boardsBox);
  const err = el('p', 'mt-2 hidden text-xs text-red-400');
  const save = el('button', 'btn-accent mt-4 w-full rounded-lg px-4 py-2 text-sm font-semibold transition hover:opacity-90', 'Save filter');
  save.addEventListener('click', async () => {
    if (!draft.name.trim()) { err.textContent = 'Give the filter a name.'; err.classList.remove('hidden'); return; }
    const f = { id: draft.id || newId(), name: draft.name.trim(), tags: draft.tags, priority: draft.priority, due: draft.due, boards: draft.boards };
    const next = draft.id ? savedFilters.map((x) => (x.id === draft.id ? f : x)) : savedFilters.concat(f);
    try { const { filters } = await request('/filters', { method: 'PUT', body: JSON.stringify({ filters: next }) }); savedFilters = filters; closeModal('#filter-modal'); activeFilter = savedFilters.find((x) => x.id === f.id) || f; setView({ kind: 'filter', id: f.id }); toast('Filter saved'); }
    catch (e) { err.textContent = e.message; err.classList.remove('hidden'); }
  });
  panel.append(el('label', 'mb-1 block text-xs text-ink-soft', 'Name'), name, tagsWrap, prioWrap, dueWrap, boardsWrap, err, save);
  if (filter) {
    const del = el('button', 'mt-2 w-full rounded-lg border border-edge px-4 py-2 text-sm font-medium text-red-400 transition hover:bg-edge', 'Delete filter');
    del.addEventListener('click', async () => {
      const next = savedFilters.filter((x) => x.id !== filter.id);
      try { const { filters } = await request('/filters', { method: 'PUT', body: JSON.stringify({ filters: next }) }); savedFilters = filters; closeModal('#filter-modal'); if (currentView.kind === 'filter' && activeFilter && activeFilter.id === filter.id) setView({ kind: 'today' }); else renderSidebar(); toast('Filter deleted'); }
      catch (e) { handleApiError(e); }
    });
    panel.append(del);
  }
  modal.append(panel); openModal('#filter-modal');
}
function renderQuickAdd() {
  const wrap = $('#quick-add'); if (!wrap) return; wrap.innerHTML = '';
  const form = el('form', 'relative');
  const input = el('input', 'field'); input.placeholder = '+ Add task'; input.title = 'Try: Email Steve tomorrow 3pm #merlin !!'; input.maxLength = MAX_TITLE_LEN; input.autocomplete = 'off';
  form.addEventListener('submit', (e) => { e.preventDefault(); const v = input.value; input.value = ''; quickAdd(v); });
  form.append(input); wrap.append(form);
}
async function quickAdd(raw) {
  const p = parseQuickAdd(raw); if (!p.title) return;
  const boardId = (currentView.kind === 'board' && currentBoard) ? currentBoard.id : ((boards.find((b) => b.pinned) || boards[0] || {}).id);
  const payload = { title: p.title, boardId, tags: p.tags, priority: p.priority, recur: p.recur };
  if (p.dueAt) { payload.dueAt = p.dueAt; if (hasTimeOf(p.dueAt)) payload.remindAt = p.dueAt; }
  try {
    await request('/cards', { method: 'POST', body: JSON.stringify(payload) });
    await loadActive();
    if (currentBoard && boardId === currentBoard.id) await loadCards();
    renderCurrentView(); renderSidebar();
    toast(p.dueAt ? `Added · due ${formatDue(p.dueAt)}` : 'Added ✓');
  } catch (err) { handleApiError(err); }
}
// ---- 🏠 House view (House Plan bridge — houseplan is the source of truth) ----
const HOUSE_PRIO_HEX = { low: '#60a5fa', med: '#fbbf24', high: '#f87171' };
function renderHouseView(root) {
  $('#view-count').textContent = houseData && houseData.length ? String(houseData.filter((t) => t.state === 'open').length) : '';
  const wrap = el('div', 'mx-auto w-full max-w-2xl');

  const form = el('form', 'mb-4');
  const input = el('input', 'field');
  input.placeholder = '+ Add house job — try: fix gate latch @garage';
  input.autocomplete = 'off';
  form.append(input);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const raw = input.value.trim(); if (!raw) return;
    const m = raw.match(/@([\w\s''-]+)\s*$/);
    const body = { text: (m ? raw.slice(0, m.index) : raw).trim(), room: m ? m[1].trim() : '' };
    if (!body.text) return;
    input.value = '';
    try {
      await request('/house/tasks', { method: 'POST', body: JSON.stringify(body) });
      await loadHouse(true); renderCurrentView(); renderSidebar();
      toast(body.room ? `Added to ${body.room} 🏠` : 'Added to the house list 🏠');
    } catch (err) { handleApiError(err); }
  });
  wrap.append(form);

  if (!houseData || !houseData.length) {
    wrap.append(el('div', 'rounded-xl border border-edge bg-panel px-4 py-8 text-center text-sm text-ink-faint', 'Nothing on the house list. Add a job above, or pin one on the floor plan.'));
  } else {
    const open = houseData.filter((t) => t.state === 'open');
    const later = houseData.filter((t) => t.state === 'later');
    const groups = new Map();
    open.forEach((t) => { const k = t.room || 'Elsewhere'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(t); });
    groups.forEach((tasks, room) => {
      const head = el('div', 'mb-1 mt-4 flex items-baseline justify-between');
      head.append(el('h3', 'text-xs font-bold uppercase tracking-wide text-ink-faint', room), el('span', 'text-[11px] text-ink-faint', String(tasks.length)));
      wrap.append(head);
      const box = el('div', 'space-y-1');
      tasks.forEach((t) => box.append(houseRow(t)));
      wrap.append(box);
    });
    if (later.length) {
      wrap.append(el('h3', 'mb-1 mt-6 text-xs font-bold uppercase tracking-wide text-ink-faint', '⏳ Scheduled'));
      const box = el('div', 'space-y-1 opacity-70');
      later.forEach((t) => box.append(houseRow(t)));
      wrap.append(box);
    }
  }
  if (houseBase) {
    const a = el('a', 'mt-6 block text-center text-xs text-ink-faint underline decoration-dotted transition hover:text-ink', 'Open the floor plan ↗');
    a.href = houseBase; a.target = '_blank'; a.rel = 'noopener';
    wrap.append(a);
  }
  root.append(wrap);

  // quiet background refresh so the view stays honest without hammering the bridge
  if (!renderHouseView._busy && Date.now() - (renderHouseView._t || 0) > 15000) {
    renderHouseView._busy = true;
    loadHouse(true)
      .then(() => { renderHouseView._t = Date.now(); renderHouseView._busy = false; if (currentView.kind === 'house') { renderListView(); renderSidebar(); } })
      .catch(() => { renderHouseView._busy = false; });
  }
}
function houseRow(t) {
  const row = el('div', 'flex items-center gap-3 rounded-xl border border-edge bg-panel px-3 py-2');
  const cb = el('button', 'grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 text-[10px]');
  cb.style.borderColor = HOUSE_PRIO_HEX[t.priority] || '#888';
  cb.title = t.state === 'later' ? 'Make due now' : (t.repeat ? 'Done — schedules the next one' : 'Mark done');
  cb.textContent = t.state === 'later' ? '⏳' : '';
  cb.addEventListener('click', async () => {
    try { await request(`/house/tasks/${t.id}/toggle`, { method: 'POST' }); await loadHouse(true); renderCurrentView(); renderSidebar(); }
    catch (err) { handleApiError(err); }
  });
  const main = el('div', 'min-w-0 flex-1');
  main.append(el('div', 'truncate text-sm text-ink', `${t.emoji} ${t.text}`));
  const meta = [];
  if (t.room && t.floor) meta.push(t.floor);
  if (t.cost != null) meta.push('£' + t.cost);
  if (t.repeat) meta.push('↻ ' + t.repeat);
  if (t.state === 'later' && t.dueAt) meta.push('due ' + formatDue(t.dueAt));
  if (t.photos) meta.push('📷 ' + t.photos);
  if (meta.length) main.append(el('div', 'truncate text-[11px] text-ink-faint', meta.join(' · ')));
  row.append(cb, main);
  if (houseBase) {
    const open = el('a', 'shrink-0 rounded p-1 text-base text-ink-faint transition hover:text-ink', '🗺️');
    open.title = 'Show on the floor plan';
    open.href = houseBase + t.path; open.target = '_blank'; open.rel = 'noopener';
    row.append(open);
  }
  return row;
}
function houseTodaySection() {
  if (!houseData) return null;
  const due = houseData.filter((t) => t.state === 'open' && t.dueAt && dayStart(new Date(t.dueAt)) <= todayStart());
  if (!due.length) return null;
  const box = el('div', 'mt-6');
  box.append(el('h3', 'mb-1 text-xs font-bold uppercase tracking-wide text-ink-faint', '🏠 House — due'));
  const list = el('div', 'space-y-1');
  due.forEach((t) => list.append(houseRow(t)));
  box.append(list);
  return box;
}

function renderSmartViews() {
  const nav = $('#smart-views'); if (!nav) return; nav.innerHTML = '';
  const end = todayStart(); end.setDate(end.getDate() + 7);
  const todayN = allCards.filter((c) => c.dueAt && dayStart(new Date(c.dueAt)) <= todayStart()).length;
  const upN = allCards.filter((c) => c.dueAt && dayStart(new Date(c.dueAt)) <= end).length;
  const focusN = boards.reduce((n, bd) => n + (boardFocus(bd) ? 1 : 0), 0);
  const items = [
    { kind: 'focuses', icon: '🎯', label: 'In Focus', count: focusN },
    { kind: 'today', icon: '📅', label: 'Today', count: todayN },
    { kind: 'upcoming', icon: '🗓️', label: 'Next 7 days', count: upN },
    { kind: 'calendar', icon: '📆', label: 'Calendar' },
    { kind: 'timeline', icon: '📊', label: 'Timeline' },
    { kind: 'matrix', icon: '🔲', label: 'Priority Matrix' },
    { kind: 'habits', icon: '🌱', label: 'Habits' },
    { kind: 'journal', icon: '📓', label: 'Journal' },
    { kind: 'all', icon: '🗂️', label: 'All tasks', count: allCards.length },
  ];
  if (houseData) items.splice(3, 0, { kind: 'house', icon: '🏠', label: 'House', count: houseData.filter((t) => t.state === 'open').length });
  items.forEach((it) => {
    const b = el('button', 'nav-item' + (currentView.kind === it.kind ? ' active' : ''));
    b.append(el('span', 'text-base leading-none', it.icon), el('span', 'flex-1 truncate', it.label));
    if (it.count) b.append(el('span', 'nav-count', String(it.count)));
    b.addEventListener('click', () => setView({ kind: it.kind }));
    nav.append(b);
  });
}
function renderProjects() {
  const nav = $('#sidebar-projects'); if (!nav) return; nav.innerHTML = '';
  boards.forEach((bd) => {
    const active = currentView.kind === 'board' && currentBoard && currentBoard.id === bd.id;
    const b = el('button', 'nav-item' + (active ? ' active' : ''));
    b.append(el('span', 'text-base leading-none', bd.icon), el('span', 'flex-1 truncate', bd.name));
    const cnt = allCards.filter((c) => c.boardId === bd.id).length;
    if (bd.streak) { const f = el('span', 'text-ink-faint'); f.innerHTML = FLAME_SVG; b.append(f); }
    else if (cnt) b.append(el('span', 'nav-count', String(cnt)));
    b.addEventListener('click', () => openBoard(bd.id));
    nav.append(b);
  });
  const manage = el('button', 'nav-item text-ink-faint');
  manage.append(el('span', 'text-base leading-none', '⚙'), el('span', 'flex-1 truncate', 'Manage projects'));
  manage.addEventListener('click', openBoardsModal); nav.append(manage);
}
function renderTags() {
  const wrap = $('#sidebar-tags-wrap'), box = $('#sidebar-tags'); if (!box) return;
  const set = new Set(); allCards.forEach((c) => (c.tags || []).forEach((t) => set.add(t)));
  const tags = [...set].sort();
  wrap.classList.toggle('hidden', tags.length === 0);
  box.innerHTML = '';
  tags.forEach((t) => {
    const on = currentView.kind === 'tag' && activeTag === t;
    const b = el('button', 'tag-chip transition hover:opacity-80'); b.textContent = '#' + t;
    if (on) { b.style.background = 'var(--accent)'; b.style.color = 'var(--bg)'; }
    b.addEventListener('click', () => { activeTag = t; setView({ kind: 'tag', tag: t }); });
    box.append(b);
  });
}
function openSidebarDrawer() { $('#sidebar').classList.add('open'); $('#sidebar-backdrop').classList.remove('hidden'); }
function closeSidebarDrawer() { const s = $('#sidebar'); if (s) s.classList.remove('open'); const b = $('#sidebar-backdrop'); if (b) b.classList.add('hidden'); }

// ---- list views (Today / Upcoming / All / Tag) ----
function viewCards() {
  if (currentView.kind === 'filter') return activeFilter ? filterCards(activeFilter) : [];
  let list = allCards.slice();
  if (currentView.kind === 'search') {
    const q = searchQuery.toLowerCase();
    if (!q) return [];
    list = list.filter((c) => c.title.toLowerCase().includes(q) || (c.note || '').toLowerCase().includes(q) || (c.tags || []).some((t) => t.includes(q)));
  } else if (currentView.kind === 'tag') list = list.filter((c) => (c.tags || []).includes(activeTag));
  else if (currentView.kind === 'today') list = list.filter((c) => c.dueAt && dayStart(new Date(c.dueAt)) <= todayStart());
  else if (currentView.kind === 'upcoming') { const end = todayStart(); end.setDate(end.getDate() + 7); list = list.filter((c) => c.dueAt && dayStart(new Date(c.dueAt)) <= end); }
  list.sort(sorterFor(listSort));
  return list;
}
// Apply a saved-filter's criteria to the full active set.
function filterCards(f) {
  return allCards.filter((c) => {
    if (f.tags && f.tags.length && !f.tags.every((t) => (c.tags || []).includes(t))) return false;
    if (f.priority && (c.priority || 0) < f.priority) return false;
    if (f.boards && f.boards.length && !f.boards.includes(c.boardId)) return false;
    if (f.due && f.due !== 'any') {
      if (!c.dueAt) return false;
      const dd = dayStart(new Date(c.dueAt));
      if (f.due === 'today' && dd > todayStart()) return false;
      if (f.due === 'week') { const e = todayStart(); e.setDate(e.getDate() + 7); if (dd > e) return false; }
      if (f.due === 'overdue' && dueClass(c.dueAt) !== 'overdue') return false;
    }
    return true;
  }).sort(sorterFor(listSort));
}
function groupHeader(text) { return el('div', 'px-1 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-ink-faint first:pt-0', text); }
function renderListView() {
  const root = $('#list-view'); if (!root) return; root.innerHTML = '';
  if (currentView.kind === 'calendar') { $('#view-count').textContent = ''; renderCalendar(root); return; }
  if (currentView.kind === 'timeline') { renderTimeline(root); return; }
  if (currentView.kind === 'journal') { $('#view-count').textContent = ''; renderJournal(root); return; }
  if (currentView.kind === 'matrix') { renderMatrix(root); return; }
  if (currentView.kind === 'habits') { renderHabits(root); return; }
  if (currentView.kind === 'house') { renderHouseView(root); return; }
  if (currentView.kind === 'focuses') { renderFocusesView(root); return; }
  const list = viewCards();
  $('#view-count').textContent = list.length ? String(list.length) : '';
  const isDateView = currentView.kind === 'today' || currentView.kind === 'upcoming';
  const wrap = el('div', 'mx-auto w-full ' + (isDateView ? 'max-w-2xl' : 'max-w-6xl'));
  if (!list.length) {
    const hs = currentView.kind === 'today' ? houseTodaySection() : null;
    if (hs) { const w = el('div', 'mx-auto w-full max-w-2xl'); w.append(hs); root.append(w); }
    else root.append(listEmptyState());
    return;
  }
  const bar = el('div', 'mb-3 flex items-center justify-end gap-2');
  bar.append(el('span', 'text-xs text-ink-faint', 'Sort'));
  const sortSel = el('select', 'rounded-lg border border-edge bg-panel px-2 py-1 text-xs text-ink-soft');
  [['smart', 'Smart'], ['due', 'Due date'], ['priority', 'Priority'], ['created', 'Created'], ['alpha', 'A–Z']].forEach(([v, l]) => { const o = el('option', '', l); o.value = v; sortSel.append(o); });
  sortSel.value = listSort;
  sortSel.addEventListener('change', () => { listSort = sortSel.value; try { localStorage.setItem('tf-sort', listSort); } catch (_) {} renderListView(); });
  bar.append(sortSel);
  wrap.append(bar);
  const groups = new Map();
  const pushGroup = (k, c) => { if (!groups.has(k)) groups.set(k, []); groups.get(k).push(c); };
  if (currentView.kind === 'all' || currentView.kind === 'tag' || currentView.kind === 'search' || currentView.kind === 'filter') {
    list.forEach((c) => { const b = boards.find((x) => x.id === c.boardId); pushGroup(b ? b.icon + '  ' + b.name : 'Other', c); });
  } else {
    list.forEach((c) => pushGroup(dueClass(c.dueAt) === 'overdue' ? 'Overdue' : formatDue(dayStart(new Date(c.dueAt)).toISOString()), c));
  }
  if (isDateView) {
    // Clean single-column agenda — chronological, with accented date headers.
    groups.forEach((cards, label) => {
      const head = el('div', 'mb-2 mt-6 flex items-center gap-2 first:mt-0');
      const accent = el('span', 'h-4 w-1 shrink-0 rounded-full'); accent.style.background = label === 'Overdue' ? '#f87171' : (label === 'Today' ? 'var(--accent)' : 'var(--edge-strong)');
      head.append(accent, el('span', 'text-sm font-semibold text-ink', label), el('span', 'nav-count', String(cards.length)));
      wrap.append(head);
      const g = el('div', 'space-y-1.5'); cards.forEach((c) => g.append(taskRow(c))); wrap.append(g);
    });
    if (currentView.kind === 'today') { const hs = houseTodaySection(); if (hs) wrap.append(hs); }
  } else {
    const cols = el('div', 'columns-1 lg:columns-2 2xl:columns-3'); cols.style.columnGap = '1.25rem';
    groups.forEach((cards, label) => {
      const block = el('div', 'mb-4 break-inside-avoid');
      block.append(groupHeader(label));
      const g = el('div', 'space-y-1.5'); cards.forEach((c) => g.append(taskRow(c)));
      block.append(g); cols.append(block);
    });
    wrap.append(cols);
  }
  root.append(wrap);
}
function listEmptyState() {
  const box = el('div', 'flex h-full flex-col items-center justify-center gap-3 px-6 py-16 text-center');
  const msg = { today: 'Nothing due today. 🎉', upcoming: 'Nothing due in the next 7 days.', all: 'No tasks yet — add one from the sidebar.', tag: 'No tasks with this tag.', search: searchQuery ? `No tasks match “${searchQuery}”.` : 'Type to search your tasks.' }[currentView.kind] || 'Nothing here.';
  box.append(el('div', 'text-4xl', '🗒️'), el('p', 'max-w-sm text-sm text-ink-faint', msg));
  return box;
}
function taskRow(card) {
  const row = el('div', 'group flex items-start gap-3 rounded-xl border border-edge bg-card px-3 py-2.5 transition hover:border-edge-strong');
  if (card.priority) { row.style.borderLeftColor = PRIORITY_HEX[card.priority]; row.style.borderLeftWidth = '3px'; }
  row.addEventListener('contextmenu', (e) => { e.preventDefault(); openCardMenu(card, row, { multiBoard: boards.length > 1, x: e.clientX, y: e.clientY }); });
  const box = el('button', 'mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border-2 text-transparent transition hover:text-ink-soft');
  box.style.borderColor = priorityColor(card.priority) || 'var(--ink-faint)'; box.title = 'Complete'; box.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="h-2.5 w-2.5"><path d="M20 6 9 17l-5-5"/></svg>';
  box.addEventListener('click', (e) => { e.stopPropagation(); completeCard(card.id); });
  const mid = el('div', 'min-w-0 flex-1 cursor-pointer'); mid.addEventListener('click', () => openTaskModal(card));
  mid.append(el('div', 'truncate text-sm text-ink', card.title));
  const meta = el('div', 'mt-1 flex flex-wrap items-center gap-1.5');
  if (card.dueAt) { const p = el('span', 'due-pill ' + dueClass(card.dueAt)); p.innerHTML = CLOCK_SVG; p.append(el('span', '', formatDue(card.dueAt))); meta.append(p); }
  const b = boards.find((x) => x.id === card.boardId);
  if (b && currentView.kind !== 'board') meta.append(el('span', 'tag-chip', b.icon + ' ' + b.name));
  (card.tags || []).forEach((t) => meta.append(el('span', 'tag-chip', '#' + t)));
  if (card.recur) meta.append(el('span', 'tag-chip', '🔁'));
  if (card.duration) meta.append(el('span', 'tag-chip', '⏱ ' + fmtDur(card.duration)));
  if (card.note) { const nn = el('span', 'tag-chip', '📝'); nn.title = 'Has notes'; meta.append(nn); }
  const subs = subtasksOf(card);
  if (subs.length) meta.append(el('span', 'tag-chip', `☑ ${subs.filter((s) => s.done).length}/${subs.length}`));
  if (meta.childNodes.length) mid.append(meta);
  row.append(box, mid);
  return row;
}
async function completeCard(id) {
  allCards = allCards.filter((c) => c.id !== id);
  state.cards = state.cards.filter((c) => c.id !== id);
  renderCurrentView(); renderSidebar();
  try { const { cards } = await request(`/cards/${id}/archive`, { method: 'POST' }); if (currentBoard) state.cards = cards; await loadActive(); renderCurrentView(); renderSidebar(); toast('Completed ✓'); }
  catch (err) { if (!handleApiError(err)) { loadActive(); loadCards(); } }
}

// ---- "In Focus" — a master list of each board's current focus ----
function renderFocusesView(root) {
  const outer = el('div', 'flex min-h-full w-full items-center justify-center py-4');
  const wrap = el('div', 'grid w-full max-w-5xl grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3');
  let n = 0;
  boards.forEach((bd) => {
    const focus = boardFocus(bd);
    const card = el('button', 'flex min-h-[7rem] flex-col rounded-2xl border border-edge bg-card p-4 text-left transition hover:border-edge-strong');
    card.addEventListener('click', () => openBoard(bd.id));
    const top = el('div', 'mb-2 flex items-center gap-2');
    top.append(el('span', 'shrink-0 text-xl leading-none', bd.icon), el('span', 'truncate text-[10px] font-semibold uppercase tracking-wider text-ink-faint', bd.focusLabel || bd.name));
    card.append(top);
    if (focus) {
      n++;
      card.append(el('div', 'text-base font-semibold leading-snug text-ink line-clamp-3', focus.title));
      if (focus.dueAt) { const p = el('span', 'due-pill mt-2 self-start ' + dueClass(focus.dueAt)); p.innerHTML = CLOCK_SVG; p.append(el('span', '', formatDue(focus.dueAt))); card.append(p); }
    } else card.append(el('div', 'text-sm text-ink-faint', 'No focus set — tap to choose'));
    wrap.append(card);
  });
  $('#view-count').textContent = n ? String(n) : '';
  outer.append(wrap); root.append(outer);
}

// ---- Habits ----
async function loadHabits() { try { const { habits: h, checkins } = await request('/habits'); habits = h || []; habitCheckins = new Set((checkins || []).map((c) => c.habitId + '|' + c.day)); } catch (_) { habits = []; habitCheckins = new Set(); } }
function habitDaySet(habitId) { const s = new Set(); habitCheckins.forEach((k) => { const i = k.indexOf('|'); if (k.slice(0, i) === habitId) s.add(k.slice(i + 1)); }); return s; }
function habitStreak(days) { let n = 0; const d = new Date(); if (!days.has(ymd(d))) d.setDate(d.getDate() - 1); while (days.has(ymd(d))) { n++; d.setDate(d.getDate() - 1); } return n; }
async function toggleHabit(habitId, day) {
  const key = habitId + '|' + day;
  if (habitCheckins.has(key)) habitCheckins.delete(key); else habitCheckins.add(key);
  if (currentView.kind === 'habits') renderHabits($('#list-view'));
  try { await request('/habits/' + habitId + '/toggle', { method: 'POST', body: JSON.stringify({ day }) }); }
  catch (err) { if (habitCheckins.has(key)) habitCheckins.delete(key); else habitCheckins.add(key); if (currentView.kind === 'habits') renderHabits($('#list-view')); handleApiError(err); }
}
function renderHabits(root) {
  root.innerHTML = ''; // toggleHabit / editor call this directly — clear so lists never stack
  $('#view-count').textContent = habits.length ? String(habits.length) : '';
  const wrap = el('div', 'mx-auto w-full max-w-4xl');
  const addBtn = el('button', 'btn-accent mb-4 rounded-lg px-4 py-2 text-sm font-semibold transition hover:opacity-90', '+ New habit');
  addBtn.addEventListener('click', () => openHabitEditor(null));
  wrap.append(addBtn);
  if (!habits.length) { wrap.append(el('p', 'py-8 text-center text-sm text-ink-faint', 'No habits yet — add one to start building streaks.')); root.append(wrap); return; }
  const today = new Date();
  const last7 = []; for (let i = 6; i >= 0; i--) { const d = new Date(today); d.setDate(today.getDate() - i); last7.push(d); }
  const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const list = el('div', 'space-y-2');
  habits.forEach((h) => {
    const days = habitDaySet(h.id), streak = habitStreak(days);
    const row = el('div', 'flex items-center gap-3 rounded-xl border border-edge bg-card px-4 py-3');
    row.style.borderLeftColor = h.color; row.style.borderLeftWidth = '3px';
    const left = el('div', 'flex min-w-0 flex-1 items-center gap-2');
    left.append(el('span', 'shrink-0 text-lg', h.icon), el('span', 'truncate text-sm font-medium text-ink', h.name));
    if (streak) left.append(el('span', 'shrink-0 tag-chip', '🔥 ' + streak));
    const daysWrap = el('div', 'flex shrink-0 items-center gap-1');
    last7.forEach((d) => {
      const ds = ymd(d), done = days.has(ds), isToday = ds === ymd(today);
      const cell = el('div', 'flex flex-col items-center gap-0.5');
      cell.append(el('span', 'text-[9px] text-ink-faint', DOW[d.getDay()]));
      const c = el('button', 'grid h-8 w-8 place-items-center rounded-full border-2 text-[10px] tabular-nums transition');
      c.title = d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' });
      c.style.borderColor = done ? h.color : (isToday ? 'var(--edge-strong)' : 'var(--edge)');
      c.style.background = done ? h.color : 'transparent';
      c.style.color = done ? '#fff' : 'var(--ink-faint)';
      c.textContent = String(d.getDate());
      c.addEventListener('click', () => toggleHabit(h.id, ds));
      cell.append(c); daysWrap.append(cell);
    });
    const edit = el('button', 'shrink-0 rounded-md p-1 text-ink-faint transition hover:text-ink', '✎'); edit.title = 'Edit habit';
    edit.addEventListener('click', () => openHabitEditor(h));
    row.append(left, daysWrap, edit); list.append(row);
  });
  wrap.append(list); root.append(wrap);
}
const HABIT_ICONS = ['✅', '💧', '🏃', '📚', '🧘', '💪', '🥗', '😴', '🚭', '🦷', '🧹', '✍️', '🎸', '🌱', '☀️', '💊'];
function openHabitEditor(habit) {
  const modal = $('#habit-modal'); modal.innerHTML = '';
  const panel = modalShell(habit ? 'Edit habit' : 'New habit', () => closeModal('#habit-modal')); panel.classList.add('max-w-sm');
  const name = el('input', 'field'); name.placeholder = 'Habit name (e.g. Drink water)'; name.value = habit ? habit.name : '';
  let icon = habit ? habit.icon : '✅', color = habit ? habit.color : '#34d399';
  const iconRow = el('div', 'flex flex-wrap gap-1'); const iconBtns = [];
  HABIT_ICONS.forEach((em) => { const b = el('button', 'grid h-8 w-8 place-items-center rounded-lg border border-edge text-base', em); b.type = 'button'; if (em === icon) b.classList.add('border-edge-strong'); b.addEventListener('click', () => { icon = em; iconBtns.forEach((x) => x.classList.remove('border-edge-strong')); b.classList.add('border-edge-strong'); }); iconBtns.push(b); iconRow.append(b); });
  const colorIn = el('input', 'h-9 w-full rounded border border-edge bg-transparent'); colorIn.type = 'color'; colorIn.value = color; colorIn.addEventListener('input', () => { color = colorIn.value; });
  const err = el('p', 'mt-1 hidden text-xs text-red-400');
  const save = el('button', 'btn-accent mt-3 w-full rounded-lg px-4 py-2 text-sm font-semibold transition hover:opacity-90', 'Save habit');
  save.addEventListener('click', async () => {
    if (!name.value.trim()) { err.textContent = 'A name is required.'; err.classList.remove('hidden'); return; }
    try {
      if (habit) await request('/habits/' + habit.id, { method: 'PATCH', body: JSON.stringify({ name: name.value, icon, color }) });
      else await request('/habits', { method: 'POST', body: JSON.stringify({ name: name.value, icon, color }) });
      await loadHabits(); closeModal('#habit-modal'); renderSidebar(); if (currentView.kind === 'habits') renderHabits($('#list-view')); toast(habit ? 'Habit updated' : 'Habit added');
    } catch (e) { err.textContent = e.message; err.classList.remove('hidden'); }
  });
  panel.append(el('label', 'mb-1 block text-xs text-ink-soft', 'Name'), name, el('label', 'mb-1 mt-3 block text-xs text-ink-soft', 'Icon'), iconRow, el('label', 'mb-1 mt-3 block text-xs text-ink-soft', 'Colour'), colorIn, err, save);
  if (habit) {
    const del = el('button', 'mt-2 w-full rounded-lg border border-edge px-4 py-2 text-sm font-medium text-red-400 transition hover:bg-edge', 'Delete habit');
    del.addEventListener('click', async () => { if (!confirm(`Delete "${habit.name}" and all its history?`)) return; try { await request('/habits/' + habit.id, { method: 'DELETE' }); await loadHabits(); closeModal('#habit-modal'); renderSidebar(); if (currentView.kind === 'habits') renderHabits($('#list-view')); toast('Habit deleted'); } catch (e) { handleApiError(e); } });
    panel.append(del);
  }
  modal.append(panel); openModal('#habit-modal');
}

// ---- Eisenhower priority matrix (urgent × important) ----
function renderMatrix(root) {
  const soon = todayStart(); soon.setDate(soon.getDate() + 2); // "urgent" = due within ~2 days (incl. overdue)
  const urgent = (c) => c.dueAt && dayStart(new Date(c.dueAt)) <= soon;
  const important = (c) => (c.priority || 0) >= 2;
  const quads = [
    { title: 'Do first', sub: 'Important · Urgent', color: '#f87171', test: (c) => important(c) && urgent(c) },
    { title: 'Schedule', sub: 'Important · Not urgent', color: '#60a5fa', test: (c) => important(c) && !urgent(c) },
    { title: 'Delegate', sub: 'Not important · Urgent', color: '#fbbf24', test: (c) => !important(c) && urgent(c) },
    { title: 'Later', sub: 'Not important · Not urgent', color: '#a1a1aa', test: (c) => !important(c) && !urgent(c) },
  ];
  $('#view-count').textContent = allCards.length ? String(allCards.length) : '';
  const grid = el('div', 'grid h-full min-h-0 w-full grid-cols-1 gap-3 md:grid-cols-2 md:grid-rows-2');
  quads.forEach((q) => {
    const items = allCards.filter(q.test).sort((a, b) => (dueSortKey(a) - dueSortKey(b)) || ((b.priority || 0) - (a.priority || 0)));
    const box = el('div', 'flex min-h-0 flex-col overflow-hidden rounded-2xl border border-edge bg-panel');
    box.style.borderTopColor = q.color; box.style.borderTopWidth = '3px';
    const head = el('div', 'flex items-baseline justify-between gap-2 border-b border-edge px-4 py-2.5');
    head.append(el('div', 'text-sm font-semibold text-ink', q.title), el('div', 'text-[10px] uppercase tracking-wider text-ink-faint', q.sub));
    const body = el('div', 'clean-scroll flex-1 space-y-1.5 overflow-y-auto p-3');
    if (!items.length) body.append(el('p', 'px-1 py-4 text-center text-xs text-ink-faint', 'Nothing here'));
    else items.forEach((c) => body.append(taskRow(c)));
    box.append(head, body); grid.append(box);
  });
  root.append(grid);
}

// ---- Timeline (Gantt-style: bars from start → due, grouped by project) ----
function renderTimeline(root) {
  root.innerHTML = '';
  const DAY = 86400000, DW = 44, LABELW = 180, ROWH = 34, HEADERH = 54, GROUPH = 30;
  const dated = allCards.filter((c) => c.dueAt || c.startAt);
  $('#view-count').textContent = dated.length ? String(dated.length) : '';
  if (!dated.length) {
    const box = el('div', 'flex h-full flex-col items-center justify-center gap-3 px-6 text-center');
    box.append(el('div', 'text-4xl', '📊'), el('p', 'max-w-sm text-sm text-ink-faint', 'No scheduled tasks yet — give tasks a start or due date and they’ll appear here.'));
    root.append(box); return;
  }
  const spanOf = (c) => [dayStart(new Date(c.startAt || c.dueAt)), dayStart(new Date(c.dueAt || c.startAt))];
  let minMs = Infinity, maxMs = -Infinity;
  dated.forEach((c) => { const [s, e] = spanOf(c); minMs = Math.min(minMs, s.getTime()); maxMs = Math.max(maxMs, e.getTime()); });
  const todayS = todayStart(), todayMs = todayS.getTime();
  let start = dayStart(new Date(Math.min(minMs, todayMs))); start.setDate(start.getDate() - 3);
  let end = dayStart(new Date(Math.max(maxMs, todayMs))); end.setDate(end.getDate() + 5);
  let days = Math.round((end - start) / DAY) + 1;
  if (days > 540) days = 540;
  const totalW = LABELW + days * DW;
  const idxOf = (d) => Math.round((dayStart(d) - start) / DAY);

  const groups = new Map();
  dated.forEach((c) => { const k = c.boardId || 'none'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(c); });
  groups.forEach((arr) => arr.sort((a, b) => new Date(a.startAt || a.dueAt) - new Date(b.startAt || b.dueAt)));

  const scroll = el('div', 'clean-scroll relative h-full w-full overflow-auto');
  const inner = el('div', 'relative'); inner.style.width = totalW + 'px';

  const grid = el('div', 'pointer-events-none absolute bottom-0'); grid.style.top = HEADERH + 'px'; grid.style.left = LABELW + 'px'; grid.style.right = '0';
  grid.style.backgroundImage = `repeating-linear-gradient(90deg, var(--edge) 0 1px, transparent 1px ${DW}px)`; grid.style.opacity = '0.4';
  inner.append(grid);

  const header = el('div', 'sticky top-0 z-20 flex border-b border-edge bg-panel'); header.style.height = HEADERH + 'px';
  const corner = el('div', 'sticky left-0 z-30 flex shrink-0 items-center border-r border-edge bg-panel px-3'); corner.style.width = LABELW + 'px';
  const todayBtn = el('button', 'rounded-lg border border-edge px-2.5 py-1 text-xs font-medium text-ink-soft transition hover:text-ink', '⦿ Today');
  corner.append(todayBtn); header.append(corner);
  for (let i = 0; i < days; i++) {
    const d = new Date(start.getTime() + i * DAY);
    const weekend = d.getDay() === 0 || d.getDay() === 6;
    const cell = el('div', 'flex shrink-0 flex-col items-center justify-center border-r border-edge'); cell.style.width = DW + 'px';
    if (weekend) cell.style.background = 'var(--focus-tint)';
    if (d.getDate() === 1 || i === 0) cell.append(el('div', 'text-[9px] font-bold leading-none text-ink', d.toLocaleDateString([], { month: 'short' })));
    cell.append(el('div', 'text-[11px] font-medium leading-tight ' + (weekend ? 'text-ink-faint' : 'text-ink'), String(d.getDate())));
    cell.append(el('div', 'text-[8px] ' + (weekend ? 'text-ink-faint' : 'text-ink-soft'), ['S', 'M', 'T', 'W', 'T', 'F', 'S'][d.getDay()]));
    header.append(cell);
  }
  inner.append(header);

  groups.forEach((cards, bid) => {
    const b = boards.find((x) => x.id === bid);
    const grow = el('div', 'relative border-b border-edge'); grow.style.height = GROUPH + 'px'; grow.style.width = totalW + 'px'; grow.style.background = 'var(--panel)';
    const gh = el('div', 'sticky left-0 z-10 flex h-full items-center gap-2 border-r border-edge bg-panel px-3 text-xs font-semibold text-ink'); gh.style.width = LABELW + 'px';
    gh.append(el('span', 'shrink-0', b ? b.icon : '🗂️'), el('span', 'truncate', b ? b.name : 'Other'));
    grow.append(gh); inner.append(grow);
    cards.forEach((c) => {
      const row = el('div', 'relative border-b border-edge'); row.style.height = ROWH + 'px'; row.style.width = totalW + 'px';
      const label = el('div', 'sticky left-0 z-10 flex h-full items-center border-r border-edge bg-panel px-3'); label.style.width = LABELW + 'px';
      const lt = el('button', 'w-full truncate text-left text-xs text-ink transition hover:text-ink-strong', c.title); lt.addEventListener('click', () => openTaskModal(c)); label.append(lt);
      row.append(label);
      const [s, e] = spanOf(c);
      const off = idxOf(s), spanDays = Math.max(1, idxOf(e) - off + 1);
      const overdue = dueClass(c.dueAt) === 'overdue';
      const bar = el('button', 'absolute truncate rounded-md px-1.5 text-left text-[10px] font-medium transition hover:brightness-95');
      bar.style.left = (LABELW + off * DW + 2) + 'px'; bar.style.width = (spanDays * DW - 4) + 'px'; bar.style.top = '5px'; bar.style.height = (ROWH - 10) + 'px'; bar.style.lineHeight = (ROWH - 10) + 'px';
      bar.style.background = overdue ? '#f87171' : (PRIORITY_HEX[c.priority] || '#94a3b8'); bar.style.color = 'rgba(0,0,0,0.78)';
      bar.textContent = spanDays >= 2 ? c.title : '';
      bar.title = c.title + (c.startAt ? ' · start ' + formatDue(c.startAt) : '') + (c.dueAt ? ' → due ' + formatDue(c.dueAt) : '');
      bar.addEventListener('click', () => openTaskModal(c));
      row.append(bar); inner.append(row);
    });
  });

  const tOff = idxOf(todayS);
  if (tOff >= 0 && tOff < days) {
    const line = el('div', 'pointer-events-none absolute z-10'); line.style.left = (LABELW + tOff * DW) + 'px'; line.style.top = HEADERH + 'px'; line.style.bottom = '0'; line.style.width = '2px'; line.style.background = 'var(--accent)'; line.style.opacity = '0.8';
    inner.append(line);
  }

  scroll.append(inner); root.append(scroll);
  const jumpToday = () => { scroll.scrollLeft = Math.max(0, LABELW + tOff * DW - scroll.clientWidth / 2); };
  todayBtn.addEventListener('click', jumpToday);
  requestAnimationFrame(jumpToday);
}

// ---- Calendar (month grid of tasks by due date) ----
function renderCalendar(root) {
  root.innerHTML = ''; // month-nav calls this directly — clear so views never stack
  if (!calCursor) { const n = new Date(); calCursor = new Date(n.getFullYear(), n.getMonth(), 1); }
  const wrap = el('div', 'flex h-full w-full flex-col');
  const head = el('div', 'mb-3 flex items-center justify-between gap-2');
  head.append(el('div', 'text-sm font-semibold text-ink', calCursor.toLocaleDateString([], { month: 'long', year: 'numeric' })));
  const nav = el('div', 'flex items-center gap-1');
  const iconBtn = (label, title, fn) => { const b = el('button', 'grid h-8 w-8 place-items-center rounded-lg border border-edge text-ink-soft transition hover:text-ink', label); b.title = title; b.addEventListener('click', fn); return b; };
  const goto = (y, m) => { calCursor = new Date(y, m, 1); renderCalendar(root); };
  const todayBtn = el('button', 'rounded-lg border border-edge px-2.5 text-xs font-medium text-ink-soft transition hover:text-ink', 'Today');
  todayBtn.addEventListener('click', () => { const n = new Date(); goto(n.getFullYear(), n.getMonth()); });
  nav.append(
    iconBtn('‹', 'Previous month', () => goto(calCursor.getFullYear(), calCursor.getMonth() - 1)),
    todayBtn,
    iconBtn('›', 'Next month', () => goto(calCursor.getFullYear(), calCursor.getMonth() + 1)),
  );
  head.append(nav); wrap.append(head);

  const dow = el('div', 'mb-1 grid grid-cols-7 gap-1');
  ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].forEach((d) => dow.append(el('div', 'px-1 text-center text-[10px] font-semibold uppercase tracking-wider text-ink-faint', d)));
  wrap.append(dow);

  const byDay = new Map();
  allCards.forEach((c) => { if (!c.dueAt) return; const k = dayStart(new Date(c.dueAt)).getTime(); if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(c); });
  const first = new Date(calCursor.getFullYear(), calCursor.getMonth(), 1);
  const startDow = (first.getDay() + 6) % 7; // Monday-first
  const gridStart = new Date(first); gridStart.setDate(first.getDate() - startDow);
  const todayT = todayStart().getTime();
  const grid = el('div', 'grid min-h-0 flex-1 grid-cols-7 grid-rows-6 gap-1');
  for (let i = 0; i < 42; i++) {
    const day = new Date(gridStart); day.setDate(gridStart.getDate() + i);
    const inMonth = day.getMonth() === calCursor.getMonth();
    const dayT = dayStart(day).getTime();
    const cell = el('div', 'flex min-h-0 flex-col overflow-hidden rounded-lg border border-edge p-1 ' + (inMonth ? 'bg-card' : 'opacity-40'));
    const top = el('div', 'mb-0.5 px-0.5');
    const dn = el('span', 'text-xs ' + (dayT === todayT ? 'inline-grid h-5 w-5 place-items-center rounded-full font-bold' : 'text-ink-soft'));
    dn.textContent = String(day.getDate());
    if (dayT === todayT) { dn.style.background = 'var(--accent)'; dn.style.color = 'var(--bg)'; }
    top.append(dn); cell.append(top);
    const items = (byDay.get(dayT) || []).slice().sort((a, b) => dueSortKey(a) - dueSortKey(b));
    items.slice(0, 3).forEach((c) => {
      const chip = el('button', 'mb-0.5 block w-full truncate rounded px-1 py-0.5 text-left text-[10px] leading-tight ' + (dueClass(c.dueAt) === 'overdue' ? 'text-red-400' : 'text-ink-soft'));
      chip.style.background = 'var(--edge)'; chip.textContent = c.title; chip.title = c.title;
      chip.addEventListener('click', (e) => { e.stopPropagation(); openTaskModal(c); });
      cell.append(chip);
    });
    if (items.length > 3) cell.append(el('div', 'px-1 text-[9px] text-ink-faint', '+' + (items.length - 3) + ' more'));
    grid.append(cell);
  }
  wrap.append(grid);
  root.append(wrap);
}

// ---- Journal (one free-text entry per day, with a calendar to navigate) ----
function ymd(d) { const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }
function fromYmd(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
async function loadJournalDays() { try { const { days } = await request('/journal/days'); journalEntries = days || []; journalDays = new Set(journalEntries.map((e) => e.day)); } catch (_) {} }
function renderJournalEntriesList() {
  const box = $('#journal-entries'); if (!box) return; box.innerHTML = '';
  if (!journalEntries.length) return;
  box.append(el('div', 'mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-ink-faint', 'Entries'));
  const list = el('div', 'space-y-1');
  (journalShowAll ? journalEntries : journalEntries.slice(0, 10)).forEach((e) => {
    const active = e.day === journalDay;
    const row = el('button', 'flex w-full flex-col items-start rounded-lg border px-3 py-2 text-left transition ' + (active ? 'border-edge-strong bg-card' : 'border-edge hover:border-edge-strong'));
    const head = el('div', 'flex w-full items-center gap-1.5');
    head.append(el('span', 'text-xs font-semibold text-ink', fromYmd(e.day).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })));
    if (e.mood) head.append(el('span', 'text-xs', e.mood));
    row.append(head);
    if (e.snippet) row.append(el('span', 'mt-0.5 line-clamp-1 w-full text-xs text-ink-soft', e.snippet));
    row.addEventListener('click', () => selectJournalDay(e.day));
    list.append(row);
  });
  box.append(list);
  if (journalEntries.length > 10) {
    const btn = el('button', 'mt-2 w-full rounded-lg border border-edge px-3 py-1.5 text-xs text-ink-soft transition hover:text-ink', journalShowAll ? 'Show less' : `Show all ${journalEntries.length}`);
    btn.addEventListener('click', () => { journalShowAll = !journalShowAll; renderJournalEntriesList(); });
    box.append(btn);
  }
}
function scheduleJournalSave(day, content, mood, statusEl) { clearTimeout(journalSaveTimer); journalSaveTimer = setTimeout(() => flushJournalSave(day, content, mood, statusEl), 700); }
async function flushJournalSave(day, content, mood, statusEl) {
  clearTimeout(journalSaveTimer); journalSaveTimer = null;
  try {
    await request('/journal', { method: 'PUT', body: JSON.stringify({ day, content, mood: mood || '' }) });
    if ((content && content.trim()) || mood) journalDays.add(day); else journalDays.delete(day);
    if (statusEl) statusEl.textContent = 'Saved';
  } catch (err) { if (statusEl) statusEl.textContent = 'Save failed'; }
}
function selectJournalDay(ds) {
  const ta = $('#journal-ta'); if (ta) flushJournalSave(journalDay, ta.value, journalCurMood);
  journalDay = ds; const d = fromYmd(ds); journalCursor = new Date(d.getFullYear(), d.getMonth(), 1);
  renderJournal($('#list-view'));
}
function refreshJournalCal() { const s = $('#journal-cal-slot'); if (s) { s.innerHTML = ''; s.append(buildJournalCalendar()); } }
function buildJournalCalendar() {
  const wrap = el('div', 'rounded-2xl border border-edge bg-panel p-3');
  const head = el('div', 'mb-2 flex items-center justify-between');
  head.append(el('div', 'text-xs font-semibold text-ink', journalCursor.toLocaleDateString([], { month: 'long', year: 'numeric' })));
  const nav = el('div', 'flex gap-1');
  const b = (l, fn) => { const x = el('button', 'grid h-6 w-6 place-items-center rounded text-ink-soft transition hover:bg-edge hover:text-ink', l); x.addEventListener('click', fn); return x; };
  nav.append(b('‹', () => { journalCursor = new Date(journalCursor.getFullYear(), journalCursor.getMonth() - 1, 1); refreshJournalCal(); }), b('›', () => { journalCursor = new Date(journalCursor.getFullYear(), journalCursor.getMonth() + 1, 1); refreshJournalCal(); }));
  head.append(nav); wrap.append(head);
  const dow = el('div', 'mb-1 grid grid-cols-7 gap-1');
  ['M', 'T', 'W', 'T', 'F', 'S', 'S'].forEach((d) => dow.append(el('div', 'text-center text-[10px] font-semibold text-ink-faint', d)));
  wrap.append(dow);
  const first = new Date(journalCursor.getFullYear(), journalCursor.getMonth(), 1);
  const startDow = (first.getDay() + 6) % 7; const gs = new Date(first); gs.setDate(first.getDate() - startDow);
  const grid = el('div', 'grid grid-cols-7 gap-1');
  const todayStr = ymd(new Date());
  for (let i = 0; i < 42; i++) {
    const day = new Date(gs); day.setDate(gs.getDate() + i); const ds = ymd(day);
    const inMonth = day.getMonth() === journalCursor.getMonth(); const sel = ds === journalDay;
    const cell = el('button', 'relative grid h-10 place-items-center rounded-md text-sm transition ' + (sel ? '' : 'hover:bg-edge ') + (inMonth ? 'text-ink-soft' : 'text-ink-faint opacity-50'));
    cell.textContent = String(day.getDate());
    if (sel) { cell.style.background = 'var(--accent)'; cell.style.color = 'var(--bg)'; }
    else if (ds === todayStr) cell.style.outline = '1px solid var(--edge-strong)';
    if (journalDays.has(ds) && !sel) { const dot = el('span', 'absolute bottom-1 h-1 w-1 rounded-full'); dot.style.background = 'var(--accent)'; cell.append(dot); }
    cell.addEventListener('click', () => selectJournalDay(ds));
    grid.append(cell);
  }
  wrap.append(grid);
  return wrap;
}
const JOURNAL_MOODS = [['😄', 'Great'], ['🙂', 'Good'], ['😐', 'Okay'], ['😕', 'Low'], ['😢', 'Rough']];
const JOURNAL_PROMPTS = [['🌟 Wins', 'What went well today?'], ['🙏 Grateful', "Three things I'm grateful for:"], ['💭 On my mind', "What's on my mind?"], ['🎯 Tomorrow', "Tomorrow I'll focus on:"]];
function renderJournal(root) {
  if (!root) return;
  root.innerHTML = ''; // selectJournalDay calls this directly — clear so editors never stack
  if (!journalDay) journalDay = ymd(new Date());
  if (!journalCursor) { const d = fromYmd(journalDay); journalCursor = new Date(d.getFullYear(), d.getMonth(), 1); }
  const day = journalDay; // capture so this editor always saves/loads its own day, even after switching
  const container = el('div', 'flex h-full w-full flex-col gap-4 xl:flex-row');
  const calSlot = el('div', 'shrink-0 xl:w-72'); calSlot.id = 'journal-cal-slot'; calSlot.append(buildJournalCalendar());
  const entriesCol = el('div', 'clean-scroll flex shrink-0 flex-col xl:w-72 xl:min-h-0 xl:overflow-y-auto'); entriesCol.id = 'journal-entries';

  const editor = el('div', 'flex min-h-0 flex-1 flex-col');
  const head = el('div', 'mb-2 flex items-center justify-between gap-2');
  head.append(el('div', 'text-sm font-semibold text-ink', fromYmd(day).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })));
  const status = el('span', 'text-xs text-ink-faint', '');
  const todayBtn = el('button', 'rounded-lg border border-edge px-2.5 py-1 text-xs font-medium text-ink-soft transition hover:text-ink', 'Today');
  todayBtn.addEventListener('click', () => selectJournalDay(ymd(new Date())));
  const right = el('div', 'flex items-center gap-2'); right.append(status, todayBtn);
  head.append(right);
  editor.append(head);

  const ta = el('textarea', 'clean-scroll max-h-[46vh] min-h-[150px] w-full flex-1 resize-none rounded-2xl border border-edge bg-panel p-4 text-sm leading-relaxed text-ink outline-none focus:border-edge-strong'); ta.id = 'journal-ta';
  ta.placeholder = 'Write freely, or tap a prompt to get started…';
  ta.maxLength = 100000;
  const kickSave = () => { status.textContent = 'Saving…'; scheduleJournalSave(day, ta.value, journalCurMood, status); };
  ta.addEventListener('input', kickSave);
  ta.addEventListener('blur', () => { if (journalSaveTimer) flushJournalSave(day, ta.value, journalCurMood, status); });

  const moodRow = el('div', 'mb-2 flex items-center gap-1');
  moodRow.append(el('span', 'mr-1 text-xs text-ink-faint', 'Mood'));
  const moodBtns = [];
  JOURNAL_MOODS.forEach(([emoji, label]) => {
    const b = el('button', 'grid h-8 w-8 place-items-center rounded-lg border border-edge text-lg transition hover:border-edge-strong'); b.type = 'button'; b.title = label; b.textContent = emoji;
    b._paint = () => { const on = journalCurMood === emoji; b.style.borderColor = on ? 'var(--accent)' : 'var(--edge)'; b.style.background = on ? 'var(--focus-tint)' : 'transparent'; };
    b.addEventListener('click', () => { journalCurMood = (journalCurMood === emoji) ? '' : emoji; moodBtns.forEach((x) => x._paint()); flushJournalSave(day, ta.value, journalCurMood, status); });
    moodBtns.push(b); moodRow.append(b);
  });
  editor.append(moodRow);

  const promptRow = el('div', 'mb-2 flex flex-wrap gap-1');
  JOURNAL_PROMPTS.forEach(([label, text]) => {
    const b = el('button', 'rounded-full border border-edge px-2.5 py-1 text-xs text-ink-soft transition hover:border-edge-strong hover:text-ink', label); b.type = 'button';
    b.addEventListener('click', () => { const pre = ta.value ? (ta.value.endsWith('\n') ? '\n' : '\n\n') : ''; ta.value += `${pre}${text}\n`; ta.focus(); ta.selectionStart = ta.selectionEnd = ta.value.length; kickSave(); });
    promptRow.append(b);
  });
  editor.append(promptRow, ta);

  const done = el('div', 'mt-2 shrink-0'); done.id = 'journal-done';
  editor.append(done);
  container.append(calSlot, entriesCol, editor); root.append(container);

  request('/journal?day=' + day).then(({ content, mood }) => { ta.value = content || ''; journalCurMood = mood || ''; moodBtns.forEach((x) => x._paint()); }).catch(() => {});
  loadJournalDays().then(() => { refreshJournalCal(); renderJournalEntriesList(); });
  renderJournalDone(done, day);
}
function renderJournalDone(container, day) {
  request('/archive').then(({ archived }) => {
    const items = (archived || []).filter((c) => c.completedAt && c.completedAt.slice(0, 10) === day);
    container.innerHTML = '';
    if (!items.length) return;
    container.append(el('div', 'mb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-faint', `✓ Completed this day · ${items.length}`));
    const list = el('div', 'flex flex-wrap gap-1');
    items.slice(0, 12).forEach((c) => list.append(el('span', 'tag-chip', c.title.length > 40 ? c.title.slice(0, 40) + '…' : c.title)));
    container.append(list);
  }).catch(() => {});
}

// ---- task detail editor (opened from list rows and kanban cards) ----
function toLocalInput(iso) { if (!iso) return ''; const d = new Date(iso); if (Number.isNaN(d.getTime())) return ''; const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; }
function openTaskModal(card) {
  const modal = $('#task-modal'); modal.innerHTML = '';
  const panel = modalShell('Task', () => closeModal('#task-modal')); panel.classList.add('max-w-md');
  const draft = { title: card.title, note: card.note || '', dueAt: card.dueAt, startAt: card.startAt || null, remindAt: card.remindAt, duration: card.duration || 0, tags: (card.tags || []).slice(), priority: card.priority || 0, recur: card.recur || '' };

  const title = el('textarea', 'field'); title.rows = 2; title.value = draft.title; title.maxLength = MAX_TITLE_LEN;
  title.addEventListener('input', () => { draft.title = title.value; });

  const noteWrap = el('div', 'mt-3');
  noteWrap.append(el('label', 'mb-1 block text-xs text-ink-soft', 'Notes'));
  const note = el('textarea', 'field'); note.rows = 3; note.value = draft.note; note.maxLength = 10000; note.placeholder = 'Add details…';
  note.addEventListener('input', () => { draft.note = note.value; });
  noteWrap.append(note);

  const startWrap = el('div', 'mt-3');
  startWrap.append(el('label', 'mb-1 block text-xs text-ink-soft', 'Start date'));
  const start = el('input', 'field'); start.type = 'datetime-local'; start.value = toLocalInput(draft.startAt);
  start.addEventListener('change', () => { draft.startAt = start.value ? new Date(start.value).toISOString() : null; });
  startWrap.append(start);

  const dueWrap = el('div', 'mt-3');
  dueWrap.append(el('label', 'mb-1 block text-xs text-ink-soft', 'Due date & time'));
  const due = el('input', 'field'); due.type = 'datetime-local'; due.value = toLocalInput(draft.dueAt);
  due.addEventListener('change', () => { draft.dueAt = due.value ? new Date(due.value).toISOString() : null; syncReminderOptions(); });
  const quickRow = el('div', 'mt-1.5 flex flex-wrap gap-1');
  const quick = (label, fn) => { const b = el('button', 'rounded-md border border-edge px-2 py-1 text-xs text-ink-soft transition hover:text-ink'); b.type = 'button'; b.textContent = label; b.addEventListener('click', () => { fn(); due.value = toLocalInput(draft.dueAt); syncReminderOptions(); }); return b; };
  const atNine = (d) => { d.setHours(9, 0, 0, 0); return d; };
  quickRow.append(
    quick('Today', () => { draft.dueAt = atNine(new Date()).toISOString(); }),
    quick('Tomorrow', () => { const d = new Date(); d.setDate(d.getDate() + 1); draft.dueAt = atNine(d).toISOString(); }),
    quick('Next week', () => { const d = new Date(); d.setDate(d.getDate() + 7); draft.dueAt = atNine(d).toISOString(); }),
    quick('Clear', () => { draft.dueAt = null; draft.remindAt = null; }),
  );
  dueWrap.append(due, quickRow);

  const remWrap = el('div', 'mt-3');
  remWrap.append(el('label', 'mb-1 block text-xs text-ink-soft', 'Reminder'));
  const rem = el('select', 'field');
  const REM_OPTS = [['', 'None'], ['0', 'At time of task'], ['10', '10 minutes before'], ['60', '1 hour before'], ['1440', '1 day before']];
  REM_OPTS.forEach(([v, l]) => { const o = el('option', '', l); o.value = v; rem.append(o); });
  rem.addEventListener('change', () => { draft.remindAt = computeRemind(draft.dueAt, rem.value); });
  function computeRemind(dueIso, minsStr) { if (!dueIso || minsStr === '') return null; const d = new Date(dueIso); d.setMinutes(d.getMinutes() - parseInt(minsStr, 10)); return d.toISOString(); }
  function syncReminderOptions() {
    rem.disabled = !draft.dueAt;
    if (!draft.dueAt) { rem.value = ''; draft.remindAt = null; return; }
    if (draft.remindAt) { const diff = Math.round((new Date(draft.dueAt) - new Date(draft.remindAt)) / 60000); rem.value = ['0', '10', '60', '1440'].includes(String(diff)) ? String(diff) : '0'; }
    else rem.value = '';
  }
  remWrap.append(rem);

  const durWrap = el('div', 'mt-3');
  durWrap.append(el('label', 'mb-1 block text-xs text-ink-soft', 'Estimate'));
  const durRow = el('div', 'flex flex-wrap gap-1');
  const durInput = el('input', 'field w-24'); durInput.type = 'number'; durInput.min = '0'; durInput.step = '5'; durInput.value = draft.duration || ''; durInput.placeholder = 'min';
  durInput.addEventListener('input', () => { draft.duration = parseInt(durInput.value, 10) || 0; });
  const durQuick = (label, mins) => { const b = el('button', 'rounded-md border border-edge px-2 py-1 text-xs text-ink-soft transition hover:text-ink', label); b.type = 'button'; b.addEventListener('click', () => { draft.duration = mins; durInput.value = mins || ''; }); return b; };
  durRow.append(durInput, durQuick('15m', 15), durQuick('30m', 30), durQuick('1h', 60), durQuick('2h', 120), durQuick('None', 0));
  durWrap.append(durRow);

  const prioWrap = el('div', 'mt-3');
  prioWrap.append(el('label', 'mb-1 block text-xs text-ink-soft', 'Priority'));
  const pRow = el('div', 'flex gap-1.5');
  PRIORITY_LABEL.forEach((label, p) => {
    const b = el('button', 'flex-1 rounded-lg border border-edge px-2 py-1.5 text-xs font-medium transition'); b.type = 'button'; b.textContent = label;
    const paint = () => { const on = draft.priority === p; b.style.borderColor = on ? (PRIORITY_HEX[p] || 'var(--edge-strong)') : 'var(--edge)'; b.style.color = on ? (PRIORITY_HEX[p] || 'var(--ink)') : 'var(--ink-soft)'; };
    b.addEventListener('click', () => { draft.priority = p; [...pRow.children].forEach((c, i) => c._paint && c._paint()); }); b._paint = paint; paint();
    pRow.append(b);
  });
  prioWrap.append(pRow);

  const tagWrap = el('div', 'mt-3');
  tagWrap.append(el('label', 'mb-1 block text-xs text-ink-soft', 'Tags (space or comma separated)'));
  const tagIn = el('input', 'field'); tagIn.value = draft.tags.join(' '); tagIn.placeholder = 'merlin work';
  tagIn.addEventListener('input', () => { draft.tags = tagIn.value.split(/[\s,]+/).map((t) => t.replace(/^#/, '').toLowerCase()).filter(Boolean); });
  tagWrap.append(tagIn);

  const recWrap = el('div', 'mt-3');
  recWrap.append(el('label', 'mb-1 block text-xs text-ink-soft', 'Repeat'));
  const rec = el('select', 'field');
  [['', 'Does not repeat'], ['daily', 'Every day'], ['weekday', 'Every weekday'], ['weekly', 'Every week'], ['biweekly', 'Every 2 weeks'], ['monthly', 'Every month'], ['yearly', 'Every year']].forEach(([v, l]) => { const o = el('option', '', l); o.value = v; rec.append(o); });
  rec.value = draft.recur; rec.addEventListener('change', () => { draft.recur = rec.value; });
  recWrap.append(rec);

  syncReminderOptions();

  const err = el('p', 'mt-2 hidden text-xs text-red-400');
  const save = el('button', 'btn-accent mt-4 w-full rounded-lg px-4 py-2 text-sm font-semibold transition hover:opacity-90', 'Save');
  save.addEventListener('click', async () => {
    const body = { title: draft.title.trim() || card.title, note: draft.note, dueAt: draft.dueAt, startAt: draft.startAt, remindAt: draft.remindAt, duration: draft.duration, tags: draft.tags, priority: draft.priority, recur: draft.recur };
    try {
      await request(`/cards/${card.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      closeModal('#task-modal'); await loadActive(); if (currentBoard) await loadCards(); renderCurrentView(); renderSidebar(); toast('Saved');
    } catch (e) { err.textContent = e.message; err.classList.remove('hidden'); }
  });

  const actions = el('div', 'mt-2 flex gap-2');
  const done = el('button', 'flex-1 rounded-lg border border-edge px-3 py-2 text-xs font-medium text-ink-soft transition hover:text-ink', '✓ Complete');
  done.addEventListener('click', () => { closeModal('#task-modal'); completeCard(card.id); });
  const del = el('button', 'flex-1 rounded-lg border border-edge px-3 py-2 text-xs font-medium text-red-400 transition hover:bg-edge', 'Delete');
  del.addEventListener('click', async () => { if (!confirm(`Delete "${card.title}"?`)) return; try { await request(`/cards/${card.id}`, { method: 'DELETE' }); closeModal('#task-modal'); await loadActive(); if (currentBoard) await loadCards(); renderCurrentView(); renderSidebar(); toast('Deleted'); } catch (e) { handleApiError(e); } });
  actions.append(done, del);

  panel.append(title, noteWrap, startWrap, dueWrap, remWrap, durWrap, prioWrap, tagWrap, recWrap, err, save, actions);
  modal.append(panel); openModal('#task-modal');
}

// ---- push reminders ----
function initPush() {
  pushState.supported = ('serviceWorker' in navigator) && ('PushManager' in window) && ('Notification' in window);
  request('/push/config').then((cfg) => { pushState.publicKey = cfg.publicKey || ''; pushState.serverEnabled = !!cfg.enabled; }).catch(() => {});
  if (pushState.supported) navigator.serviceWorker.ready.then((reg) => reg.pushManager.getSubscription()).then((sub) => { pushState.enabled = !!sub; renderUserMenu(); }).catch(() => {});
}
function urlB64ToUint8Array(b64) { const pad = '='.repeat((4 - (b64.length % 4)) % 4); const s = (b64 + pad).replace(/-/g, '+').replace(/_/g, '/'); const raw = atob(s); const arr = new Uint8Array(raw.length); for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i); return arr; }
async function enableReminders() {
  if (!pushState.supported) return toast('This browser can’t do reminders');
  if (!pushState.publicKey) return toast('Push isn’t configured on the server');
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return toast('Allow notifications to get reminders');
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(pushState.publicKey) });
    await request('/push/subscribe', { method: 'POST', body: JSON.stringify({ subscription: sub }) });
    pushState.enabled = true; renderUserMenu(); toast('Reminders enabled ✓');
  } catch (err) { toast('Could not enable reminders'); }
}
async function disableReminders() {
  try { const reg = await navigator.serviceWorker.ready; const sub = await reg.pushManager.getSubscription(); if (sub) { await request('/push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint: sub.endpoint }) }); await sub.unsubscribe(); } pushState.enabled = false; renderUserMenu(); toast('Reminders off'); } catch (_) {}
}

// ------------------------------------------------------------
// Pomodoro focus timer
// ------------------------------------------------------------
const pomo = { mode: 'focus', remaining: 25 * 60, running: false, timer: null, focusMin: 25, breakMin: 5 };
function fmtClock(s) { s = Math.max(0, Math.round(s)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; }
function pomoSessionsKey() { return 'tf-pomo-' + ymd(new Date()); }
function getPomoSessions() { try { return parseInt(localStorage.getItem(pomoSessionsKey()) || '0', 10) || 0; } catch (_) { return 0; } }
function addPomoSession() { try { localStorage.setItem(pomoSessionsKey(), String(getPomoSessions() + 1)); } catch (_) {} }
function notifyPomo(title, body) { try { if ('Notification' in window && Notification.permission === 'granted') new Notification(title, { body, icon: '/icon-192.png' }); } catch (_) {} }
function pomoRender() {
  const label = $('#pomodoro-label'); if (label) { if (pomo.running) { label.classList.remove('hidden'); label.textContent = fmtClock(pomo.remaining); } else label.classList.add('hidden'); }
  const btn = $('#pomodoro-btn'); if (btn) btn.style.borderColor = pomo.running ? (pomo.mode === 'focus' ? 'var(--accent)' : '#34d399') : '';
  const clock = $('#pomo-clock'); if (clock) clock.textContent = fmtClock(pomo.remaining);
  const md = $('#pomo-mode'); if (md) md.textContent = pomo.mode === 'focus' ? 'Focus' : 'Break';
  const sc = $('#pomo-sessions'); if (sc) sc.textContent = String(getPomoSessions());
  const sb = $('#pomo-startbtn'); if (sb) sb.textContent = pomo.running ? 'Pause' : 'Start';
}
function setPomoMode(m) { pomo.mode = m; pomo.remaining = (m === 'focus' ? pomo.focusMin : pomo.breakMin) * 60; }
function pomoTick() {
  pomo.remaining--;
  if (pomo.remaining <= 0) {
    if (pomo.mode === 'focus') { addPomoSession(); toast('🍅 Focus done — take a break'); notifyPomo('Break time', 'Focus session complete — take a break.'); setPomoMode('break'); }
    else { toast('Break over — back to focus'); notifyPomo('Back to focus', 'Break over — start your next session.'); setPomoMode('focus'); }
  }
  pomoRender();
}
function pomoStart() { if (pomo.running) return; pomo.running = true; pomo.timer = setInterval(pomoTick, 1000); pomoRender(); }
function pomoPause() { pomo.running = false; if (pomo.timer) { clearInterval(pomo.timer); pomo.timer = null; } pomoRender(); }
function pomoToggle() { pomo.running ? pomoPause() : pomoStart(); }
function pomoReset() { pomoPause(); pomo.remaining = (pomo.mode === 'focus' ? pomo.focusMin : pomo.breakMin) * 60; pomoRender(); }
function pomoSkip() { setPomoMode(pomo.mode === 'focus' ? 'break' : 'focus'); pomoRender(); }
function openPomodoro() {
  const modal = $('#pomodoro-modal'); modal.innerHTML = '';
  const panel = modalShell('Pomodoro', () => closeModal('#pomodoro-modal')); panel.classList.add('max-w-xs', 'text-center');
  const mode = el('div', 'text-xs font-semibold uppercase tracking-[0.3em] text-ink-faint'); mode.id = 'pomo-mode';
  const clock = el('div', 'my-3 text-6xl font-extrabold tabular-nums text-ink-strong'); clock.id = 'pomo-clock';
  const row = el('div', 'flex justify-center gap-2');
  const startBtn = el('button', 'btn-accent rounded-lg px-5 py-2 text-sm font-semibold', 'Start'); startBtn.id = 'pomo-startbtn'; startBtn.addEventListener('click', pomoToggle);
  const resetBtn = el('button', 'rounded-lg border border-edge px-4 py-2 text-sm text-ink-soft transition hover:text-ink', 'Reset'); resetBtn.addEventListener('click', pomoReset);
  const skipBtn = el('button', 'rounded-lg border border-edge px-4 py-2 text-sm text-ink-soft transition hover:text-ink', 'Skip'); skipBtn.addEventListener('click', pomoSkip);
  row.append(startBtn, resetBtn, skipBtn);
  const setRow = el('div', 'mt-4 flex items-center justify-center gap-4 text-xs text-ink-soft');
  const mkNum = (label, val, onCh) => { const w = el('label', 'flex items-center gap-1'); const i = el('input', 'field w-14 text-center'); i.type = 'number'; i.min = '1'; i.value = String(val); i.addEventListener('change', () => onCh(parseInt(i.value, 10) || val)); w.append(i, el('span', '', label)); return w; };
  setRow.append(
    mkNum('focus', pomo.focusMin, (v) => { pomo.focusMin = v; try { localStorage.setItem('tf-pomo-focus', String(v)); } catch (_) {} if (!pomo.running && pomo.mode === 'focus') { pomo.remaining = v * 60; pomoRender(); } }),
    mkNum('break', pomo.breakMin, (v) => { pomo.breakMin = v; try { localStorage.setItem('tf-pomo-break', String(v)); } catch (_) {} if (!pomo.running && pomo.mode === 'break') { pomo.remaining = v * 60; pomoRender(); } }),
  );
  const stats = el('div', 'mt-4 text-xs text-ink-faint'); stats.append(document.createTextNode('🍅 Completed today: '));
  const scount = el('span', 'font-semibold text-ink'); scount.id = 'pomo-sessions'; stats.append(scount);
  panel.append(mode, clock, row, setRow, stats);
  modal.append(panel); openModal('#pomodoro-modal'); pomoRender();
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
  if (!currentUser || ui.draggingId || ui.editingLabel || ui.editingCard || ui.editingSubtask || ui.subtaskAdding) return;
  try {
    if (currentView.kind === 'board' && currentBoard) {
      const { cards } = await request(`/boards/${currentBoard.id}/cards`);
      if (JSON.stringify(cards) !== JSON.stringify(state.cards)) { state.cards = cards; render(); }
    }
    const { cards: ac } = await request('/active');
    if (JSON.stringify(ac) !== JSON.stringify(allCards)) { allCards = ac; renderSidebar(); if (!['board', 'journal', 'habits', 'timeline'].includes(currentView.kind)) renderListView(); }
  } catch (err) { if (err.status === 401) forceReauth(); }
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
  // Sidebar drawer (mobile) + view controls
  const st = $('#sidebar-toggle'); if (st) st.addEventListener('click', openSidebarDrawer);
  const sb = $('#sidebar-backdrop'); if (sb) sb.addEventListener('click', closeSidebarDrawer);
  const ap = $('#add-project-btn'); if (ap) ap.addEventListener('click', () => openBoardEditor(null));
  const af = $('#add-filter-btn'); if (af) af.addEventListener('click', () => openFilterEditor(null));
  try { pomo.focusMin = parseInt(localStorage.getItem('tf-pomo-focus'), 10) || 25; pomo.breakMin = parseInt(localStorage.getItem('tf-pomo-break'), 10) || 5; pomo.remaining = pomo.focusMin * 60; } catch (_) {}
  const pb = $('#pomodoro-btn'); if (pb) pb.addEventListener('click', openPomodoro);
  const ft = $('#focus-toggle'); if (ft) ft.addEventListener('click', () => { focusViewOn = !focusViewOn; try { localStorage.setItem('tf-focusview', focusViewOn ? '1' : '0'); } catch (_) {} applyViewLayout(); if (currentView.kind === 'board') render(); });
  const search = $('#header-search'); if (search) search.addEventListener('input', () => {
    searchQuery = search.value.trim();
    if (searchQuery) { if (currentView.kind !== 'search') setView({ kind: 'search' }); else { renderHeaderForView(); renderListView(); } }
    else if (currentView.kind === 'search') setView({ kind: 'today' });
  });
  $('#auth-form').addEventListener('submit', submitAuth);
  $('#auth-toggle').addEventListener('click', () => setAuthMode(authMode === 'login' ? 'register' : 'login'));
  $('#auth-forgot').addEventListener('click', () => setAuthMode('recover'));
  $$('.modal-backdrop').forEach((m) => m.addEventListener('click', (e) => { if (e.target === m) { m.classList.add('hidden'); m.classList.remove('flex'); } }));
  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  initEasterEgg();
  bootstrap();
}
document.addEventListener('DOMContentLoaded', init);
