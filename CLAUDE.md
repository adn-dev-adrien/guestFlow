# CLAUDE.md — GuestFlow

Working agreement between Adrien and Claude on the GuestFlow codebase.
This file is loaded into Claude's context for every session in this repo.

---

## 1. Project at a glance

**GuestFlow** is a web app to manage tourist accommodations: bookings, clients, properties, finances, devis (PDF quotes), Google Calendar sync, iCal sync/export.

- **Frontend:** React 18, Material UI 5, Recharts, React Router 6
- **Backend:** Node.js, Express 4
- **Database:** SQLite (better-sqlite3), auto-migrated on startup
- **Deploy:** versioned releases published by GitHub Actions on a tag; the running app installs them itself on the operator's click (`specs/self-update-and-releases.md`)

See `README.md` for setup, dev, and deployment details.

---

## 2. Working language

- **Conversation with the user:** French.
- **Code, comments, commit messages, PR descriptions, specs, docs:** English.

Never mix: a French commit or English chat reply is a bug.

---

## 3. Collaboration workflow

The default loop is **spec-driven, plan-validated, autonomously implemented**.

### 3.1 Standard loop

1. **Discuss the need** in chat (French).
2. **Write the spec** in `/specs/<feature-name>.md` using `/specs/TEMPLATE.md`.
3. **User validates the spec.**
4. **Produce an implementation plan** (via `ExitPlanMode`) covering files to touch, DB impact, test plan, UI changes.
5. **User validates the plan.**
6. **Implement** (in the working tree, on whatever branch the user has checked out): code, server tests, visual UI verification, CHANGELOG update, spec status → `Implemented`.
7. **Hand off to the user** with a concise summary. **The user handles all git operations** (branching, staging, committing, pushing, PR creation).

### 3.2 When to skip the spec

Genuinely trivial changes do not need a `/specs/` entry:

- Typo fixes
- Single-constant tweaks
- One-line obvious bugfixes
- Config adjustments with no functional impact

For these: commit, PR. When in doubt → write the spec.
Everything else (new feature, change in business logic, UI rework, schema change) requires a spec.

### 3.3 Autonomy boundaries

After plan validation, drive the implementation end-to-end without checking in for each step. Report concisely at the end. Pause and ask only if:

- A non-trivial decision wasn't covered by the spec.
- A discovery contradicts the plan (existing code conflict, missed dependency).
- A risky/destructive action becomes necessary (data migration with potential loss, dependency downgrade, force push).

### 3.4 Asking the user

**Systematic rule — every decision put to the user goes through the `AskUserQuestion` interactive questionnaire.** Whenever you offer the user a choice between options — which approach, "ship now vs keep building", which provider/library, a scope or naming decision, "option A or B", "1/2/3", etc. — you MUST present it as an `AskUserQuestion` (one or more questions, 2–4 options each; put the recommended option first and label it "(Recommended)" when you have one). **Never** write the options out in prose for the user to pick from (no "Dis-moi A ou B", no numbered lists of choices in the chat body).

Plain French prose is only for free-form clarifications that genuinely have no discrete option set (e.g. "what's the exact wording you want here?").

---

## 4. Specifications (`/specs/`)

- **Location:** `/specs/<short-kebab-name>.md`, versioned with the code.
- **Template:** every spec uses `/specs/TEMPLATE.md`. Mandatory sections: Context, Goal, Functional Rules, **Architecture (Server / Client / API)**, Data Model, UI / UX, Test Plan, Out of Scope, Open Questions.
- **Architecture section is non-negotiable:** every spec must list explicitly which server layers (routes/controllers/models/middleware/utils/tasks/database) and which client layers (pages/components/hooks/services/utils/constants) are touched or created, with a one-line responsibility each. A reader should be able to picture the full code map before reading any code.
- **Status field:** `Draft` → `Approved` → `Implemented`. Keep it up to date.
- **The spec is the source of truth for *why*** a feature exists. Code answers *what*; the spec answers *why*.

### 4.1 Specs must stay in sync with the code — always

**Every user feedback / correction / scope change during or after implementation MUST update the matching spec at the same time as the code.** Specs that lag behind reality are worse than no specs — they mislead future readers (including future-you and future-Claude).

Applies to *all* of these situations:
- Bug fixes that change observable behavior (even cosmetic ones like "row click opens edit", "default value changed").
- UX tweaks (icon placement, label wording, sidebar location).
- Scope changes (a feature is widened, narrowed, deferred).
- Validation rule adjustments.
- API contract changes (even backward-compatible additions).

**Concrete rule:** when the user gives feedback on an already-implemented spec, the same commit (or a same-PR follow-up commit) must update the spec markdown. Push the spec change alongside the code change — never skip it because "the spec is already merged."

If a feedback proves the spec was *wrong* (vs. *incomplete*), the spec fix is even more important than the code fix — write down what the right behavior is so it doesn't drift back later.

**Pre-commit checklist — must run for EVERY user-requested change, no matter how small:**

1. Is there a `/specs/<name>.md` that covers this feature? → If yes, the spec MUST be updated in the same commit (or a follow-up commit on the same PR before push). If no, write one even retroactively.
2. Did this change add / move / remove a route, an endpoint, a page, a sidebar item, a column, a field, a button, a behavior? → Add it to the Functional rules, Architecture, API contract, or UI / UX section as appropriate.
3. Did this change resolve an Open Question? → Move it from §9 to a "Resolved" answer with the date + the actual choice.
4. Did the test count change? → Update the Test plan counts (and the Implementation progress §10).

**This rule has no size threshold.** A 3-line URL-params tweak, a one-icon change, a copy edit, a tooltip — all count. The spec is the single durable record of *why* the UI looks like it does; every "small" tweak ungrounds it a little more if it doesn't land in the spec.

**If you catch yourself committing code without touching the spec for a user-requested change, stop, amend the commit (or push a follow-up) before moving on.** Apologising about it later doesn't recover the spec — only an immediate fix does.

---

## 5. Git & branches

**Current policy: Claude owns the full git pipeline — branch, commit, push, AND pull request creation (via `gh`).** The user only reviews and **squash-merges** the PR in the GitHub web UI. Claude never merges.

### 5.1 What Claude does

For every spec retro-implementation:
1. **As soon as a spec is approved**, before entering plan mode for implementation, create the working branch from up-to-date `master`:
   ```bash
   git checkout master && git pull
   git checkout -b feature/<short-kebab-name>
   ```
2. **Implement** the spec on that branch (after the plan is approved).
3. **Stage explicit files only** — never `git add -A` or `git add .`. List each file by path so secrets and accidental binaries can't slip in.
4. **Commit** with a Conventional Commit message in English (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`), scoped (`feat(settings):`, `feat(db):`) and bodied with bullet points describing what + why. Always include the Co-Authored-By trailer.
5. **Push** to `origin`: `git push -u origin feature/<short-kebab-name>`.
6. **Create the pull request** with `gh pr create --base master` — English title (Conventional-Commit style) + a body summarizing what/why, the spec link, and the test/verification status. **Hand off the PR URL** to the user, who reviews and **squash-merges** in the GitHub web UI. Claude never merges.
7. After the user confirms the merge, **return to master and pull**:
   ```bash
   git checkout master && git pull
   ```
   Then the next spec can start from a clean tree.

### 5.2 What Claude does NOT do

- Push to `master` directly.
- Force-push anywhere.
- **Merge** PRs — with **one exception, the release PR** (see §5.6). Everywhere else Claude may create PRs with `gh pr create` and read PR status, but never `gh pr merge`.
- Cut a release, tag, or install one in production without being asked (see §5.6).
- Skip hooks (`--no-verify`), bypass signing, or amend pushed commits.
- Run destructive commands (`reset --hard`, `clean -f`, branch deletion) without explicit user instruction.

### 5.3 Conventions

- **Branches:** `feature/<short-kebab-name>` for features, `fix/<short-kebab-name>` for bug fixes.
- **Target branch:** `master`.
- **Merge strategy:** **squash merge** (user-enforced in the GitHub UI). Keeps `master` history one-commit-per-feature.
- **Release trigger:** the tag `vX.Y.Z` on `master` (see §5.6). There is no deployment branch any more.

### 5.4 Conflict / safety rules

- If `git pull` on `master` reports conflicts or a stale local state, **stop and ask the user** rather than auto-resolving with `--ours` or `--theirs`.
- If the working tree is dirty when a new spec starts, **stop and ask** — never auto-stash or auto-discard. The user may have in-progress work.
- If `git push` is rejected (e.g. someone pushed the same branch name), **stop and ask** — never `--force`.

### 5.5 Detecting whether a branch is already on `master` (squash-merge caveat)

**The user always merges PRs with "Squash and merge" in the GitHub UI.** A squash collapses all of a branch's commits into **one brand-new commit on `master` with a different SHA**, then GitHub auto-deletes the head branch. Consequence: the branch's original commits are **never ancestors of `master`**, so the usual ancestry checks **lie**:

- ❌ `git branch --merged master` — will NOT list a squash-merged branch.
- ❌ `git merge-base --is-ancestor <branch> master` — returns "not an ancestor" even when the work *is* in master.
- ❌ "the branch was deleted on GitHub, so it's merged" — **false**: a deleted branch can mean *merged* **or** *closed/abandoned*. Deletion alone proves nothing.

**The only reliable check is by CONTENT, not by commit graph:**

1. **Is the branch still open?** `git ls-remote --heads origin <branch>` — empty output means the remote branch is gone (merged *or* closed); a SHA means the PR is still open and unmerged.
2. **Is the work actually in master?** Verify the branch's changes are present in `origin/master`:
   - file existence: `git ls-tree -r origin/master --name-only <path>`
   - or a distinctive string from the diff: `git grep "<unique snippet>" origin/master -- <pathspec>`
3. **Find the squash commit** by feature name / PR number in the linear history: `git log origin/master --oneline | grep -i "<feature-or-#NN>"`.

**Rule:** before claiming a branch is merged — or before deleting/recreating one — `git fetch origin` first, then confirm by **content (steps 2–3)**, never by ancestry. If the branch is gone from the remote **but** its content is absent from `master`, treat it as **lost work (closed-without-merge or accidental deletion)** and surface it to the user — do not silently assume it shipped.

---

### 5.6 Releases and production updates

Production runs **published releases**, never a branch. The full model lives in
`specs/self-update-and-releases.md`; the operating rules:

- **`X.Y.Z` has a defined meaning** (`specs/self-update-and-releases.md` §3.A rule 2), and the skill
  derives the number from it: **X** = a structural change or a contract lost for a consumer outside
  this repository (`/public/v1/**` for the WordPress plugin, the iCal export feeds) — never derived,
  always the user's explicit call; **Y** = an improvement, the ordinary case; **Z** = bug fixes and
  nothing else. A change to `/api/**` is not an X: client and server ship in one archive and install
  together, so no consumer can lag behind them.
- **Claude squash-merges the release PR, and only the release PR** (granted 2026-08-22). The
  authorisation is narrow on purpose: it covers a `release: vX.Y.Z` PR that the release skill itself
  opened in the current run, on a `release/vX.Y.Z` branch, containing nothing but the three version
  bumps and the changelog fold. Every other PR in this repository stays the user's to merge. The
  merge is **squash**, and it happens **only once every check reports `pass`** — re-read immediately
  before merging, never trusted from an earlier look. `--admin` is forbidden: bypassing a pending or
  failing check is exactly what this authorisation is not.
- A release is cut with the **`/guestflow-release` skill**: pre-flight suites → fold `changelog.d/`
  into a `CHANGELOG.md` section → write the operator digest → bump the three `package.json` files →
  `release/vX.Y.Z` PR → the user squash-merges → Claude tags `vX.Y.Z` on `master` →
  `.github/workflows/release.yml` publishes the archive, its `SHA256SUMS` and the WordPress plugin.
  Since 2026-08-22 the skill merges that PR itself once the CI is green, so a release runs end to
  end from a single request; never end a release turn asking to be told the PR was merged.
- **The release notes are mandatory.** The GitHub release body IS the `CHANGELOG.md` section, and
  that section is what the operator reads in the update dialog before clicking "Installer". The
  `verify` job fails the release when it is missing, when the three versions disagree with the tag,
  or when a `changelog.d/` fragment was left unfolded. Never bypass that job.
- **Every section opens with its operator digest** — a `### Summary` block of at most 6 lines of at
  most 160 characters, and it is the *only* thing the update dialog shows; the rest is folded behind
  « Tout le changelog » (`specs/self-update-and-releases.md` rule 20c). It is written **in French**,
  the single exception to §2 in this repository, because it exists to be read inside the application
  by a French operator. `node scripts/build-changelog.mjs --check-digest X.Y.Z` judges it, and the
  `verify` job runs that same command.
- **Publishing is not deploying.** GuestFlow polls GitHub hourly and offers the version; the
  operator installs it from Réglages → Système et mises à jour. Claude never triggers an install,
  and never SSHes into production to "finish" a release.
- **Never re-introduce a self-hosted CI runner.** The repository is public and the production host
  holds the guest database, the encryption key and the session secret; a runner there is arbitrary
  code execution from GitHub into the LAN. Production makes outbound calls only. Any PR adding
  `runs-on: self-hosted` to this repository is a security regression, whatever it automates.
- The only sanctioned force-push in this repository is `git push --force origin vX.Y.Z` to re-point
  a **tag** after a failed `verify`. §5.2's ban on force-pushing branches stands.

---

## 6. Architecture

### 6.0 Core principle — **Fat backend, thin frontend**

The backend is the single source of truth and owns **all complexity**.
The frontend is responsible for **rendering and user interaction only**.

**Belongs on the backend:**
- All business logic, rules, and calculations (finance, pricing, deposits, balances, occupancy, dates, durations).
- Data shaping for display: aggregations, derived fields, computed statuses, sorted/grouped/paginated payloads.
- All persistence, schema, migrations, encryption.
- Authoritative validation (the only validation that can reject a write).
- Domain formatting that requires business rules (e.g. invoice numbering, reservation totals, French-locale date labels).

**Belongs on the frontend:**
- Rendering React components.
- Local UI state (modals open/closed, current tab, form field focus, dirty-form guard).
- User interaction (form input, drag/drop, navigation).
- Lightweight UX validation (e.g. "field required" hint before submit) — strictly as a UX improvement, never as a security/correctness guard.
- Pure presentational formatting (CSS, MUI props, color of a badge).

**Anti-patterns to refuse:**
- Computing a total/price/balance in React.
- Re-implementing a server-side rule on the client "for performance".
- Sending half-shaped data and letting the client finish the work.
- Building a derived list/aggregate in the React component instead of asking the server for it.

When in doubt: **if the rule could ever matter for correctness, audit, or money, it lives on the server.**
The client receives ready-to-render payloads — ideally a new endpoint or query parameter rather than client-side post-processing.

### 6.1 Backend (`server/src/`)

```
routes/         Express endpoints — thin, delegate to controllers
controllers/    Request handlers — orchestrate models & utils
models/         DB access layer (better-sqlite3)
middleware/     Auth, encryption, validation
utils/          Helpers (encryption, formatting, etc.)
tests/          Unit tests (node --test)
scheduledTasks.js  Background jobs
database.js     Schema + auto-migrations on startup
index.js        Express entry (port 4000)
```

Routes stay thin. Business logic lives in controllers/models with unit tests.

**Current state vs. target state:**
The existing codebase puts most logic directly in route files (some are 1100–1200 LOC monoliths) and the `controllers/` / `models/` / `middleware/` directories are mostly empty. This is recognized technical debt.

**Refactoring policy when touching a feature:**
- Every feature touched in a retro-spec or new spec must extract logic from the route into a `controllers/<feature>Controller.js` (orchestration) and `models/<feature>Model.js` (DB access).
- Routes become thin: parse request → call controller → return result.
- Reusable business helpers go in `utils/`.
- Add unit tests for the extracted controller/model logic.

**No-breaking-change rule:**
When a server refactor changes an endpoint's signature or payload, the client MUST be updated in the same implementation session. Never leave the app in a broken or backward-compat-shim state between sessions.

### 6.2 Frontend (`client/src/`)

```
pages/          Route-level views
components/     Reusable components — extract progressively
hooks/          Custom hooks
services/       API & business clients
utils/          Helpers
constants/      Enums, fixed values
styles/         Theme overrides
```

**Component extraction policy:** when a page grows large or repeats a UI block, extract a focused component into `components/`. See §7 "Component reuse".

---

## 7. Code conventions

### General

- No dead code, no commented-out blocks, no "// removed for X" markers.
- No comments restating what the code does. Only add a comment when the *why* is non-obvious.
- Prefer editing existing files over creating new ones.

### React

- **Render, don't compute.** No business logic, no calculations, no derived data shaping. If you find yourself writing a `reduce`, `groupBy`, price math, date math, or status derivation in a component — stop and add a backend endpoint instead.
- Match existing patterns (MUI components, hooks, function components).
- Keep new components small and focused; lift state up when shared.
- French UI strings stay in `client/src/constants/` or co-located near the page that uses them — never hardcode in the middle of JSX if reused.
- Local UI state only (modals, tabs, form drafts). Anything that survives a reload or matters for correctness belongs on the server.

### Component reuse — extract early, specialize through composition

**Visual consistency across GuestFlow comes from a shared component library, not from copy-pasting MUI patterns.** Before writing any new UI block, ask:

> "Could this pattern (visual or behavioral) appear on more than one page?"

- **Yes / probably / unsure → extract as a generic component** in `client/src/components/`, named by *what it does* (`StatusBadge`, `MaskedTextField`) not by *who uses it* (`SettingsKeyField`).
- **Clearly one-off** (tied to one feature's business logic, e.g. `ReservationPricingSummary`) → keep page-specific.

**Default to extracting.** It is cheaper to inline a generic component than to back-extract one after three pages have diverged. A second use case justifies extraction; a strong hunch of a second use case justifies extraction too.

**Cross-cutting components that should exist (extract on first use, reuse forever):**

| Component | Purpose |
|---|---|
| `PageActionBar` | Sticky page-top action bar (see below). |
| `StatusBadge` | Colored dot/chip + label for any status (configured/incomplete/error/locked/etc.). |
| `StatusCard` | Card with a status badge + summary lines + footer actions — used by any "feature health" view. |
| `SummaryItem` | A `label : value` line used inside status/info cards. Supports masked values. |
| `MaskedTextField` | TextField that displays `••••••` + "Modifier" toggle for secrets (private keys, passwords, tokens). |
| `HelpedTextField` | TextField + helper text + optional external help link, with consistent vertical rhythm. |
| `EmptyState` | Icon + message + optional call-to-action for empty lists/views. |
| `ErrorAlert` | Standardized error display with optional retry. |
| `LoadingState` | Standardized spinner/skeleton. |
| `ConfirmDialog` | _(already exists)_ confirmation dialogs. |
| `FormDialog` | _(already exists)_ form dialogs — reuse instead of rolling your own `<Dialog>`. |
| `TableCard` | _(already exists)_ table wrapper. |
| `DataPageScaffold` | _(already exists)_ list/CRUD page scaffold. |

**Rules of thumb:**
- Each new spec must declare in its "Architecture — Client" section whether it consumes existing components or creates new generic ones. Creating a new component? Justify why it's generic (or admit it's specific).
- A spec that creates a Settings-specific `SettingsCard` instead of a generic `StatusCard` should be challenged in review.
- Generic components must have a JSDoc comment at the top of the file listing props + purpose.
- One folder, flat: `client/src/components/<Component>.js`. No deep nesting. No barrel files unless one is already established.

### Page layout — sticky action bar (`PageActionBar`)

**Every page in GuestFlow must use the shared `<PageActionBar>` component** at the top, immediately below the main app header. It is the single, consistent place for page-level actions.

The component bundles two canonical actions — **Save** and **Cancel** — that 90% of pages need, plus two slots for page-specific actions on either side.

**Component contract (`client/src/components/PageActionBar.js`):**

```jsx
<PageActionBar
  title="Paramètres"                   // string, shown left (hidden on xs by default)
  backTo="/"                           // optional path; shows a back icon button on the left
  subtitle={<Chip ... />}              // optional ReactNode beside the title (chip, caption, etc.)
  center={<Box>…</Box>}                // optional ReactNode CENTERED in the bar (3-equal-cols layout); hidden on xs

  // Canonical actions — both optional. Omit a prop to hide the button.
  onSave={handleSave}                  // omit → no Save button
  saveDisabled={!isDirty}              // optional, default false
  saveTooltip="Enregistrer"            // optional, default "Enregistrer"
  saveBusy={false}                     // optional; when true, shows a spinner inside the Save button
  onCancel={handleCancel}              // omit → no Cancel button
  cancelDisabled={!isDirty}
  cancelTooltip="Annuler"

  // Custom action slots
  actionsBefore={[                     // inserted BEFORE Save — page-specific helpers
    { icon: <SyncIcon />, tooltip: "Synchroniser Google", onClick: handleSync, color: 'info' },
    { icon: <DescriptionIcon />, tooltip: "Télécharger PDF", onClick: handlePdf, color: 'info' },
  ]}
  actionsAfter={[                      // inserted AFTER Cancel — destructive zone
    { icon: <DeleteIcon />, tooltip: "Supprimer", onClick: handleDelete, color: 'error', disabled },
  ]}
/>
```

Each action item:
```ts
{
  icon: ReactNode,
  tooltip: string,             // French, required
  onClick: () => void,
  color?: 'primary' | 'info' | 'success' | 'warning' | 'error' | 'default',  // controls border color
  disabled?: boolean,
  ariaLabel?: string,          // defaults to tooltip
}
```

**Behavior rules:**
- **Position:** sticky just below the main AppBar (`top: { xs: 56, sm: 64 }`). White background, thin border, small radius — matches the legacy bar style of `ReservationPage.js` post "Improve sticky banner" commit.
- **Buttons are icon-only** (`<IconButton>` wrapped in `<Tooltip>`), each rendered with a **1px colored border** matching its `color` prop (`divider` for `default`, `<color>.main` for colored). Save uses a filled primary background; everything else is bordered.
- **Tooltips in French**, MUI defaults for hover/long-press timing.
- **Touch targets:** ≥44×44px (MUI's IconButton handles this; if not, force `sx={{ minWidth: 44, minHeight: 44 }}`).
- **Layout order, left → right:** `[Back] [Title + Subtitle] … [center] … [actionsBefore[]] [Save] [Cancel] [actionsAfter[]]`. When `center` is set, the two side sections take an equal flex basis so the centered node is truly centered; `center` is hidden on `xs`.
- **Responsive overflow:** on `xs`, if `actionsBefore + actionsAfter` has more than 2 items combined, the extras collapse into a "…" overflow menu before Save (the canonical Save/Cancel always stay visible).
- **Save button visual:** filled `bgcolor: 'primary.main'`, white icon, hover darkens. When `saveBusy` is true → swap icon for `<CircularProgress size={18} color="inherit" />`.
- **Cancel button visual:** bordered IconButton with divider border, default icon color.

**When to skip Save/Cancel:**
- Read-only pages (no save action) → omit `onSave` and `onCancel`. The bar still renders with title + any actions.
- Pages with only a save flow and no revertable draft → omit `onCancel`.

**Current state vs. target:**
- `ReservationPage.js` already implements this pattern inline (lines ~1855–2051). It's the visual reference for `PageActionBar` and will be migrated to the shared component when the Bloc 3 Réservations spec lands.
- `SettingsPage.js` has a simpler inline version (Save + Cancel only) — migrated to `PageActionBar` by the Settings spec.

**When to skip the bar entirely:** pages with literally zero actions and no useful title. Rare; even then, prefer `<PageActionBar title="..." />`.

### Responsive design — non-negotiable

**Every screen must work on both desktop and mobile.** GuestFlow is used in the field on phones as much as in the office on a laptop.

- Use MUI's responsive system: `sx={{ display: { xs: 'block', md: 'flex' } }}`, `Grid` with breakpoint props, `useMediaQuery` for branch logic when unavoidable.
- Test every UI change at three breakpoints: mobile (≤600px / `xs`), tablet (~900px / `md`), desktop (≥1200px / `lg`).
- Dialogs: use `fullScreen={isMobile}` on small screens (`useMediaQuery(theme.breakpoints.down('sm'))`).
- Tables: prefer cards or stacked rows on `xs`; reserve true `<Table>` for `md+`. If you must keep a table, allow horizontal scroll inside a contained wrapper.
- Buttons that sit side-by-side on desktop should stack vertically (`flexDirection: { xs: 'column', sm: 'row' }`) and become full-width on `xs`.
- Padding/spacing: reduce on `xs` (`p: { xs: 1.5, sm: 3 }`).
- Touch targets: minimum 44×44px (MUI defaults are usually fine; double-check icon-only buttons).
- No horizontal scroll on `xs` ever (except inside an explicitly scrollable container).

**Spec requirement:** the UI/UX section of every spec touching the client must describe mobile behavior explicitly when it differs from desktop. The manual test plan must include at least one mobile check.

### Backend

- Thin routes → controllers → models
- Validate inputs at boundary
- Use better-sqlite3 prepared statements

### Robustness

- **Pragmatic by default:** handle realistic error cases (user input, network, DB constraint violations). Do not add fallbacks for impossible states.
- **Strict for finance & reservations:** payment amounts, dates, deposits, and balance calculations must validate inputs and round consistently. Data integrity > ergonomics here.

---

## 8. Database

### Migrations

- All schema changes run in `server/src/database.js` on startup (idempotent `ALTER TABLE … ADD COLUMN IF NOT EXISTS` style).
- **Before** any schema change, verify:
  - No existing data is lost or silently corrupted.
  - Default values are sensible for existing rows.
  - The migration block is added in `database.js`.
- Document data-affecting changes in `CHANGELOG.md` under a `Migration` note.

### Encryption

- Sensitive fields (Google OAuth refresh token + calendar id, SMTP password, Qonto tokens, Météo-France key) are AES-256-GCM encrypted at rest via `settingsModel`'s `ENCRYPTED_COLUMNS` (shipped by Bloc S / security-auth-encryption). Any new stored secret must join that list.
- Key auto-generated in `server/.env.local` on first run.
- **Never** log or commit decrypted secrets. **Never** commit `.env.local`.

---

## 9. Testing

### Server unit tests — required

Any new or modified **server-side business logic** (calculations, rules, validations, finance, pricing, date logic) MUST ship with a unit test.

- Runner: Node built-in (`node --test`)
- Location: `server/src/tests/*.test.js`
- Run: `cd server && npm test`

### Tests not required for

- Pure styling changes
- Trivial copy edits
- Bug fixes that only adjust constants
- Pure plumbing / routing wire-up with no logic

### One test file per subject — never append to a shared suite

**A feature's tests go in a file of their own, named after the feature. Never at the end of an
existing suite.** This is a merge rule before it is a tidiness rule: when every feature appends its
cases to the same file, two branches conflict on the last line even though their tests are
unrelated, and the conflict has to be resolved by hand on code Git cannot reason about. It is the
same reasoning that gave `changelog.d/` its one-file-per-change layout (§10).

- **Server** — already the convention: `server/src/tests/<feature>.unit.test.js`, one per spec
  (`sas-option-sales`, `sas-stay-payment`, `sas-offer-complement-lines`…). Keep it that way.
- **Client** — `src/**/__tests__/<Component>.<subject>.test.jsx`. A component with more than one
  subject gets one file per subject (`ReservationSasDialog.catering.test.jsx`,
  `ReservationSasDialog.stay-payment.test.jsx`, …), each opening with a comment naming the spec it
  covers.
- **Shared fixtures** go in a sibling non-test module (`__tests__/<component>Fixtures.jsx`) so a new
  suite never has to import — and therefore re-run — another suite. A fixture used by one subject
  stays in that subject's file. `vi.mock(...)` stays in each test file: Vitest hoists it per file.
- **Touching an existing feature** still edits that feature's file — that is a real overlap, and a
  conflict there is worth resolving.
- Never resolve this class of conflict with a `.gitattributes` union merge: it concatenates both
  sides silently, which on JavaScript means duplicate test names, broken syntax, or a suite that
  passes by accident.

### UI verification — required for UI changes

Before marking any UI-touching task as done:

1. `npm run dev`
2. Exercise the feature in the browser (happy path + at least one edge case)
3. Watch for regressions on adjacent features
4. Report what was tested

If visual testing is impossible (no browser available, blocked port, etc.), **say so explicitly** — never claim success on an untested UI change.

---

## 10. Documentation

### Changelog (required for every merged change) — use fragments, NOT direct edits

`CHANGELOG.md` follows [Keep a Changelog](https://keepachangelog.com/) (`Added` / `Changed` /
`Fixed` / `Removed` / `Migration`). To avoid merge conflicts between parallel branches, **do NOT
edit the `## [Unreleased]` section of `CHANGELOG.md` directly.** Instead, every change adds its own
**fragment file** under `changelog.d/` — one file per change, so two branches never touch the same
lines:

```
changelog.d/<category>--<branch-unique-slug>.md   # content = the markdown bullet(s), no heading
# e.g. changelog.d/added--j7-email-baby-beds.md
```

`<category>` ∈ `added | changed | fixed | removed | migration`. See `changelog.d/README.md` for the
full convention. Preview with `node scripts/build-changelog.mjs`; at release,
`node scripts/build-changelog.mjs --release X.Y.Z` folds all fragments **and** any leftover
`## [Unreleased]` bullets into a dated section and deletes the fragments.

There is no `summary` fragment category: the operator digest (§5.6) is written once at release time,
looking at the whole set of changes, which is the only moment anyone can say what a release *means*
rather than what each commit did. `--release` scaffolds it as a TODO that `--check-digest` refuses.

> The pre-2026-06-08 entries still sitting under `## [Unreleased]` are folded in automatically at the
> next release — no manual migration. New entries: fragments only.

### README.md (major changes only)

Update `README.md` only for: new tech, deployment changes, headline features worth promoting, or breaking changes in setup.

### Specs

The spec in `/specs/` is the canonical "why" — it does not need to be mirrored into README or comments.

---

## 11. Communication style

### Default verbosity: concise

- 2–3 sentences after a task: what changed, what's next.
- Brief one-line updates during work at key moments (found something, changing direction, blocker).
- No internal narration ("Now I'll read the file…", "Let me think about…").

### Detailed when warranted

- Complex tradeoffs
- Surprising discoveries (existing bug, conflicting code, missing data)
- Architectural decisions worth recording

### File references

Use markdown links so they're clickable in VSCode:
`[database.js:42](server/src/database.js#L42)`

---

## 12. Quick command reference

| Action | Command |
|---|---|
| Install all | `npm install && npm run install:all` |
| Dev (both) | `npm run dev` |
| Dev server only | `npm run dev:server` |
| Dev client only | `npm run dev:client` |
| Server tests | `cd server && npm test` |
| Build client | `cd client && npm run build` |
| Reset DB | `rm server/guestflow.db` |
| Stop dev servers (free ports 3000/4000) | `npm run stop` |
| Prod logs | `pm2 logs guestflow` |
| Cut a release | `/guestflow-release X.Y.Z` (skill) |
| Preview the changelog | `node scripts/build-changelog.mjs` |
| Update log (prod) | `~/guestflow/logs/update-<version>-<ts>.log` |
| Prod status | `pm2 status` / `pm2 describe guestflow` |
