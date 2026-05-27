# Security foundation — authentication + credential encryption

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/security-auth-encryption` _(Claude-managed)_ |
| **Created** | 2026-05-27 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |
| **Bloc** | Bloc S — Security hardening (PR 1 of 2). See `specs/ROADMAP.md`. |

---

## 1. Context

GuestFlow is **exposed on the public Internet** but has **no authentication whatsoever**: `index.js`
mounts every `/api/*` router with no auth middleware and `app.use(cors())` is wide open. Anyone who
finds the URL can read/write reservations, clients, finances, and **read the Google service-account
private key in clear text** (`database.js` stores `googleServiceAccountPrivateKey` unencrypted;
`settingsModel` upserts it as-is). These are the two CRITICAL findings of the security audit
(see `specs/ROADMAP.md` Bloc S).

In production the Express server also serves the React build (`index.js:55-58`), so the client and API
are **same-origin** — a session cookie is the natural fit. In dev, the client runs on `:3000` and the
API on `:4000` (cross-origin), so credentialed CORS must be allowed for the dev origin.

`GET /api/ical/export/:token` is consumed by external calendar services (Google Agenda, etc.) and must
remain **public** (its own token is the access control).

## 2. Goal

No one can reach the app's data without logging in, and the Google credentials are encrypted at rest.
The owner logs in with an email + password; the session persists across restarts; the architecture
supports multiple users later, but ships with a single admin account for now.

## 3. Functional rules

**Authentication**

1. **All `/api/*` routes require an authenticated session**, except: `POST /api/auth/login`,
   `GET /api/auth/me` (returns 401 when not logged in, used by the client to bootstrap),
   `POST /api/auth/logout`, and `GET /api/ical/export/:token` (public by design). Static client assets
   and `/uploads` are also reachable unauthenticated (the SPA shell + images); sensitive data only
   flows through `/api`.
2. **Login** (`POST /api/auth/login` with `{ email, password }`): on success, establishes a session and
   returns the safe user object (`{ id, email, role }`); on failure returns `401 INVALID_CREDENTIALS`.
   Login is rate-limited (see PR2; in PR1 a minimal in-memory throttle on `/api/auth/login`).
3. **Session** is a server-side session keyed by an httpOnly, `secure` (prod), `sameSite=lax` cookie,
   persisted in SQLite so it survives PM2 restarts. Logout destroys the session.
4. **Passwords** are hashed with `scrypt` (Node built-in) + a per-password random salt; never stored or
   logged in clear. Verification is constant-time.
5. **Default admin + forced first-login password change.** `users` table with a `role` column
   (default `admin`) and a `mustChangePassword` flag. On boot, if the table is empty, seed **one admin
   with fixed default credentials documented in the README** (e.g. `admin@guestflow.local` /
   `ChangeMe!2026`), `mustChangePassword = 1`. No env vars needed. In-app management of *other* users is
   **out of scope here** — deferred to a later spec when a 2nd user is actually needed.
6. **A session whose user `mustChangePassword` is restricted.** While the flag is set, the only
   endpoints the session may reach are `GET /api/auth/me`, `POST /api/auth/change-password`, and
   `POST /api/auth/logout`; **every other `/api` route returns `403 PASSWORD_CHANGE_REQUIRED`**
   (server-enforced, not just client-side). So the default password literally only opens the
   change-password screen.
7. **Change password** (`POST /api/auth/change-password` with `{ currentPassword, newPassword }`):
   requires a valid session + correct current password; new password validated (min 10 chars, and must
   differ from the current/default). On success, clears `mustChangePassword` → full access.
8. **Client guard:** the SPA checks `GET /api/auth/me` on load; unauthenticated → login page; a `401`
   from any API call redirects to login. When `me` reports `mustChangePassword`, the SPA shows **only**
   the change-password screen until it's done. All API calls send the cookie
   (`fetch(..., { credentials: 'include' })`).

> **Security note (default credentials).** Documented default credentials mean that, between first
> deploy and the first password change, anyone who knows the default could log in — but they can *only*
> change the password (rule 6). The README must instruct the operator to **change the password
> immediately on first launch** (ideally before exposing the instance publicly). PR 2 adds login rate
> limiting to blunt automated abuse.

**Credential encryption**

9. **Google credentials are encrypted at rest** with AES-256-GCM: at minimum
   `googleServiceAccountPrivateKey` (and, for consistency, `googleServiceAccountEmail`,
   `googleCalendarId`). Encryption/decryption happens in `settingsModel` (encrypt on write, decrypt on
   read); the rest of the app keeps seeing plaintext values.
10. **Encryption key** lives in `server/.env.local` (`GUESTFLOW_ENCRYPTION_KEY`, 32 bytes base64),
    **auto-generated on first run if absent** (matching the README's existing claim). The key file is
    never committed (`.env.local` is already git-ignored).
11. **Transparent migration:** stored values are tagged (`enc:v1:<iv>:<tag>:<ciphertext>`, base64). On
    read, an untagged (legacy cleartext) value is returned as-is and re-encrypted on next write; a boot
    migration encrypts existing cleartext rows once. No data loss, idempotent.
12. **Secrets are never logged** and the private key is still masked in `GET /api/settings` responses
    (existing `settingsResponse` behavior preserved).

**Edge cases**
- No users + no seed env → app returns `503`/login-locked with a logged instruction; no silent open access.
- Wrong password → generic `401 INVALID_CREDENTIALS` (no user-enumeration difference between unknown
  email and wrong password).
- Decryption failure (corrupted value / wrong key) → surfaced as a clear server error, never a silent
  empty credential that would mask a misconfiguration.
- Dev cross-origin: CORS allows the dev client origin with `credentials: true` so the cookie works.

---

## 4. Architecture

> **Fat backend, thin frontend.** All auth/session/crypto logic is server-side. The client only renders
> a login form, holds the "current user" in memory, and sends the cookie.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `index.js` | `index.js` | T | Add `express-session` (SQLite store) before routers; mount `/api/auth`; apply `requireAuth` middleware to all `/api` routers except auth + ical export; credentialed CORS for dev origin. |
| `routes/` | `auth.js` | C | Thin: `POST /login`, `POST /logout`, `GET /me`, `POST /change-password` → controller. |
| `controllers/` | `authController.js` | C | Orchestrates login/logout/me/change-password. |
| `models/` | `usersModel.js` | C | `users` CRUD: find by email, verify password, create, update password, seed admin. |
| `middleware/` | `requireAuth.js` | C | Rejects unauthenticated requests with `401 UNAUTHENTICATED`; attaches `req.user`. |
| `utils/` | `passwordHash.js` | C | `hashPassword`/`verifyPassword` via `crypto.scrypt` (+ salt), constant-time compare. |
| `utils/` | `encryption.js` | C | AES-256-GCM `encrypt`/`decrypt`, `isEncrypted`, key bootstrap (read/generate `GUESTFLOW_ENCRYPTION_KEY` in `.env.local`). |
| `models/` | `settingsModel.js` | T | Encrypt Google fields on write, decrypt on read; boot migration of cleartext rows. |
| `database.js` | `database.js` | T | Migration: create `users` table (+ unique email index, `mustChangePassword` column); session store table is created by the store lib. Seed the default admin on boot when empty. |
| `scheduledTasks.js` | — | — | (none) |

**New dependencies:** `express-session`, `better-sqlite3-session-store` (persists sessions in the
existing SQLite DB). Password hashing and AES use Node's built-in `crypto` (no dep). No `bcrypt`/`jwt`.

**Notes:**
- `requireAuth` is applied centrally in `index.js` so every current and future router is protected by
  default (fail-closed). The few public endpoints are mounted before it or explicitly exempted.
- `users` schema: `id INTEGER PK, email TEXT UNIQUE NOT NULL, passwordHash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin', mustChangePassword INTEGER NOT NULL DEFAULT 0,
  isActive INTEGER NOT NULL DEFAULT 1, createdAt, updatedAt`.
- `requireAuth` also enforces the restricted session: when `req.user.mustChangePassword` is set, it
  blocks everything except the auth endpoints listed in rule 6 (`403 PASSWORD_CHANGE_REQUIRED`).

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `api.js` | `api.js` | T | Add `credentials: 'include'` to every request; on `401`, trigger logout/redirect-to-login. Add `login`, `logout`, `getMe`, `changePassword`. |
| `context/` or `hooks/` | `useAuth.js` (or `AuthContext`) | C | Holds current user, `login`/`logout`, bootstraps via `getMe` on mount. |
| `pages/` | `LoginPage.js` | C | Email + password form; error display; submits to `api.login`. |
| `App.js` | `App.js` | T | Gate the app: if not authenticated → `LoginPage`; else render routes. |
| `pages/` | `SettingsPage.js` | T | Add a "Changer le mot de passe" section (current + new) using existing form components. |
| `components/` | (reuse) | — | `LoginPage` uses existing fields; "change password" reuses `HelpedTextField`/`MaskedTextField`. |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `MaskedTextField`, `HelpedTextField`, `PageActionBar`, `ErrorAlert`/`LoadingState` | Login form + change-password reuse these. |
| **Created (new generic)** | `useAuth` (hook/context) | App-wide auth state; inherently shared. |
| **Specific** | `LoginPage` | One-off page, but built from generic fields. |

### 4.3 API contract

| Method | Endpoint | Body | Response | Auth |
|---|---|---|---|---|
| POST | `/api/auth/login` | `{ email, password }` | `200 { id, email, role }` / `401 INVALID_CREDENTIALS` | public |
| POST | `/api/auth/logout` | — | `204` | session |
| GET | `/api/auth/me` | — | `200 { id, email, role, mustChangePassword }` / `401 UNAUTHENTICATED` | public (probe) |
| POST | `/api/auth/change-password` | `{ currentPassword, newPassword }` | `204` / `400` / `401` | session (allowed even when restricted) |
| * | all other `/api/*` | — | `401 UNAUTHENTICATED` (no session) or `403 PASSWORD_CHANGE_REQUIRED` (restricted session) | session |
| GET | `/api/ical/export/:token` | — | iCal feed | **public (token)** |

Cookie: `httpOnly`, `sameSite=lax`, `secure` in production, reasonable `maxAge` (e.g. 30 days, sliding).

---

## 5. Data model

- **New table `users`** (idempotent `CREATE TABLE IF NOT EXISTS` in `database.js`): see schema above +
  `CREATE UNIQUE INDEX IF NOT EXISTS uniq_users_email`.
- **Session table** created/managed by `better-sqlite3-session-store` (separate table, e.g. `sessions`).
- **Boot seed**: if `users` is empty, insert the **default admin** (documented email + default password,
  hashed) with `mustChangePassword = 1`. Idempotent (runs only when empty); no env vars required.
- **Settings encryption migration**: on boot, read Google credential columns; any value not tagged
  `enc:v1:` is encrypted in place. Idempotent; reversible only via the key.

**Data impact:** no existing business data is altered except the one-time encryption of Google
credential columns (transparent — decrypted on read). `.env.local` gains `GUESTFLOW_ENCRYPTION_KEY`
(auto-generated). First launch creates the default admin; the operator changes its password
immediately (forced).

## 6. UI / UX

- **LoginPage**: centered card, GuestFlow title, email + password (`MaskedTextField` for password),
  "Se connecter" button, inline French error ("Identifiants invalides"). Loading state on submit.
  Fully responsive (single column, full-width on `xs`).
- **App gating**: while `getMe` is in flight → loading splash (no premature LoginPage);
  unauthenticated → LoginPage; authenticated → normal app. A "Se déconnecter" action sits at the
  **bottom of the sidebar** — minimal, French.
- **Forced first-login password change**: when `me.mustChangePassword` is true, the SPA renders **only**
  a "Définir votre mot de passe" screen (new password + confirm; current password pre-known = default,
  so the form explains "Mot de passe par défaut — choisissez-en un nouveau"). No sidebar/app access
  until it succeeds; the server also blocks every other route (`403 PASSWORD_CHANGE_REQUIRED`). After
  success → full app.
- **Settings → "Changer le mot de passe"**: a section card (current password, new password, confirm)
  under the existing `PageActionBar` flow; server-validated; success/error feedback in French.
- **Responsive:** login + change-password forms stack on `xs`; nothing else changes layout.
- **PageActionBar:** LoginPage has no action bar (pre-auth, minimal). Settings keeps its existing bar.

## 7. Test plan

### Server unit tests
- [ ] `tests/password-hash.unit.test.js` — hash≠plaintext, verify true/false, salts differ, constant-time path.
- [ ] `tests/encryption.unit.test.js` — round-trip encrypt/decrypt; `isEncrypted` detects tag; tampered
      ciphertext/tag fails; legacy cleartext passes through; wrong key fails.
- [ ] `tests/users-model.unit.test.js` — create/findByEmail/verify; unique email; seed-when-empty idempotent.
- [ ] `tests/auth-controller.unit.test.js` — login success/failure, change-password rules (min length,
      must differ, clears `mustChangePassword`), no user-enumeration.
- [ ] `tests/require-auth.unit.test.js` — no session → 401; restricted session (`mustChangePassword`) →
      403 on a normal route but allowed on change-password/me/logout; full session → passes.
- [ ] `tests/settings-model-encryption.unit.test.js` — Google key stored encrypted, read decrypted, boot
      migration encrypts a legacy cleartext row once.

### Manual UI verification
- [ ] Unauthenticated visit → LoginPage; no `/api` data loads (all 401).
- [ ] First login with the **default credentials** → forced "set password" screen only; any other route
      returns `403 PASSWORD_CHANGE_REQUIRED`; sidebar/app unreachable.
- [ ] After setting a new password → full app; default password no longer works; reload keeps session;
      logout → back to login.
- [ ] `GET /api/ical/export/:token` still works without login.
- [ ] Change password again (from Settings) → re-login with new password works; old fails.
- [ ] Settings: Google private key still masked; saving without re-entering doesn't wipe it; sync still
      works (decryption OK). Inspect DB → private key stored as `enc:v1:...`.
- [ ] Mobile (`xs`): login + change-password forms render correctly.

## 8. Out of scope (→ Bloc S PR 2 or later)

- **Full CORS lockdown**, **multer upload hardening**, **rate limiting** (beyond a minimal login
  throttle), **money/percentage validation at all write boundaries**, **log sanitization** → **PR 2**.
- **In-app user management** (create/disable/reset other users, roles enforcement) → later spec when a
  2nd user is needed. PR 1 ships the schema + a single seeded admin only.
- Password reset by email, 2FA, account lockout policy → future.

## 9. Open questions

**Resolved at approval (2026-05-27):**
- Session lifetime: **30 days, sliding**.
- Logout: a small **"Se déconnecter" at the bottom of the sidebar**.
- Minimum password length: **10 characters**.
