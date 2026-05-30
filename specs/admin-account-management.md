# Admin account management

| Field | Value |
|---|---|
| **Status** | Approved |
| **Branch** | `feature/admin-account-management` |
| **Created** | 2026-05-30 |
| **Author** | Adrien |
| **Related PR** | _(filled after push)_ |

---

## 1. Context

The current state of account management is minimal:

- Schema: `users(id, email, passwordHash, role TEXT, mustChangePassword, isActive, createdAt, updatedAt)`
  — a single `role` column (TEXT, default `admin`).
- Only one UI exists for creating/resetting accounts: the **Accès comptable** card embedded in
  `Paramètres` ([SettingsAccountantAccessSection.js](client/src/components/SettingsAccountantAccessSection.js)).
  It can only handle a single accountant account and **displays the generated temporary password
  on screen** for the admin to copy/share manually.
- There is no admin UI to list all users, change a user's role, edit their identity, deactivate or
  delete them.
- There is **no email-sending infrastructure** anywhere in the app: no `nodemailer`, no SMTP
  config, no template system, no transactional dispatch.
- Auth flow after a `mustChangePassword=1` first login keeps the same session active — the user
  silently moves on with their new password. No "log in again with the password you just set"
  step.

Adrien needs a real, scalable account-management workflow now that more than one accountant /
collaborator could plausibly need access (and the existing accountant card has aged out as a
single-purpose hack).

## 2. Goal

Every authenticated user lands on a single **Gestion utilisateur** page (`/account`, sidebar
entry) where they can change their own password. Admins additionally see a "Gestion des comptes"
section below it, where they can manage every other account — create accounts with identity
(first + last name, optional company + free-form note) and **any combination of roles**, edit
them, reset their password, deactivate or delete them. Temporary passwords are delivered by email
(not displayed on screen), and the recipient is forced through a
"set your real password → log in again" first-login flow.

> **2026-05-30 follow-up:** the original design shipped two separate pages — `/settings/password`
> (everyone) and `/comptes` (admin only). They were merged into a single `/account` page with
> role-gated sections, so the sidebar no longer carries two near-identical entries. The legacy
> paths `/settings/password` and `/comptes` redirect to `/account`.
>
> **2026-05-30 follow-up #2:** the unified page now lives **under "Paramètres" as a submenu item**
> (alongside Logements, Options, Clients, etc.) rather than as a top-level sidebar entry. Same
> route (`/account`), same content gating; only the sidebar entry-point moved. The accountant
> minimal sidebar still surfaces it directly as "Gestion utilisateur" since accountants don't
> have access to the Paramètres group.
>
> **2026-05-30 follow-up #3:** outgoing emails (welcome / reset / SMTP test) now sign with the
> SMTP sender's display name (`smtpFromName`) instead of a hardcoded "GuestFlow", and carry an
> "Ce message est généré automatiquement." notice above the signature.
>
> **2026-05-30 follow-up #4:** the SMTP password field strips ALL whitespace before encryption.
> Gmail App Passwords are displayed by Google in a `abcd efgh ijkl mnop` 4-by-4 format and copy-
> pasting it verbatim used to trigger `5.7.8 Username and Password not accepted` because the
> transport sent the literal spaces. The strip is server-side (`settingsController.updateSettings`)
> so it applies to any client that hits `PUT /api/settings`.
>
> **2026-05-30 follow-up #6:** the unified page gains a **"Mes informations"** section above
> "Mon mot de passe" — every authenticated user edits their own identity fields (`firstName`,
> `lastName`, `companyName`, `notes`). Email stays locked (same rule as the admin form in edit
> mode); **roles are NOT exposed** anywhere — the new server endpoint `PUT /api/users/me`
> deliberately omits `roles` from the model call so an authenticated user cannot grant themselves
> a role via a hand-rolled payload (privilege guard, asserted by a unit test). On a successful
> save the page calls `useAuth().refresh()` so the sidebar + dialogs pick up the new name
> immediately. Field-level server errors (`{ field: 'firstName', detail: '…' }`) land under the
> matching input; generic errors fall through to the page snackbar.
>
> **2026-05-30 follow-up #5:** the sidebar is now rendered by a **single code path for every role**
> (no more separate accountant branch). A per-route role allowlist in
> `client/src/constants/roles.js#ROUTE_ROLES` drives `canSeeRoute(user, path)` / `canSeeAnyRoute`;
> each `<ListItemButton>` (top-level + submenu child) is wrapped with the corresponding check.
> Submenu **parents** (Calendrier, Suivi financier, Paramètres) survive iff at least one of their
> children is visible — so an accountant sees `Suivi financier > Comptabilité` and
> `Paramètres > Gestion utilisateur` with the parent labels intact (no nav structure flattening).
> When the parent's own path isn't reachable by the user (accountant on `/settings`), the parent
> row stops being a `<Link>` and only toggles the submenu open/closed; the drawer-close callback
> is also suppressed so the user can pick their authorised child. Accountant scope is pinned by
> the client unit test (`canSeeRoute` returns only `/comptabilite` + `/account` for that role).

### 3.1 Schema & roles

1. The `users` table gains four identity fields: **`firstName`** (TEXT NOT NULL DEFAULT `''`),
   **`lastName`** (TEXT NOT NULL DEFAULT `''`), **`companyName`** (TEXT NOT NULL DEFAULT `''`),
   **`notes`** (TEXT NOT NULL DEFAULT `''`), and **`lastLoginAt`** (TEXT NULL, ISO timestamp,
   updated on every successful login).
2. The single-role `users.role` column is **replaced** by a join table
   **`user_roles(userId INTEGER NOT NULL, role TEXT NOT NULL, PRIMARY KEY (userId, role),
   FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE)`**. A user MUST have at least one
   role; the engine rejects a save that would leave a user role-less.
3. The supported roles are listed in `server/src/constants/roles.js`: today **`admin`** and
   **`accountant`** (single source of truth; both server and client read from it). Roles are
   case-sensitive lowercase.
4. **Migration:** on first boot after this change, for every existing user a row is inserted into
   `user_roles` mirroring their current `users.role` value. Then `users.role` is dropped. The
   helper is idempotent (skipped if `user_roles` already exists and has rows). No backfill issue:
   the seeded default admin already has `role='admin'`.

### 3.2 Unified "Gestion utilisateur" page (`/account`)

5. The page is reachable by every authenticated user (sidebar entry **"Gestion utilisateur"**,
   `<AdminPanelSettingsIcon />`). Route `/account`. The legacy `/settings/password` and `/comptes`
   paths redirect to `/account` for back-compat. Content is role-gated **client + server**:
   - **Section "Mon mot de passe"** — always visible. Wraps `ChangePasswordForm`. On a forced
     first-login change the existing behaviour (rule 15) still fires: server destroys the session
     and the page navigates to `/login?reason=password-changed`.
   - **Section "Gestion des comptes"** — visible only when `userHasRole(me, ADMIN)`. The list +
     CRUD UI documented in rules 6–13. Server-side, `enforceRoleAccess` still blocks
     `/api/users/*` (except the self route `/users/me`) for non-admins, so a comptable bookmarking
     `/account` cannot trigger an admin call by tampering with the URL.
6. The page lists every user — including deactivated ones (shown greyed out with a "Désactivé"
   chip), ordered by `lastName, firstName, email`. Columns: **Nom**, **Email**, **Rôles**
   (multi-chip), **Société**, **Dernière connexion** (`—` if never), **Statut** (Actif /
   Désactivé / "Doit changer son mot de passe" chip), **Actions**.
7. **Create account** (top-right "Ajouter un compte" button on the page action bar):
   opens a `FormDialog` with fields:
   - **Prénom*** (required, trimmed, non-empty)
   - **Nom*** (required, trimmed, non-empty)
   - **Email*** (required, valid email pattern, normalized lowercase, unique server-side)
   - **Rôles*** (MUI `Select` with `multiple` mode + checkboxes, options from the roles
     constant, **at least one role required**)
   - **Société** (optional, free text)
   - **Note** (optional, free text, multiline)
   On save: server creates the user with `mustChangePassword=1`, generates a **12-char**
   alphanumeric temporary password (uppercase + lowercase + digits, **excludes `I/O/l/0/1`** to
   avoid confusion), persists the user, inserts the roles in `user_roles`, then **emails** the
   temporary password to the new user (see rule 14). Returns the safe user (no password). The
   temporary password is **never returned in the HTTP response, never displayed, never logged**.
8. **Edit account** (pencil icon per row): opens the same `FormDialog` with the user's current
   values, all fields editable except email (email change requires a separate flow — out of
   scope, see §8). On save: server updates identity fields + `user_roles` (delete + reinsert in a
   transaction).
9. **Reset password** (key icon per row): triggers a `ConfirmDialog`
   *"Réinitialiser le mot de passe de **<name>** ? Un mail avec un mot de passe provisoire sera
   envoyé à <email>."*. On confirm: server generates a new temporary password, calls
   `updatePassword(userId)` which sets `mustChangePassword=1`, then sends the reset email. Never
   shown on screen.
10. **Toggle active** (icon button per row, label "Désactiver" / "Réactiver"): flips `isActive`.
    A deactivated user cannot log in (`verifyCredentials` already enforces this).
11. **Delete account** (trash icon per row, ConfirmDialog):
    - **Soft delete (default)** — sets `isActive=0` and labels the chip "Désactivé". Always
      available except on self (rule 13).
    - **Hard delete** (red "Supprimer définitivement" button in the same ConfirmDialog, **only
      enabled when the user has never logged in**: `lastLoginAt IS NULL` AND
      `mustChangePassword=1`). Cascades via the FK to `user_roles`. The new "Supprimer
      définitivement" button stays disabled with a tooltip *"Ne peut être supprimé définitivement
      qu'un compte qui ne s'est jamais connecté."* otherwise.
12. **Self-protection:** the current user cannot, on their own row:
    - delete (soft or hard) themselves,
    - remove the `admin` role from themselves (the role chip-input is locked + tooltip),
    - reset their own password from this page (use `/settings/password`).
    The page hides / disables the buttons; the server **also enforces these rules** (fail-closed:
    `403 SELF_ACTION_FORBIDDEN`).
13. **Last admin lockout protection:** the engine refuses any action that would leave the
    `users` table with zero active admin users — delete, deactivate, or role removal on the only
    remaining active admin returns `400 LAST_ADMIN`. Surfaced to the UI as a snackbar
    *"Action impossible : c'est le dernier compte admin actif."*

### 3.3 Temporary password + first-login flow

14. The temporary password is sent by email via the new SMTP transport (see §3.4). Subject
    *"Votre accès GuestFlow"* (welcome) or *"Réinitialisation de votre mot de passe"* (reset).
    Body in French, plain text (no HTML), containing: the email used to log in, the temporary
    password, the URL of the login page (`app_settings.publicUrl`, see §3.4), and a one-line
    instruction *"Connectez-vous avec ce mot de passe puis suivez les instructions pour en
    choisir un personnel."* Every body **ends with two extra lines** (added 2026-05-30):
    *"Ce message est généré automatiquement."* and a signature *"— {smtpFromName}"* (falls back
    to `GuestFlow` when no display name is configured).
15. On the next login the server detects `mustChangePassword=1` and the client (already wired,
    see [security-auth-encryption.md](specs/security-auth-encryption.md)) renders only
    `ChangePasswordPage`. After the user submits their new password successfully:
    - the server destroys the session (`req.session.destroy`) and returns
      **204 No Content** with `X-Session-Ended: 1` (or simply 204 — client detects the upcoming
      `/api/auth/me` 401);
    - the client redirects to `/login` with a one-shot snackbar
      *"Mot de passe modifié. Reconnectez-vous avec votre nouveau mot de passe."*
    This redirect-after-first-change behaviour is **only triggered when the change happened
    while `mustChangePassword=1` was true**. Voluntary password changes via `/settings/password`
    by an already-fully-logged-in user keep their session active (current behaviour, unchanged).

### 3.4 SMTP configuration

16. `app_settings` gains six fields:
    - **`smtpHost`** TEXT DEFAULT `''`
    - **`smtpPort`** INTEGER DEFAULT `587`
    - **`smtpSecure`** INTEGER DEFAULT `0` (`1` = implicit TLS on port 465, `0` = STARTTLS)
    - **`smtpUsername`** TEXT DEFAULT `''`
    - **`smtpPasswordEncrypted`** TEXT DEFAULT `''` (AES-256-GCM at rest, same key as the
      Google credentials column)
    - **`smtpFromEmail`** TEXT DEFAULT `''`
    - **`smtpFromName`** TEXT DEFAULT `'GuestFlow'`
    - **`publicUrl`** TEXT DEFAULT `''` (the public origin Adrien wants users to reach, e.g.
      `https://guestflow.adn-dev.fr`; injected into the welcome email).
17. A new **Envoi d'emails (SMTP)** section appears in `/parametres`, with form fields for the
    above + a button **"Envoyer un mail de test"** that sends *"Email de test GuestFlow"* to the
    admin's own email and returns 200 on success or 400 + `{error: 'SMTP_TEST_FAILED', detail:
    '<message>'}` on transport failure. The detail is displayed to the user (helpful for
    diagnosing creds).
18. The account-creation / reset flow **rejects the action with 400 `SMTP_NOT_CONFIGURED`** if
    `smtpHost` is empty (the user would otherwise never get their password). The page surfaces
    this as a snackbar *"Configurez SMTP dans Paramètres avant de créer un compte."* with a
    direct link to `/parametres#smtp`.

### 3.5 Legacy "Accès comptable" section

19. The old `SettingsAccountantAccessSection` card is **removed** from `/parametres`. The
    canonical UI is `/comptes`. The legacy `POST /api/users/:id/reset-password` and `POST /api/users`
    endpoints from the accountant feature stay (they are the same endpoints we extend), but the
    "display password in the response" branch (`temporaryPassword` returned) is **removed** —
    nothing prints the password anywhere on screen ever again.

**Edge cases:**
- SMTP is configured but the network is down at the moment of account creation → user is created
  in DB, password is set, but the email send fails. We **roll back** the user creation in a
  transaction so the admin doesn't end up with a half-created account whose owner doesn't know
  their password. Error returned: `502 EMAIL_SEND_FAILED`. The same rollback applies to reset
  (in that case the password change is rolled back, the previous password still works).
- The admin tries to create a user whose email already exists → `409 EMAIL_ALREADY_EXISTS`,
  inline error under the email field.
- The admin removes the only remaining role from a user → `400 ROLES_REQUIRED`, inline error
  under the role field (*"Au moins un rôle est requis."*).
- A deactivated user is edited (e.g. role added) → allowed. Reactivating requires the explicit
  toggle.
- The admin opens `/comptes` but is not the seeded default admin (e.g. they were created later
  with just `accountant` role) → 403 `FORBIDDEN_ROLE` (consistent with all other admin routes).
- SMTP test with valid creds but the recipient mailbox bounces → the SMTP server typically
  returns 200 to us (queueing), and the bounce is a separate event we won't catch. The test
  reports success based on the SMTP `250` accepted response; bounces are out of scope.
- Hard delete eligibility flips between page load and confirm-click (rare): the server re-checks
  and returns `400 HARD_DELETE_NOT_ELIGIBLE` if the user has logged in since.

---

## 4. Architecture

> **Fat backend, thin frontend.** Roles, password generation, SMTP send, audit-like checks
> (last admin, self-action, hard-delete eligibility) all happen server-side. The client only
> renders the table, dialogs, and forwards user intent.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `database.js` | `database.js` | T | Idempotent migration: ADD COLUMN on `users` (`firstName`, `lastName`, `companyName`, `notes`, `lastLoginAt`); CREATE TABLE `user_roles` if missing + FK ON DELETE CASCADE; INSERT-SELECT to backfill from `users.role` (one-shot guard checks `user_roles` empty); DROP COLUMN `users.role` (via the "make_new_table" SQLite dance); ADD COLUMN on `app_settings` for the 7 SMTP fields + `publicUrl`. Wrapped in a single transaction so a mid-migration failure leaves the DB in the pre-migration state. |
| `constants/roles.js` | — | C | Exports `ROLES = ['admin','accountant']` + `isKnownRole(role)`. Single source consumed server (validation) and client (dropdown). Replaces the role enum currently hidden in `accounting.js`. |
| `models/usersModel.js` | `usersModel.js` | T | Extended to: load+save the new identity fields; load+save roles via `user_roles` (always returns `roles: string[]`); enforce "≥1 role" + "≥1 active admin"; `softDelete(id)` (= isActive=0); `hardDelete(id)` (checks eligibility, deletes user_roles via cascade); `touchLastLogin(id)`; remove the `role` column reads. Existing `verifyCredentials`, `updatePassword`, `resetUserPassword`, `findByEmail` keep their signatures but the safe-user payload now carries `roles: string[]` instead of `role: string`. |
| `models/settingsModel.js` | `settingsModel.js` | T | SMTP fields read/write with `smtpPasswordEncrypted` going through `utils/encryption.js`. Never returns the encrypted blob to the client — it returns a `smtpPasswordSet: boolean` mask field instead. Updating with `smtpPassword === undefined` preserves the existing value (same pattern as Google creds). |
| `utils/passwordGenerator.js` | — | C | Pure function `generateTemporaryPassword(length = 12)` — 12 chars from `[A-HJ-NP-Z][a-hj-km-np-z][2-9]`, no `I/O/l/0/1`. Move the existing inline generator out of `SettingsAccountantAccessSection` (which is being deleted). |
| `utils/emailService.js` | — | C | `createEmailService(settings) → { send(toEmail, subject, bodyPlain), sendTest(toEmail) }`. Wraps `nodemailer` (new dependency). Throws `EMAIL_NOT_CONFIGURED` when `settings.smtpHost` empty. Reads the decrypted password lazily. Pure plain-text emails (no HTML — keeps the code small and avoids the templating dependency for now). |
| `utils/emailTemplates.js` | — | C | Two pure functions: `welcomeEmailBody({ firstName, email, temporaryPassword, publicUrl })` → `{ subject, body }` and `passwordResetEmailBody(...)`. Returns French plain-text. |
| `controllers/usersController.js` | `usersController.js` | T | Extended: `list()` returns enriched users (with roles + lastLoginAt); `create({...})` orchestrates: validate → generate temp password → wrap in transaction → insert user + roles → send welcome email → on send failure, rollback; `update(id, payload)` (identity + roles); `resetPassword(id)` analogous to create (re-generate + email + rollback); `softDelete(id)` + `hardDelete(id)` with eligibility check + last-admin guard. All self-action checks reject `403 SELF_ACTION_FORBIDDEN`. **Follow-up #6:** new `updateSelf(req, res)` action — same identity-field validation as `create`, calls `usersModel.updateUser(req.user.id, { firstName, lastName, companyName, notes })` with NO `roles` and NO `email` keys (privilege guard). Returns 200 with the refreshed safe user, 401 when no session, 404 when the session id is gone from the DB. |
| `controllers/settingsController.js` | `settingsController.js` | T | New action `sendSmtpTest(req)` (destination = `smtpFromEmail`, see rule 17). SMTP field validation lives here (port range, email pattern). **2026-05-30:** `updateSettings` strips ALL whitespace from `smtp.password` before passing it to `settingsModel.upsert` so Gmail App Passwords (4-by-4 format `abcd efgh ijkl mnop`) auth correctly without surfacing the cleanup to the user. |
| `controllers/authController.js` | `authController.js` | T | `login` now calls `usersModel.touchLastLogin(user.id)` on success. `changePassword` now: if the *pre-change* session had `mustChangePassword=1`, **destroy the session** after the password update and return 204 (the client redirects to /login). Otherwise existing behaviour (session stays). |
| `middleware/requireAuth.js` | `requireAuth.js` | T | `req.user.roles` is the new shape. Allowlist check stays identical. |
| `middleware/enforceRoleAccess.js` | `enforceRoleAccess.js` | T | Multi-role aware: `userHasRole(req.user, 'admin')` rather than `req.user.role === 'admin'`. Allowlist for `accountant` extended to `/api/users/me` (read self). Admin-only group `/api/users` (except `/api/users/me`) gated here. |
| `routes/users.js` | `users.js` | T | Adds `PUT /api/users/:id`, `DELETE /api/users/:id` (soft), `DELETE /api/users/:id?hard=1` (hard), `GET /api/users/me` (self). Existing `POST /api/users` + `POST /api/users/:id/reset-password` stay but their response no longer carries `temporaryPassword`. **Follow-up #6:** adds `PUT /api/users/me` (self profile edit) **declared before** `PUT /api/users/:id` so the string `"me"` doesn't get routed as a numeric `:id`. |
| `routes/settings.js` | `settings.js` | T | Adds `POST /api/settings/smtp-test`. |
| `package.json` | `package.json` | T | New dep: `nodemailer@^6`. |
| `tests/` | `users-model.unit.test.js` | T | Extended for: roles join load/save, identity fields, lastLoginAt, softDelete vs hardDelete eligibility, last-admin guard, self-action invariants. |
| `tests/` | `users-controller.unit.test.js` | C | Mocks usersModel + emailService. Asserts: create rolls back on email send failure; reset rolls back; self-action 403; last-admin 400; hard-delete-not-eligible 400; SMTP-not-configured 400; payload reshaping. |
| `tests/` | `email-service.unit.test.js` | C | Pure-function tests on `emailTemplates` (rendered subject + body for create + reset); transport tests use an inline fake nodemailer to confirm `to/from/subject/text` wiring + `EMAIL_NOT_CONFIGURED` throw. |
| `tests/` | `password-generator.unit.test.js` | C | Length, character set whitelist, no excluded chars, plausible randomness over N=1000 calls. |
| `tests/` | `users-roles-migration.unit.test.js` | C | Idempotent migration: starts from a pre-spec DB (single `role` column), runs the migration, asserts `user_roles` populated, `users.role` gone; running it again is a no-op. |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `pages/UserManagementPage.js` | — | C | The unified `/account` page (renamed from `AccountsPage.js` on 2026-05-30 when the password section was merged in). **Three sections (in order):** "Mes informations" (`SelfProfileSection`, follow-up #6, every role), "Mon mot de passe" (`ChangePasswordForm`, every role), "Gestion des comptes" (admin only — list of users, AccountFormDialog, ConfirmDialogs). Reads `/api/users` + `/api/auth/me` + the roles constant. The list fetch is skipped for non-admins. The page also wires `useAuth().refresh()` after a successful self-update so the sidebar and dialog state pick up the new identity. |
| `pages/SettingsPage.js` | `SettingsPage.js` | T | Removes the Accès comptable card. Adds a new **Envoi d'emails (SMTP)** section + "Envoyer un mail de test" button. Includes a `MaskedTextField` for the SMTP password (same UX as Google creds). |
| `pages/ChangePasswordPage.js` | — | **D** | Deleted on 2026-05-30 — its responsibilities moved into `UserManagementPage`'s "Mon mot de passe" section. The first-login redirect-to-login flow (rule 15) is preserved verbatim inside the new section. |
| `pages/LoginPage.js` | `LoginPage.js` | T | Reads the `reason=password-changed` query param and shows the *"Mot de passe modifié. Reconnectez-vous avec votre nouveau mot de passe."* snackbar (one-shot). |
| `components/AccountFormDialog.js` | — | C | FormDialog-based create/edit form. Fields: prénom, nom, email (disabled in edit mode), rôles (multi-select), société, note. Surface server validation errors inline. Lives next to the page since it's specifically about user identity; not a generification of FormDialog. |
| `components/SelfProfileSection.js` | — | C | **Follow-up #6.** Self-service profile editor — Card with firstName, lastName, email (locked), companyName, notes + Save/Cancel buttons. No roles input (privilege guard). Submit + Cancel disabled until dirty; busy spinner on the Save button. Re-syncs its draft from `initialValues` on prop change (useful after `refreshAuth`). Owns its draft state; parent provides initial values + submit handler + busy + fieldErrors. |
| `components/SettingsAccountantAccessSection.js` | — | **D** | Deleted (the section is gone; the file too). |
| `components/AppSidebar.js` | `AppSidebar.js` | T | Adds the "Comptes" item (admin-only via `userHasRole(currentUser, 'admin')`). Inserted under "Paramètres" or near it. |
| `App.js` | `App.js` | T | Registers the `/account` route; **2026-05-30 round 1:** redirects `/comptes` and `/settings/password` to `/account` via `<Navigate replace />`; renames the sidebar entry to "Gestion utilisateur" and moves it from a top-level item to a submenu of "Paramètres"; removes the admin-side `Paramètres > Mot de passe` submenu; switches the accountant-confinement guard to allow `/account`. **2026-05-30 round 2 (follow-up #5):** the dedicated accountant sidebar branch is **removed**. `NavContent` now renders a single tree for all roles; each `<ListItemButton>` is wrapped with `canSeeRoute(user, path)` (top-level + every submenu child). Submenu parents (Calendrier, Suivi financier, Paramètres) are gated by `canSeeAnyRoute(user, children)` so they survive when at least one child is visible. When the parent's own path isn't reachable (accountant on `/settings`), the row drops its `Link` props (no navigation) and the drawer-close callback is suppressed — clicking it only toggles the submenu. The `CALENDAR_CHILDREN` / `FINANCE_CHILDREN` / `SETTINGS_CHILDREN` constants list the children authoritatively next to the JSX. |
| `constants/roles.js` | — | C | Mirror of the server constants file. Imported by `AccountFormDialog`, `AppSidebar`, `App.js`. The two files must stay in sync — a unit test on each side checks the list (server self-check, client snapshot). **2026-05-30 follow-up #5:** also exports `ROUTE_ROLES` (per-route allowlist), `canSeeRoute(user, path)` and `canSeeAnyRoute(user, paths)` — the helpers driving the unified sidebar filter in `App.js`. Server `enforceRoleAccess` remains the authoritative gate; the client map is the UI projection (a drift test pins the accountant scope to exactly `/comptabilite` + `/account`). |
| `api.js` | `api.js` | T | Adds `updateUser`, `deleteUser(id, {hard})`, `sendSmtpTest()`, `getMe()`. Updates `listUsers` shape. |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `PageActionBar`, `DataPageScaffold`, `FormDialog`, `ConfirmDialog`, `MaskedTextField`, `StatusBadge`, `EmptyState`, `ErrorAlert`, `LoadingState` | All pre-existing per CLAUDE.md §7. The MaskedTextField is also used for the new SMTP password field. |
| **Created (new generic)** | — | None. The dialog is feature-specific. |
| **Specific (kept feature-local)** | `AccountFormDialog` | Tied to the users domain (identity + role validation + email lock). Composing it from `FormDialog` + raw MUI inputs keeps the validation co-located. |

### 4.3 API contract

| Method | Endpoint | Request body | Response | Notes |
|---|---|---|---|---|
| GET | `/api/users` | — | `[{ id, firstName, lastName, email, roles, companyName, notes, isActive, mustChangePassword, lastLoginAt }]` | admin only |
| GET | `/api/users/me` | — | `{ id, firstName, lastName, email, roles, mustChangePassword }` | any authenticated |
| PUT | `/api/users/me` | `{ firstName, lastName, companyName?, notes? }` | 200 `{ user }` (refreshed safe user) | any authenticated. Email + roles are STRIPPED server-side (never updated even if passed). Follow-up #6. |
| POST | `/api/users` | `{ firstName, lastName, email, roles: string[], companyName?, notes? }` | 201 `{ id, firstName, lastName, email, roles, companyName, notes, isActive: 1, mustChangePassword: 1, lastLoginAt: null }` | admin only. Sends welcome email; rolls back on failure (502). 400 if SMTP unconfigured. |
| PUT | `/api/users/:id` | `{ firstName, lastName, roles, companyName?, notes? }` | 200 same shape | admin only. Email not editable here. |
| POST | `/api/users/:id/reset-password` | — | 204 | admin only. Sends reset email; rolls back on failure. |
| DELETE | `/api/users/:id` | — | 204 | Soft delete (isActive=0). admin only. |
| DELETE | `/api/users/:id?hard=1` | — | 204 | Hard delete. admin only, eligibility-checked. |
| POST | `/api/auth/change-password` | (unchanged) | 204 | When the user **had** `mustChangePassword=1` pre-change, the response also destroys the session. Client redirects to /login. |
| POST | `/api/auth/login` | (unchanged) | (unchanged) | Touches `users.lastLoginAt` on success. |
| GET | `/api/settings` | — | (extended) returns SMTP fields + `smtpPasswordSet: boolean` + `publicUrl` | admin only. |
| PUT | `/api/settings` | (extended) `{ ..., smtpHost?, smtpPort?, smtpSecure?, smtpUsername?, smtpPassword?, smtpFromEmail?, smtpFromName?, publicUrl? }` | 200 (extended) | admin only. `smtpPassword` omitted → preserves existing. |
| POST | `/api/settings/smtp-test` | — | 200 `{ ok: true }` or 400 `{ error: 'SMTP_TEST_FAILED', detail }` | admin only. Sends a test mail to the current admin's email. |

Error shapes (consistent with existing routes): `{ error: <ERROR_CODE>, message?: string, field?: string }`.

---

## 5. Data model

### 5.1 `users` table

**Added columns** (all NOT NULL with safe defaults so the migration is no-rewrite):
- `firstName TEXT NOT NULL DEFAULT ''`
- `lastName TEXT NOT NULL DEFAULT ''`
- `companyName TEXT NOT NULL DEFAULT ''`
- `notes TEXT NOT NULL DEFAULT ''`
- `lastLoginAt TEXT` (nullable — null = never logged in)

**Removed column:** `role TEXT` — replaced by the join table.

### 5.2 `user_roles` table (new)

```sql
CREATE TABLE IF NOT EXISTS user_roles (
  userId INTEGER NOT NULL,
  role TEXT NOT NULL,
  PRIMARY KEY (userId, role),
  FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
);
```

A user MUST have ≥1 row in `user_roles`. The constraint is enforced by the model (SQLite doesn't
support a row-count CHECK on a referencing table); the migration backfills one row per user.

### 5.3 `app_settings` table

**Added columns** (all DEFAULTs so old rows stay valid):
- `smtpHost TEXT DEFAULT ''`
- `smtpPort INTEGER DEFAULT 587`
- `smtpSecure INTEGER NOT NULL DEFAULT 0` (`0` = STARTTLS, `1` = implicit TLS)
- `smtpUsername TEXT DEFAULT ''`
- `smtpPasswordEncrypted TEXT DEFAULT ''` (AES-256-GCM payload, **never** logged)
- `smtpFromEmail TEXT DEFAULT ''`
- `smtpFromName TEXT DEFAULT 'GuestFlow'`
- `publicUrl TEXT DEFAULT ''`

### 5.4 Migration strategy

Single transaction in `database.js`:
1. `BEGIN`.
2. `ALTER TABLE users ADD COLUMN ...` × 5 (idempotent — guarded by reading `PRAGMA table_info`).
3. `CREATE TABLE IF NOT EXISTS user_roles ...`.
4. If `(SELECT COUNT(*) FROM user_roles) == 0` AND the `users.role` column still exists:
   `INSERT INTO user_roles(userId, role) SELECT id, role FROM users WHERE role IS NOT NULL AND role <> ''`.
5. If `users.role` still exists, perform the SQLite "drop column" dance: `CREATE TABLE users_new (...)` without `role`, `INSERT INTO users_new SELECT (everything except role) FROM users`, `DROP TABLE users`, `ALTER TABLE users_new RENAME TO users`, re-create the unique index on email. Skip the whole block if `role` is already gone.
6. `ALTER TABLE app_settings ADD COLUMN ...` × 8 (idempotent).
7. `COMMIT`.

**Data impact:** zero loss. Every existing role is preserved in the join table. Existing sessions
keep working because `req.user.roles = ['admin']` is computed from the join table at every
request (sessions only store `id`, not the full user). The default admin keeps `admin` role.
SMTP fields start empty — the new account-creation endpoint returns
`400 SMTP_NOT_CONFIGURED` until Adrien sets them.

## 6. UI / UX

### 6.1 `/account` — Gestion utilisateur (admin's accounts-list view)

- **PageActionBar:**
  - `title`: "Comptes"
  - `backTo`: omitted (top-level page)
  - `actionsBefore`: `[]`
  - **Add action** is rendered as a primary button via the `DataPageScaffold` top action (per the existing list pattern: `actionLabel: "Ajouter un compte"`, `actionIcon: <PersonAddAlt1Icon />`, `onAction: openCreateDialog`).
  - `onSave` / `onCancel`: omitted (the bar has no global save state).
- **Table columns** (md+): Nom (Prénom + Nom + Email under it small), Rôles (chips), Société, Dernière connexion, Statut, Actions. On `xs`, the table collapses into stacked cards: header line (name) + chip row + key/value pairs. Implementation: render the cards via a `Box` switch on `useMediaQuery(theme.breakpoints.down('md'))` — pre-existing pattern in `ClientsPage.js`.
- **Action icons** (right-aligned per row): edit (✏️ `<EditIcon />`), reset password (🔑 `<VpnKeyIcon />`), toggle active (`<ToggleOnIcon />` / `<ToggleOffIcon />`), delete (🗑 `<DeleteOutlineIcon />`). Tooltips French. ≥44 px touch targets.
- **Statut chip:**
  - `Actif` (success, outlined) — `isActive=1` AND `mustChangePassword=0`.
  - `Doit changer son mot de passe` (warning, outlined) — `isActive=1` AND `mustChangePassword=1`.
  - `Désactivé` (default, outlined) — `isActive=0`. Row is greyed (`opacity: 0.6`).
- **Empty state:** when the list has only the current admin, show *"Aucun autre compte. Cliquez sur **Ajouter un compte** pour inviter un collaborateur ou un comptable."*

### 6.2 `AccountFormDialog`

- MUI `Dialog` with `fullScreen={isMobile}` (existing `FormDialog` shape).
- Fields stacked, `xs={12}` MUI Grid each.
- **Prénom**, **Nom**: standard `TextField`.
- **Email**: `TextField type="email"`, disabled in edit mode (chip tooltip *"L'email n'est pas modifiable depuis ce formulaire."*).
- **Rôles**: `Select multiple` with `renderValue` showing chips; each option labelled in French (`Admin`, `Comptable`); the current user's own row in edit mode locks the `admin` checkbox (per rule 12).
- **Société**: optional `TextField`.
- **Note**: optional `TextField multiline rows={3}`.
- **Save button** in the dialog footer (label "Créer le compte" in create mode, "Enregistrer" in edit mode). Save shows a spinner during the API call. Server validation errors land under their field (`emailExists` → email field; `rolesRequired` → rôles field).

### 6.3 Reset / Delete confirm dialogs

- **Reset:** *"Réinitialiser le mot de passe de **<name>** ? Un nouveau mot de passe provisoire lui sera envoyé par email à <email>."* — confirm = "Envoyer".
- **Soft delete:** *"Désactiver le compte de **<name>** ? Il ne pourra plus se connecter, mais ses informations sont conservées."* — confirm = "Désactiver", button colour warning.
- **Hard delete (only when eligible):** double confirm — first the soft-delete dialog, with a secondary button "Supprimer définitivement" (red). Disabled with tooltip if not eligible. On click → second dialog *"Supprimer définitivement le compte ? Cette action est irréversible."* — confirm = "Supprimer", colour error.

### 6.4 SMTP section in `/parametres`

- New card titled **Envoi d'emails (SMTP)**, in the same column flow as the other settings cards, *above* the "Sauvegarde" group.
- Fields: SMTP Host, Port (number), Sécurité (`Select` with options *Aucun (STARTTLS)* / *TLS implicite*), Utilisateur, Mot de passe (MaskedTextField), Adresse expéditeur, Nom expéditeur, URL publique.
- A help caption under URL publique: *"Cette URL est insérée dans les emails envoyés aux utilisateurs (ex. https://guestflow.adn-dev.fr)."*
- "Envoyer un mail de test" button, disabled while any required SMTP field is empty. On click: calls `POST /api/settings/smtp-test`, shows success (*"Mail de test envoyé à <adminEmail>."*) or the error detail in a snackbar.

### 6.5 Login + ChangePassword flow

- ChangePasswordPage: after a successful submission while `mustChangePassword === true`, the page
  triggers `navigate('/login?reason=password-changed')` (no automatic re-login).
- LoginPage: reads `?reason=password-changed` once and shows a green snackbar
  *"Mot de passe modifié. Reconnectez-vous avec votre nouveau mot de passe."*. The user re-enters
  email + new password.

### 6.6 Responsive

- `/comptes`: cards-instead-of-table on `xs` (per 6.1). Dialogs full-screen on `xs`. Icon
  buttons have ≥44 px hit area.
- `/parametres`: SMTP card behaves like the other cards (single column on `xs`).
- Sidebar item "Comptes" hidden on `xs` is **NOT** done — it stays in the mobile drawer so admins
  can manage accounts from a phone if needed.

## 7. Test plan

### Server unit tests

- [ ] `users-roles-migration.unit.test.js` — pre-spec DB (single `role` column) migrates to
      post-spec DB (no `role` column, populated `user_roles`); idempotent re-run is a no-op;
      seeded default admin keeps `admin` role.
- [ ] `users-model.unit.test.js` (extended) — load+save with new identity fields; roles always
      returned as `string[]`; `setRoles(id, ['admin','accountant'])` overwrites atomically; saving
      `[]` throws `ROLES_REQUIRED`; `softDelete` flips `isActive`; `hardDelete` rejects when
      `lastLoginAt` set; `touchLastLogin` updates the column; `findActiveAdminCount` returns the
      right count; remove-last-admin sequence throws `LAST_ADMIN`.
- [ ] `users-controller.unit.test.js` (new) — happy create; create returns 502 + rolls back on
      email failure (model called with delete in tx); create returns 400 on SMTP unconfigured;
      reset rolls back on email failure; soft delete OK; hard delete eligibility check; self
      actions → 403; last-admin protection → 400; payload reshaping (no temporary password in
      response).
- [ ] `email-service.unit.test.js` (new) — `emailTemplates` rendered French body contains the
      temp password + the public URL + the email; throws `EMAIL_NOT_CONFIGURED` when `smtpHost`
      empty; transport `send` called with the right shape using a stubbed transport.
- [ ] `password-generator.unit.test.js` (new) — generated string is length 12, no `I/O/l/0/1`,
      hits at least 3 character classes; 1000 generations all unique within statistical bounds.
- [ ] `auth-controller.unit.test.js` (extended) — change-password after a `mustChangePassword=1`
      session destroys the session; ordinary change-password keeps it; login touches lastLoginAt.
- [ ] `enforce-role-access.unit.test.js` (extended) — multi-role admin reaches every route;
      a `[accountant]` user reaches only the existing accountant allowlist + `/api/users/me`;
      admin + accountant combined → admin wins.
- [x] `settings-smtp-test.unit.test.js` (new, 2026-05-30) — `sendSmtpTest` sends to
      `smtpFromEmail` (NOT `req.user.email`); SMTP-not-configured short-circuits; transport
      rejection surfaces detail; succeeds without `req.user.email`.
- [x] `settings-controller-smtp-password.unit.test.js` (new, 2026-05-30) — whitespace stripping
      on `smtp.password`: Gmail 4-by-4 format, tabs/newlines/leading/trailing, no-whitespace
      pass-through, empty/null clear, absent property preserve, whitespace-only → clear.
- [x] `email-templates.unit.test.js` (extended, 2026-05-30) — every template signs with the
      configured `fromName`; falls back to `GuestFlow` when missing; the auto-generated notice
      is present on welcome / reset / test bodies.
- [x] `users-controller.unit.test.js` (extended, 2026-05-30) — `create` and `resetPassword`
      flow `fromName` from `settingsModel.decryptedSmtpSettings()` into the templates.

### Client unit tests

Stack: Jest + React Testing Library (CRA built-in).

- [x] `client/src/constants/__tests__/roles.test.js` (new, 2026-05-30, 14 cases) — `ROLES` frozen
      taxonomy; `roleLabel` returns French labels or echoes unknowns; `userHasRole` matches the
      post-M2 array, falls back to the legacy `role` string (back-compat shim), array takes
      precedence over the string, returns false for null/empty payloads. **Follow-up #5:**
      `canSeeRoute` admits every registered route for admin, accountant sees ONLY
      `/comptabilite` + `/account` (drift pinned), multi-role admin+accountant wins admin scope,
      unknown route → false (deny by default), null user → false; `canSeeAnyRoute` returns true
      iff at least one path is visible (parent submenu visibility predicate).
- [x] `client/src/pages/__tests__/UserManagementPage.test.js` (new, 2026-05-30, 6 cases) —
      admin sees both sections + the list endpoint is called; accountant sees only
      "Mon mot de passe" + listUsers is NOT called; legacy `role: 'admin'` session still admits
      the admin section (back-compat shim); multi-role admin+accountant → admin wins; null user
      shows the password section only and never calls listUsers; admin-side listUsers failure
      surfaces an error Alert without crashing the page.
- [x] `client/src/components/__tests__/AccountFormDialog.test.js` (new, 2026-05-30, 5 cases) —
      email editable in create, disabled + lock caption in edit; self + admin role check is
      locked with the protection caption; server-side `fieldErrors` land under the matching
      input; submit forwards trimmed identity fields and the roles array.
- [x] `client/src/components/__tests__/SelfProfileSection.test.js` (new, 2026-05-30
      follow-up #6, 7 cases) — pre-fills every editable field + locks the email; Save/Cancel
      disabled until dirty, Cancel restores then re-disables; submit forwards a trimmed payload
      containing ONLY `firstName / lastName / companyName / notes` (no email, no roles);
      `busy=true` disables inputs + adds the Save spinner; `fieldErrors` land under the matching
      input; `initialValues` prop change syncs the form; `null initialValues` doesn't crash.
- [x] `client/src/pages/__tests__/UserManagementPage.test.js` (extended, follow-up #6, 4 new
      cases) — "Mes informations" section renders for admin / accountant / legacy-shape
      sessions; successful submit calls `api.updateSelf` + `refresh()` + shows the success
      snackbar; field-level errors land under the input (no snackbar); generic errors fall to
      the snackbar.
- [x] `server/src/tests/users-controller.unit.test.js` (extended, follow-up #6, 6 new cases) —
      `updateSelf` happy path; payload NEVER carries `roles` even when supplied (privilege guard
      assertion); payload NEVER carries `email` even when supplied; empty firstName / lastName
      → 400; no `req.user` → 401; session id missing from DB → 404.

### Manual UI verification

- [ ] Configure SMTP via /parametres → "Envoyer un mail de test" → received in mailbox.
- [ ] /comptes → create a new account with role accountant → email received → log in with the
      temp password → forced change-password page → submit → redirected to /login with snackbar
      → log in with the new password → arrives logged in.
- [ ] /comptes → reset that user's password → new email arrives with new temp pass; old pass
      no longer works.
- [ ] /comptes → toggle "Désactiver" on that user → login attempt with their credentials fails.
- [ ] /comptes → create a 3rd user who's never logged in → "Supprimer définitivement" available;
      delete; they're gone from the list.
- [ ] /comptes → on admin's own row, the delete/reset/role-admin controls are disabled with
      tooltips.
- [ ] /comptes → attempt to leave zero active admins by removing admin role from oneself → 400
      snackbar "C'est le dernier compte admin actif."
- [ ] /parametres → Accès comptable section is gone.
- [ ] Mobile (`xs`): /comptes renders as stacked cards; dialogs are full-screen.

## 8. Out of scope

- **Audit log** of admin actions (who reset whose password, when). Out of scope; could be added
  later by writing to a new `audit_log` table.
- **Email change** for an existing user. Out of scope; treated as deletion + recreation for now.
- **HTML email templates** / branded layout. Plain-text-only for this spec; templating layer
  comes later if needed.
- **Granular role permissions** (custom permissions per role). Out of scope — the existing
  binary `admin` vs `accountant` enforcement stays.
- **Per-user 2FA**. Out of scope.
- **Password reset by the user themselves** (a "Forgot password" link on /login). Out of scope —
  reset stays admin-initiated for now. Adrien can add a self-serve flow later (it would reuse
  the same `emailService` + `passwordGenerator`).
- **i18n.** All copy is French only.

## 9. Open questions

(Resolved before moving Status to Approved.)

- Q1: Should the welcome email also include the public URL of the deployed app as a clickable
  link, or is plain text fine? — **A:** Plain text with the URL as a literal (most plain-text
  clients linkify automatically). Decided in §3.4 rule 14.
- Q2: Where does `app_settings.publicUrl` come from for the very first creation (when Adrien
  hasn't filled it yet)? — **A:** Empty string surfaces a 400 `PUBLIC_URL_NOT_CONFIGURED` to
  match the SMTP behaviour. The admin fills both at the same time in /parametres before
  inviting anyone.
- Q3: Should the seeded default admin (`admin@guestflow.local`) be renameable? — **A:** Yes
  — `firstName`/`lastName`/`notes` can be edited like any user. Email is locked to
  `admin@guestflow.local` per rule 8.
- Q4: What's the desired email "from" address? — **A:** `smtpFromEmail` is required for any
  account creation. The "from name" defaults to `'GuestFlow'`. Admin can override both.
