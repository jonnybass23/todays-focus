/**
 * Today's Focus — data layer (SQLite via Node's built-in `node:sqlite`).
 *
 * Multi-board: each user has one or more boards. A board has its own columns
 * (JSON), its own focus label, and its own single focused card. Cards belong
 * to a board. Requires Node >= 22.5 (built-in sqlite). Tested on Node 24.
 */
'use strict';

const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const nowIso = () => new Date().toISOString();
const uuid = () => crypto.randomUUID();
const newToken = () => 'tf_' + crypto.randomBytes(24).toString('hex');
const safeJson = (s, fallback) => { try { return JSON.parse(s); } catch { return fallback; } };
const normCode = (c) => String(c == null ? '' : c).replace(/[^a-z0-9]/gi, '').toLowerCase(); // forgiving: ignore dashes/spaces/case
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

function createStore(dbPath, defaults) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, username TEXT NOT NULL, username_lower TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user', api_token TEXT UNIQUE,
      token_version INTEGER NOT NULL DEFAULT 0, theme TEXT NOT NULL DEFAULT 'dark',
      labels TEXT NOT NULL DEFAULT '{}', filters TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS boards (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, icon TEXT NOT NULL DEFAULT '',
      focus_label TEXT NOT NULL DEFAULT 'Focus', columns TEXT NOT NULL DEFAULT '[]',
      streak INTEGER NOT NULL DEFAULT 0, spotlight INTEGER NOT NULL DEFAULT 0,
      pinned INTEGER NOT NULL DEFAULT 0, position REAL NOT NULL DEFAULT 0,
      last_used_at TEXT, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_boards_user ON boards(user_id);
    CREATE TABLE IF NOT EXISTS cards (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, board_id TEXT, title TEXT NOT NULL, type TEXT NOT NULL,
      focused INTEGER NOT NULL DEFAULT 0, position REAL NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0,
      subtasks TEXT NOT NULL DEFAULT '[]', priority INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
      due_at TEXT, remind_at TEXT, reminded INTEGER NOT NULL DEFAULT 0,
      tags TEXT NOT NULL DEFAULT '[]', recur TEXT NOT NULL DEFAULT '', completed_at TEXT,
      note TEXT NOT NULL DEFAULT '', start_at TEXT, duration INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS app_settings ( key TEXT PRIMARY KEY, value TEXT );
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      endpoint TEXT PRIMARY KEY, user_id TEXT NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id);
    CREATE TABLE IF NOT EXISTS focus_history (
      user_id TEXT NOT NULL, day TEXT NOT NULL, title TEXT NOT NULL, card_id TEXT,
      updated_at TEXT NOT NULL, PRIMARY KEY (user_id, day)
    );
    CREATE TABLE IF NOT EXISTS recovery_codes (
      user_id TEXT NOT NULL, code_hash TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_recovery_user ON recovery_codes(user_id);
    CREATE TABLE IF NOT EXISTS journal_entries (
      user_id TEXT NOT NULL, day TEXT NOT NULL, content TEXT NOT NULL DEFAULT '', mood TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, day)
    );
    CREATE TABLE IF NOT EXISTS habits (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, icon TEXT NOT NULL DEFAULT '✅',
      color TEXT NOT NULL DEFAULT '#34d399', position REAL NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_habits_user ON habits(user_id);
    CREATE TABLE IF NOT EXISTS habit_checkins (
      habit_id TEXT NOT NULL, day TEXT NOT NULL, PRIMARY KEY (habit_id, day)
    );
  `);

  // --- lightweight migrations for pre-existing databases ---
  const cardCols = db.prepare('PRAGMA table_info(cards)').all().map((c) => c.name);
  if (!cardCols.includes('position')) { db.exec('ALTER TABLE cards ADD COLUMN position REAL NOT NULL DEFAULT 0'); db.exec('UPDATE cards SET position = rowid'); }
  if (!cardCols.includes('archived')) db.exec('ALTER TABLE cards ADD COLUMN archived INTEGER NOT NULL DEFAULT 0');
  if (!cardCols.includes('board_id')) db.exec('ALTER TABLE cards ADD COLUMN board_id TEXT');
  if (!cardCols.includes('subtasks')) db.exec("ALTER TABLE cards ADD COLUMN subtasks TEXT NOT NULL DEFAULT '[]'");
  if (!cardCols.includes('priority')) db.exec('ALTER TABLE cards ADD COLUMN priority INTEGER NOT NULL DEFAULT 0');
  if (!cardCols.includes('due_at')) db.exec('ALTER TABLE cards ADD COLUMN due_at TEXT');
  if (!cardCols.includes('remind_at')) db.exec('ALTER TABLE cards ADD COLUMN remind_at TEXT');
  if (!cardCols.includes('reminded')) db.exec('ALTER TABLE cards ADD COLUMN reminded INTEGER NOT NULL DEFAULT 0');
  if (!cardCols.includes('tags')) db.exec("ALTER TABLE cards ADD COLUMN tags TEXT NOT NULL DEFAULT '[]'");
  if (!cardCols.includes('recur')) db.exec("ALTER TABLE cards ADD COLUMN recur TEXT NOT NULL DEFAULT ''");
  if (!cardCols.includes('completed_at')) db.exec('ALTER TABLE cards ADD COLUMN completed_at TEXT');
  if (!cardCols.includes('note')) db.exec("ALTER TABLE cards ADD COLUMN note TEXT NOT NULL DEFAULT ''");
  if (!cardCols.includes('start_at')) db.exec('ALTER TABLE cards ADD COLUMN start_at TEXT');
  if (!cardCols.includes('duration')) db.exec('ALTER TABLE cards ADD COLUMN duration INTEGER NOT NULL DEFAULT 0');
  const journalCols = db.prepare('PRAGMA table_info(journal_entries)').all().map((c) => c.name);
  if (journalCols.length && !journalCols.includes('mood')) db.exec("ALTER TABLE journal_entries ADD COLUMN mood TEXT NOT NULL DEFAULT ''");
  const userCols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!userCols.includes('timezone')) db.exec("ALTER TABLE users ADD COLUMN timezone TEXT NOT NULL DEFAULT ''");
  if (!userCols.includes('boards_seed')) db.exec('ALTER TABLE users ADD COLUMN boards_seed INTEGER NOT NULL DEFAULT 0');
  if (!userCols.includes('filters')) db.exec("ALTER TABLE users ADD COLUMN filters TEXT NOT NULL DEFAULT '[]'");
  db.exec("UPDATE users SET theme = 'cardboard' WHERE theme = 'wood'");
  db.exec('CREATE INDEX IF NOT EXISTS idx_cards_board ON cards(board_id)'); // after board_id exists
  const boardCols = db.prepare('PRAGMA table_info(boards)').all().map((c) => c.name);
  if (!boardCols.includes('spotlight')) db.exec('ALTER TABLE boards ADD COLUMN spotlight INTEGER NOT NULL DEFAULT 0');
  if (!boardCols.includes('last_used_at')) db.exec('ALTER TABLE boards ADD COLUMN last_used_at TEXT');
  if (!boardCols.includes('pinned')) {
    db.exec('ALTER TABLE boards ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0');
    // pin each user's original (earliest) board — that's their "Today's Focus"
    db.exec('UPDATE boards SET pinned = 1 WHERE id IN (SELECT id FROM boards b WHERE b.created_at = (SELECT MIN(created_at) FROM boards b2 WHERE b2.user_id = b.user_id))');
  }

  const insertBoardSql = db.prepare(`INSERT INTO boards (id, user_id, name, icon, focus_label, columns, streak, spotlight, pinned, position, last_used_at, created_at)
                                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  function makeDefaultBoard(userId, labels) {
    const cols = (defaults.focusColumns || []).map((c) => ({ ...c, label: (labels && labels[c.key]) || c.label }));
    const id = uuid(), ts = nowIso();
    insertBoardSql.run(id, userId, "Today's Focus", '🎯', "Today's Focus", JSON.stringify(cols), 1, 0, 1, 0, ts, ts);
    return id;
  }
  const boardNameExists = db.prepare('SELECT 1 AS x FROM boards WHERE user_id = ? AND name = ? LIMIT 1');
  const nextBoardPosFor = db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM boards WHERE user_id = ?');
  function seedExtraBoards(userId) {
    for (const t of (defaults.seedBoards || [])) {
      if (boardNameExists.get(userId, t.name)) continue; // never duplicate an existing board of the same name
      insertBoardSql.run(uuid(), userId, t.name, t.icon || '🗂️', t.focusLabel || 'Focus', JSON.stringify(t.columns || []),
        t.streak ? 1 : 0, t.spotlight ? 1 : 0, 0, nextBoardPosFor.get(userId).p, null, nowIso());
    }
  }
  // Give every existing user a default board (+ attach loose cards), then seed the extra boards once.
  for (const u of db.prepare('SELECT u.id, u.labels FROM users u WHERE NOT EXISTS (SELECT 1 FROM boards b WHERE b.user_id = u.id)').all()) {
    const bid = makeDefaultBoard(u.id, safeJson(u.labels, {}));
    db.prepare("UPDATE cards SET board_id = ? WHERE user_id = ? AND (board_id IS NULL OR board_id = '')").run(bid, u.id);
  }
  for (const u of db.prepare('SELECT id FROM users WHERE boards_seed < 1').all()) {
    seedExtraBoards(u.id);
    db.prepare('UPDATE users SET boards_seed = 1 WHERE id = ?').run(u.id);
  }

  const stmt = {
    insertUser: db.prepare(`INSERT INTO users (id, username, username_lower, password_hash, role, api_token, token_version, theme, labels, created_at)
                            VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`),
    userById: db.prepare('SELECT * FROM users WHERE id = ?'),
    userByLower: db.prepare('SELECT * FROM users WHERE username_lower = ?'),
    userByToken: db.prepare('SELECT * FROM users WHERE api_token = ?'),
    countUsers: db.prepare('SELECT COUNT(*) AS n FROM users'),
    countAdmins: db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'"),
    listUsers: db.prepare('SELECT id, username, role, created_at FROM users ORDER BY created_at ASC'),
    setPassword: db.prepare('UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?'),
    setToken: db.prepare('UPDATE users SET api_token = ? WHERE id = ?'),
    setTheme: db.prepare('UPDATE users SET theme = ? WHERE id = ?'),
    setTimezone: db.prepare('UPDATE users SET timezone = ? WHERE id = ?'),
    getFilters: db.prepare('SELECT filters FROM users WHERE id = ?'),
    setFilters: db.prepare('UPDATE users SET filters = ? WHERE id = ?'),
    setUsername: db.prepare('UPDATE users SET username = ?, username_lower = ? WHERE id = ?'),
    deleteUser: db.prepare('DELETE FROM users WHERE id = ?'),

    boardsByUser: db.prepare('SELECT * FROM boards WHERE user_id = ? ORDER BY pinned DESC, (last_used_at IS NULL) ASC, last_used_at DESC, position ASC, created_at ASC'),
    boardById: db.prepare('SELECT * FROM boards WHERE id = ? AND user_id = ?'),
    countBoards: db.prepare('SELECT COUNT(*) AS n FROM boards WHERE user_id = ?'),
    nextBoardPos: db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM boards WHERE user_id = ?'),
    updateBoard: db.prepare('UPDATE boards SET name = ?, icon = ?, focus_label = ?, columns = ?, streak = ?, spotlight = ? WHERE id = ? AND user_id = ?'),
    touchBoard: db.prepare('UPDATE boards SET last_used_at = ? WHERE id = ? AND user_id = ?'),
    setBoardPos: db.prepare('UPDATE boards SET position = ? WHERE id = ? AND user_id = ?'),
    deleteBoard: db.prepare('DELETE FROM boards WHERE id = ? AND user_id = ?'),
    deleteBoardCards: db.prepare('DELETE FROM cards WHERE board_id = ?'),
    deleteUserBoards: db.prepare('DELETE FROM boards WHERE user_id = ?'),

    cardsByBoard: db.prepare('SELECT * FROM cards WHERE board_id = ? AND archived = 0 ORDER BY position ASC, created_at ASC'),
    activeByUser: db.prepare('SELECT * FROM cards WHERE user_id = ? AND archived = 0 ORDER BY (due_at IS NULL) ASC, due_at ASC, position ASC, created_at ASC'),
    dueReminders: db.prepare("SELECT * FROM cards WHERE archived = 0 AND reminded = 0 AND remind_at IS NOT NULL AND remind_at != '' AND remind_at <= ?"),
    markReminded: db.prepare('UPDATE cards SET reminded = 1 WHERE id = ?'),
    archivedByUser: db.prepare('SELECT * FROM cards WHERE user_id = ? AND archived = 1 ORDER BY created_at DESC'),
    countUserCards: db.prepare('SELECT COUNT(*) AS n FROM cards WHERE user_id = ?'),
    cardById: db.prepare('SELECT * FROM cards WHERE id = ? AND user_id = ?'),
    nextCardPos: db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM cards WHERE board_id = ? AND type = ? AND archived = 0'),
    insertCard: db.prepare('INSERT INTO cards (id, user_id, board_id, title, type, focused, position, subtasks, priority, archived, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?)'),
    updateCard: db.prepare('UPDATE cards SET title = ?, type = ?, focused = ?, subtasks = ?, priority = ?, due_at = ?, remind_at = ?, reminded = ?, tags = ?, recur = ?, note = ?, start_at = ?, duration = ? WHERE id = ? AND user_id = ?'),
    moveCardBoard: db.prepare('UPDATE cards SET board_id = ?, type = ?, position = ?, focused = 0 WHERE id = ? AND user_id = ?'),
    reorderCard: db.prepare('UPDATE cards SET type = ?, position = ?, focused = 0 WHERE id = ? AND user_id = ? AND archived = 0'),
    clearFocus: db.prepare('UPDATE cards SET focused = 0 WHERE board_id = ? AND id != ?'),
    archiveCard: db.prepare('UPDATE cards SET archived = 1, focused = 0, completed_at = ? WHERE id = ? AND user_id = ?'),
    restoreCard: db.prepare('UPDATE cards SET archived = 0, focused = 0, completed_at = NULL, position = ? WHERE id = ? AND user_id = ?'),
    deleteCard: db.prepare('DELETE FROM cards WHERE id = ? AND user_id = ?'),
    deleteUserCards: db.prepare('DELETE FROM cards WHERE user_id = ?'),

    getSetting: db.prepare('SELECT value FROM app_settings WHERE key = ?'),
    setSetting: db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'),
    logFocus: db.prepare(`INSERT INTO focus_history (user_id, day, title, card_id, updated_at) VALUES (?, ?, ?, ?, ?)
                          ON CONFLICT(user_id, day) DO UPDATE SET title = excluded.title, card_id = excluded.card_id, updated_at = excluded.updated_at`),
    historyByUser: db.prepare('SELECT day, title, card_id FROM focus_history WHERE user_id = ? ORDER BY day DESC LIMIT ?'),
    historyDays: db.prepare('SELECT day FROM focus_history WHERE user_id = ?'),
    deleteUserHistory: db.prepare('DELETE FROM focus_history WHERE user_id = ?'),

    insertRecovery: db.prepare('INSERT INTO recovery_codes (user_id, code_hash, created_at) VALUES (?, ?, ?)'),
    deleteUserRecovery: db.prepare('DELETE FROM recovery_codes WHERE user_id = ?'),
    countRecovery: db.prepare('SELECT COUNT(*) AS n FROM recovery_codes WHERE user_id = ?'),
    findRecovery: db.prepare('SELECT rowid AS rid FROM recovery_codes WHERE user_id = ? AND code_hash = ? LIMIT 1'),
    deleteRecoveryRow: db.prepare('DELETE FROM recovery_codes WHERE rowid = ?'),

    upsertSub: db.prepare(`INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)
                           ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`),
    subsByUser: db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?'),
    allSubs: db.prepare('SELECT * FROM push_subscriptions'),
    deleteSub: db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?'),
    deleteUserSubs: db.prepare('DELETE FROM push_subscriptions WHERE user_id = ?'),

    habitsByUser: db.prepare('SELECT * FROM habits WHERE user_id = ? AND archived = 0 ORDER BY position ASC, created_at ASC'),
    habitById: db.prepare('SELECT * FROM habits WHERE id = ? AND user_id = ?'),
    insertHabit: db.prepare('INSERT INTO habits (id, user_id, name, icon, color, position, archived, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)'),
    updateHabitStmt: db.prepare('UPDATE habits SET name = ?, icon = ?, color = ? WHERE id = ? AND user_id = ?'),
    deleteHabitStmt: db.prepare('DELETE FROM habits WHERE id = ? AND user_id = ?'),
    nextHabitPos: db.prepare('SELECT COALESCE(MAX(position),0)+1 AS p FROM habits WHERE user_id = ?'),
    checkinsByUser: db.prepare('SELECT hc.habit_id, hc.day FROM habit_checkins hc JOIN habits h ON h.id = hc.habit_id WHERE h.user_id = ? AND hc.day >= ?'),
    checkinExists: db.prepare('SELECT 1 AS x FROM habit_checkins WHERE habit_id = ? AND day = ?'),
    insertCheckin: db.prepare('INSERT OR IGNORE INTO habit_checkins (habit_id, day) VALUES (?, ?)'),
    deleteCheckin: db.prepare('DELETE FROM habit_checkins WHERE habit_id = ? AND day = ?'),
    deleteHabitCheckins: db.prepare('DELETE FROM habit_checkins WHERE habit_id = ?'),
    deleteUserHabits: db.prepare('DELETE FROM habits WHERE user_id = ?'),
    deleteUserHabitCheckins: db.prepare('DELETE FROM habit_checkins WHERE habit_id IN (SELECT id FROM habits WHERE user_id = ?)'),

    upsertJournal: db.prepare(`INSERT INTO journal_entries (user_id, day, content, mood, updated_at) VALUES (?, ?, ?, ?, ?)
                               ON CONFLICT(user_id, day) DO UPDATE SET content = excluded.content, mood = excluded.mood, updated_at = excluded.updated_at`),
    getJournal: db.prepare('SELECT content, mood FROM journal_entries WHERE user_id = ? AND day = ?'),
    journalDays: db.prepare("SELECT day, content, mood FROM journal_entries WHERE user_id = ? AND (content != '' OR mood != '') ORDER BY day DESC"),
    deleteJournalDay: db.prepare('DELETE FROM journal_entries WHERE user_id = ? AND day = ?'),
    deleteUserJournal: db.prepare('DELETE FROM journal_entries WHERE user_id = ?'),
  };

  const rowToCard = (r) => ({ id: r.id, boardId: r.board_id, title: r.title, type: r.type, focused: !!r.focused, position: r.position, subtasks: safeJson(r.subtasks, []), priority: r.priority || 0, dueAt: r.due_at || null, remindAt: r.remind_at || null, reminded: !!r.reminded, tags: safeJson(r.tags, []), recur: r.recur || '', completedAt: r.completed_at || null, note: r.note || '', startAt: r.start_at || null, duration: r.duration || 0, createdAt: r.created_at });
  const rowToBoard = (r) => ({ id: r.id, name: r.name, icon: r.icon, focusLabel: r.focus_label, columns: safeJson(r.columns, []), streak: !!r.streak, spotlight: !!r.spotlight, pinned: !!r.pinned, lastUsedAt: r.last_used_at, position: r.position });
  const publicUser = (r) => r ? { id: r.id, username: r.username, role: r.role, theme: r.theme, timezone: r.timezone || '', createdAt: r.created_at } : null;

  return {
    db,
    publicUser,

    // ---- users ----
    countUsers: () => stmt.countUsers.get().n,
    countAdmins: () => stmt.countAdmins.get().n,
    listUsers: () => stmt.listUsers.all(),
    getUserById: (id) => stmt.userById.get(id),
    getUserByUsername: (u) => stmt.userByLower.get(String(u).toLowerCase()),
    getUserByToken: (t) => (t ? stmt.userByToken.get(t) : undefined),
    createUser({ username, passwordHash, role = 'user', theme = defaults.theme }) {
      const id = uuid();
      stmt.insertUser.run(id, username, username.toLowerCase(), passwordHash, role, newToken(), theme, '{}', nowIso());
      makeDefaultBoard(id, defaults.labels); // pinned "Today's Focus"
      seedExtraBoards(id);                    // Quotes, Affirmations, Books, Games, Routines
      db.prepare('UPDATE users SET boards_seed = 1 WHERE id = ?').run(id);
      return stmt.userById.get(id);
    },
    setPassword: (id, hash) => stmt.setPassword.run(hash, id),
    regenerateToken(id) { const t = newToken(); stmt.setToken.run(t, id); return t; },
    setTheme: (id, theme) => stmt.setTheme.run(theme, id),
    setTimezone: (id, tz) => stmt.setTimezone.run(tz, id),
    getFilters: (id) => safeJson((stmt.getFilters.get(id) || {}).filters, []),
    setFilters: (id, arr) => stmt.setFilters.run(JSON.stringify(Array.isArray(arr) ? arr : []), id),
    changeUsername(id, username) { stmt.setUsername.run(username, username.toLowerCase(), id); },
    deleteUser(id) { stmt.deleteUserHabitCheckins.run(id); stmt.deleteUserHabits.run(id); stmt.deleteUserCards.run(id); stmt.deleteUserBoards.run(id); stmt.deleteUserHistory.run(id); stmt.deleteUserRecovery.run(id); stmt.deleteUserSubs.run(id); stmt.deleteUserJournal.run(id); stmt.deleteUser.run(id); },

    // ---- recovery codes (single-use, stored only as hashes) ----
    setRecoveryCodes(userId, codes) {
      stmt.deleteUserRecovery.run(userId);
      const ts = nowIso();
      for (const c of codes) stmt.insertRecovery.run(userId, sha256(normCode(c)), ts);
    },
    countRecoveryCodes: (userId) => stmt.countRecovery.get(userId).n,
    consumeRecoveryCode(userId, code) {
      const row = stmt.findRecovery.get(userId, sha256(normCode(code)));
      if (!row) return false;
      stmt.deleteRecoveryRow.run(row.rid);
      return true;
    },

    // ---- boards ----
    getBoards: (userId) => stmt.boardsByUser.all(userId).map(rowToBoard),
    getBoard: (userId, id) => { const r = stmt.boardById.get(id, userId); return r ? rowToBoard(r) : null; },
    countBoards: (userId) => stmt.countBoards.get(userId).n,
    createBoard(userId, { name, icon = '🗂️', focusLabel = 'Focus', columns = [], streak = false, spotlight = false }) {
      const id = uuid(), ts = nowIso();
      insertBoardSql.run(id, userId, name, icon, focusLabel, JSON.stringify(columns), streak ? 1 : 0, spotlight ? 1 : 0, 0, stmt.nextBoardPos.get(userId).p, ts, ts);
      return rowToBoard(stmt.boardById.get(id, userId));
    },
    updateBoard(userId, id, fields) {
      const cur = stmt.boardById.get(id, userId);
      if (!cur) return null;
      const name = fields.name != null ? fields.name : cur.name;
      const icon = fields.icon != null ? fields.icon : cur.icon;
      const focusLabel = fields.focusLabel != null ? fields.focusLabel : cur.focus_label;
      const columns = fields.columns != null ? JSON.stringify(fields.columns) : cur.columns;
      const streak = typeof fields.streak === 'boolean' ? (fields.streak ? 1 : 0) : cur.streak;
      const spotlight = typeof fields.spotlight === 'boolean' ? (fields.spotlight ? 1 : 0) : cur.spotlight;
      stmt.updateBoard.run(name, icon, focusLabel, columns, streak, spotlight, id, userId);
      return rowToBoard(stmt.boardById.get(id, userId));
    },
    touchBoard(userId, id) { stmt.touchBoard.run(nowIso(), id, userId); },
    reorderBoards(userId, ids) { ids.forEach((id, i) => stmt.setBoardPos.run(i, id, userId)); },
    deleteBoard(userId, id) {
      const cur = stmt.boardById.get(id, userId);
      if (!cur) return false;
      stmt.deleteBoardCards.run(id);
      stmt.deleteBoard.run(id, userId);
      return true;
    },

    // ---- cards (scoped to a board) ----
    getCards: (boardId) => stmt.cardsByBoard.all(boardId).map(rowToCard),
    countUserCards: (userId) => stmt.countUserCards.get(userId).n,
    getCardRow: (userId, id) => stmt.cardById.get(id, userId),
    createCard(userId, boardId, { title, type }) {
      const id = uuid();
      stmt.insertCard.run(id, userId, boardId, title, type, 0, stmt.nextCardPos.get(boardId, type).p, '[]', nowIso());
      return rowToCard(stmt.cardById.get(id, userId));
    },
    updateCard(userId, id, fields) {
      const cur = stmt.cardById.get(id, userId);
      if (!cur) return null;
      const title = fields.title != null ? fields.title : cur.title;
      const type = fields.type != null ? fields.type : cur.type;
      const subtasks = fields.subtasks != null ? JSON.stringify(fields.subtasks) : cur.subtasks;
      const priority = (typeof fields.priority === 'number' && fields.priority >= 0 && fields.priority <= 3) ? fields.priority : (cur.priority || 0);
      // dueAt / remindAt / tags / recur: presence of the key means "set" (null/'' clears it)
      const dueAt   = ('dueAt'   in fields) ? (fields.dueAt   || null) : (cur.due_at   || null);
      const remindAt= ('remindAt'in fields) ? (fields.remindAt|| null) : (cur.remind_at|| null);
      const tags    = ('tags'    in fields) ? JSON.stringify(Array.isArray(fields.tags) ? fields.tags : []) : cur.tags;
      const recur   = ('recur'   in fields) ? String(fields.recur || '') : (cur.recur || '');
      const note    = ('note'    in fields) ? String(fields.note || '') : (cur.note || '');
      const startAt = ('startAt' in fields) ? (fields.startAt || null) : (cur.start_at || null);
      const duration= ('duration'in fields) ? (Number.isFinite(fields.duration) ? Math.max(0, Math.floor(fields.duration)) : 0) : (cur.duration || 0);
      // If the reminder time was (re)set to a future/new value, allow it to fire again.
      let reminded = cur.reminded;
      if ('remindAt' in fields) reminded = 0;
      let focused = cur.focused;
      if (typeof fields.focused === 'boolean') {
        focused = fields.focused ? 1 : 0;
        if (fields.focused) stmt.clearFocus.run(cur.board_id, id); // single focus per board
      }
      stmt.updateCard.run(title, type, focused, subtasks, priority, dueAt, remindAt, reminded, tags, recur, note, startAt, duration, id, userId);
      return rowToCard(stmt.cardById.get(id, userId));
    },
    moveCardToBoard(userId, id, boardId, type) {
      const cur = stmt.cardById.get(id, userId);
      if (!cur) return null;
      stmt.moveCardBoard.run(boardId, type, stmt.nextCardPos.get(boardId, type).p, id, userId);
      return rowToCard(stmt.cardById.get(id, userId));
    },
    reorderCards(userId, boardId, type, ids) { ids.forEach((id, i) => stmt.reorderCard.run(type, i, id, userId)); },
    archiveCard(userId, id) { const r = stmt.cardById.get(id, userId); if (!r) return null; stmt.archiveCard.run(nowIso(), id, userId); return rowToCard(stmt.cardById.get(id, userId)); },
    restoreCard(userId, id) {
      const r = stmt.cardById.get(id, userId);
      if (!r) return null;
      stmt.restoreCard.run(stmt.nextCardPos.get(r.board_id, r.type).p, id, userId);
      return rowToCard(stmt.cardById.get(id, userId));
    },
    deleteCard(userId, id) { const r = stmt.cardById.get(id, userId); if (!r) return null; stmt.deleteCard.run(id, userId); return rowToCard(r); },
    getArchived: (userId) => stmt.archivedByUser.all(userId).map(rowToCard),
    // All non-archived cards across every board — powers the Today / Upcoming / All smart views.
    getActiveCards: (userId) => stmt.activeByUser.all(userId).map(rowToCard),
    // Cards whose reminder is due (global; the scheduler pushes then marks them).
    getDueReminders: (nowStr) => stmt.dueReminders.all(nowStr).map((r) => ({ ...rowToCard(r), userId: r.user_id })),
    markReminded: (id) => stmt.markReminded.run(id),

    // ---- web-push subscriptions ----
    saveSubscription(userId, sub) {
      if (!sub || !sub.endpoint || !sub.keys) return;
      stmt.upsertSub.run(sub.endpoint, userId, sub.keys.p256dh || '', sub.keys.auth || '', nowIso());
    },
    getSubscriptions: (userId) => stmt.subsByUser.all(userId).map((s) => ({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } })),
    getAllSubscriptions: () => stmt.allSubs.all().map((s) => ({ userId: s.user_id, endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } })),
    deleteSubscription: (endpoint) => stmt.deleteSub.run(endpoint),

    // ---- journal (one free-text entry per day) ----
    getJournalEntry: (userId, day) => { const r = stmt.getJournal.get(userId, day); return r ? { content: r.content, mood: r.mood || '' } : { content: '', mood: '' }; },
    saveJournalEntry(userId, day, content, mood) {
      if (!content && !mood) { stmt.deleteJournalDay.run(userId, day); return; } // fully empty → remove so it drops off the calendar
      stmt.upsertJournal.run(userId, day, content || '', mood || '', nowIso());
    },
    getJournalDays: (userId) => stmt.journalDays.all(userId).map((r) => ({ day: r.day, content: r.content || '', mood: r.mood || '' })),

    // ---- habits ----
    getHabits: (userId) => stmt.habitsByUser.all(userId).map((h) => ({ id: h.id, name: h.name, icon: h.icon, color: h.color, position: h.position, createdAt: h.created_at })),
    createHabit(userId, { name, icon, color }) { const id = uuid(); stmt.insertHabit.run(id, userId, name, icon || '✅', color || '#34d399', stmt.nextHabitPos.get(userId).p, nowIso()); return stmt.habitById.get(id, userId); },
    updateHabit(userId, id, fields) { const cur = stmt.habitById.get(id, userId); if (!cur) return null; stmt.updateHabitStmt.run(fields.name != null ? fields.name : cur.name, fields.icon != null ? fields.icon : cur.icon, fields.color != null ? fields.color : cur.color, id, userId); return stmt.habitById.get(id, userId); },
    deleteHabit(userId, id) { const cur = stmt.habitById.get(id, userId); if (!cur) return false; stmt.deleteHabitCheckins.run(id); stmt.deleteHabitStmt.run(id, userId); return true; },
    getCheckins: (userId, sinceDay) => stmt.checkinsByUser.all(userId, sinceDay).map((r) => ({ habitId: r.habit_id, day: r.day })),
    toggleCheckin(userId, habitId, day) { const h = stmt.habitById.get(habitId, userId); if (!h) return null; if (stmt.checkinExists.get(habitId, day)) { stmt.deleteCheckin.run(habitId, day); return false; } stmt.insertCheckin.run(habitId, day); return true; },

    // ---- focus history ----
    logFocus(userId, title, cardId, day) { stmt.logFocus.run(userId, day, title, cardId || null, nowIso()); },
    getHistory: (userId, limit = 120) => stmt.historyByUser.all(userId, limit),
    getHistoryDays: (userId) => stmt.historyDays.all(userId).map((r) => r.day),

    // ---- maintenance / settings ----
    checkpoint() { try { db.exec('PRAGMA wal_checkpoint(TRUNCATE);'); } catch (_) {} },
    getAppSetting: (key, fallback = null) => { const r = stmt.getSetting.get(key); return r ? r.value : fallback; },
    setAppSetting: (key, value) => stmt.setSetting.run(key, String(value)),
  };
}

module.exports = { createStore, newToken };
