# Today's Focus

A stark, minimalist, **multi-user** productivity app built on one rule:

> You may collect endless **thoughts**, **projects** and **goals** — but only **ONE** card may sit in *Today's Focus* at a time.

Each person logs in and gets their own private board. Drag a second card into the Focus Zone and the previous one is automatically evicted back to its column.

---

## Stack

| Layer     | Choice                                                            |
|-----------|------------------------------------------------------------------|
| Frontend  | Single-page app — HTML5 + Tailwind (CDN) + vanilla JS             |
| Backend   | Node.js + Express                                                |
| Auth      | bcrypt password hashing + JWT in an httpOnly cookie              |
| Storage   | **SQLite** (`data/focus.db`) via Node's built-in `node:sqlite` — no native build |
| Deploy    | `Dockerfile` + `docker-compose.yml` (Unraid / reverse-proxy ready) |

> Requires **Node ≥ 22.5** (for built-in SQLite). The Docker image uses Node 24.

---

## Run locally

```bash
npm install
npm start          # → http://localhost:3000
```

The first account you create (via the login screen → "Register") becomes the **admin**.

## Run on Unraid / a home server

```bash
docker compose up -d --build      # → http://localhost:3000
```

Then put it behind your reverse proxy (Nginx Proxy Manager / SWAG / Cloudflare Tunnel) so it's served as `https://focus.yourdomain.com`. The app trusts the proxy (`TRUST_PROXY=1`) and will then set **Secure** cookies automatically.

The SQLite database lives in the bind-mounted `./data` folder — **back that folder up**.

### Important environment variables (`docker-compose.yml`)

| Var | Purpose |
|-----|---------|
| `JWT_SECRET` | **Set this** to a long random string (`openssl rand -hex 48`) so logins survive restarts. If unset, a random secret is generated and saved to `data/.jwtsecret`. |
| `INVITE_CODE` | Shared code friends/family use to self-register. Blank = invite signup off. |
| `OPEN_REGISTRATION` | `true` lets anyone register. Default `false`. Also toggleable in the Admin panel. |
| `TRUST_PROXY` | Number of proxies in front (usually `1`). |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | Optional — pre-creates the admin on first boot instead of registering via the UI. |

---

## Accounts & roles

- **Admin** (first account, or seeded via env): gets a **Manage users** panel — create/delete accounts, toggle open registration, set the invite code, configure the **donate button**, and set a **3D-print shop link** (shown in everyone's menu so people can buy the printed versions).
- **Users**: their own board, themes, column names, and API token.
- Registration modes, in priority order: bootstrap (first user) → open registration → invite code → otherwise admin-created only.

Manage your account from the header menu (**Account & API token**): copy/regenerate your API token, change your password, or generate **recovery codes**.

### Recovery codes (forgot password)

There is **no email** in the system, so account recovery uses one-time **recovery codes** instead:

- On sign-up (and admin-created accounts) a set of 10 single-use codes is shown **once** — save them somewhere safe.
- Forgot your password? On the login screen choose **Forgot password?**, enter your username, one recovery code, and a new password.
- Each code works once; regenerate a fresh set anytime from **Account → Recovery codes** (this invalidates the old set). Codes are stored only as SHA-256 hashes, never in plaintext.

---

## Boards & layout

The app is built around **boards** — pick one from the dropdown (top-left). Every board keeps the same shape, only the *context* changes:

- **Top ~30% — The Focus Zone:** one featured card, rendered huge. Each board labels it differently (e.g. *Today's Focus*, *Currently Reading*, *Quote of the Day*) and keeps its **own** single focus.
- **Bottom ~70% — Columns:** each board defines its own columns (the default *Today's Focus* board uses Thoughts · Projects · Goals).

Create your own boards (Books, Quotes, Affirmations, Games…) from the switcher → **New board**: set a name, icon, the focus-area label, your columns, and whether focusing there counts toward your 🔥 streak.

- **"Of the day" mode (spotlight):** tick this on a board (e.g. Quotes, Affirmations) and the Focus Zone **automatically features one card each day**, rotating deterministically — your *Quote of the Day* is the same all day and changes tomorrow. No dragging needed.
- **Dropdown order:** boards are sorted **most-recently-used first**, with **Today's Focus always pinned on top**.

| Action | How |
|--------|-----|
| Switch / create / manage boards | **Dropdown** in the top-left |
| Add a card | Click **+**, type, **Enter** |
| Add a subtask | On a card, **+ Subtask** → type → **Enter**; tick the checkbox to complete it |
| Edit a card or subtask | Hover → **pencil** icon → edit the text → **Enter** (clearing a subtask removes it) |
| Focus a card | Drag into the Focus Zone, or **double-click** it (its checklist appears in a panel beside it) |
| Move / release | Drag it (double-click a focused card to release) |
| Send a card to another board | Hover a card → **→** icon → pick a board |
| Delete | Hover a card → trash icon |
| Rename a column | Click the column header, type, **Enter** |
| Switch theme | **Light / Cardboard / Dark** switcher (top-right) |
| Reorder cards | Drag a card up/down within its column |
| Archive a card | Hover a card → trash icon (recoverable, not deleted) |
| Restore / delete forever | Menu → **Archive** |
| Set your timezone | Menu → *Account* → **Timezone** (controls your streak day & date) |
| Focus streak & history | Header **🔥 chip** or menu → *Focus history* |
| Install on phone | Browser menu → **Add to Home Screen** (PWA) |
| Export your data | Menu → *Account* → **Download my cards & history** |

### Streaks, install & backups

- **Focus streaks:** each day you set a focus, it's logged. A 🔥 streak chip appears in the header, and *Focus history* shows current/longest streak, total days, and what you focused on. Set `TZ` (in `docker-compose.yml`) so the day rolls over at your local midnight.
- **Installable (PWA):** ships a web manifest, icons, and a service worker, so friends/family can install it to their home screen and it works offline (the live data still needs a connection).
- **Backups:** admins can download a consistent `.db` snapshot from the *Manage users* panel. To restore: stop the container, drop the file in at `data/focus.db`, and start it again.
- **Account self-service:** change your own username or password; admins can reset any user's password from the panel.

---

## REST API

All `/api/cards` and `/api/settings` calls require auth — a **session cookie** (browser) or a **personal API token** (automation).

| Method   | Endpoint              | Body / Notes                                  |
|----------|-----------------------|-----------------------------------------------|
| `POST`   | `/api/auth/register`  | `{ username, password, code? }`               |
| `POST`   | `/api/auth/login`     | `{ username, password }` → sets cookie        |
| `POST`   | `/api/auth/logout`    | clears cookie                                 |
| `GET`    | `/api/auth/me`        | current user + API token                      |
| `GET`    | `/api/cards`          | your cards                                     |
| `POST`   | `/api/cards`          | `{ title, type }` — create on your board      |
| `PATCH`  | `/api/cards/:id`      | `{ type?, focused?, title?, subtasks? }` — `subtasks` is `[{ id?, text, done }]` |
| `POST`   | `/api/cards/:id/move` | `{ boardId, type? }` — send the card to another board |
| `DELETE` | `/api/cards/:id`      | delete                                         |
| `GET/PUT`| `/api/settings`       | `{ theme?, labels? }`                         |
| `*`      | `/api/admin/*`        | admin only (users + registration)             |

### Automation (n8n / webhooks)

Grab your token from **Account & API token**, then:

```bash
curl -X POST https://focus.yourdomain.com/api/cards \
  -H "Authorization: Bearer tf_xxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{ "title": "Reply to the Henderson email", "type": "project" }'
```

The card lands on **your** board (the UI polls and shows it within a few seconds).

---

## Security notes

- Passwords are bcrypt-hashed; sessions are signed JWTs in httpOnly + (behind HTTPS) Secure cookies.
- Login/registration is rate-limited per IP; basic security headers are set.
- API tokens grant card/settings access only — never admin or password changes.
- Always run behind HTTPS in production (your reverse proxy handles the certificate). An **HSTS** header is sent automatically once requests arrive over HTTPS.

## Configuration cheatsheet

| Where               | Knobs                                                                   |
|---------------------|-------------------------------------------------------------------------|
| `server.js`         | ports, paths, `THEMES`, password/username rules, rate limits, proxy     |
| `db.js`             | SQLite schema & queries                                                 |
| `public/app.js`     | `COLUMNS`, `THEMES`, `POLL_MS`                                           |
| `public/index.html` | theme palettes (the `[data-theme]` blocks)                              |
| `docker-compose.yml`| `JWT_SECRET`, `INVITE_CODE`, `OPEN_REGISTRATION`, admin bootstrap        |

## License

MIT
