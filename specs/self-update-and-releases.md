# Self-update from the app + versioned release pipeline

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/self-update-and-releases` |
| **Created** | 2026-08-20 |
| **Amended** | 2026-08-20 — rules 28 / 30b, after the first real self-update in production |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

### 1.1 How GuestFlow ships today

A push on the `release` branch triggers [.github/workflows/deploy.yml](../.github/workflows/deploy.yml),
which runs on a **self-hosted GitHub Actions runner installed on the production VM**
(`guestflow`, 192.168.0.24, Proxmox). That single job, executing on the production host, does
everything: build, archive, `pm2 stop`, DB backup, extraction over `~/guestflow/current`,
`npm ci`, native rebuild, migrations, `pm2 start`, and even a `docker exec` into the `wp_app`
WordPress container.

### 1.2 Why this has to go

The repository is **public** (`github.com/adn-dev-adrien/guestFlow`). The production machine —
which holds the SQLite database with every guest's personal data, `data/.env.local` with the
AES-256-GCM encryption key and the session secret, the TLS material, and Docker access to the
WordPress container — runs a long-lived agent that **executes code coming from GitHub**, with a
repository-scoped registration token stored on disk.

Consequences:

- Anything that can get a workflow to run on that runner gets **arbitrary code execution inside
  the LAN, as the user that owns the database and the encryption key**. Today the trigger is
  narrow (push on `release` + `workflow_dispatch`, both write-access only), but the blast radius
  of a single mistake — adding a `pull_request` trigger, a `pull_request_target` workflow, a
  compromised GitHub account or a malicious dependency in the build — is total. GitHub's own
  documentation states that self-hosted runners should not be used with public repositories for
  exactly this reason.
- The trust direction is inbound: production trusts GitHub. It should be outbound only.
- Secondary problems: there is **no version notion at all** (`package.json` has said `1.0.0`
  since day one, only `APP_COMMIT_SHA` distinguishes builds), the operator has **no say** in when
  production changes under their feet, and there is **no rollback** other than manually renaming
  a `backup-*` directory over SSH.

### 1.3 Reference implementation

The target design is the one already proven on **sowel** (`sowel-core`), transposed from Docker
Compose to PM2:

| sowel | GuestFlow equivalent |
|---|---|
| specs 055 — versioning + CI/CD | §4.4 release workflow, §3.A rules |
| specs 057 / 060 — self-update + helper container | §4.1 update engine + `apply-update.sh` helper |
| specs 104 — self-update resilience (verify, don't claim success) | rules 24–27 (health-check + auto-rollback) |
| specs 106 / 107 — actionable update pill + changelog link | §6 dashboard alert + release notes in-dialog |
| spec 108 — release notes are mandatory (CI gate) | rule 6 (`verify-release` job) |
| `.claude/skills/sowel-release` | `.claude/skills/guestflow-release` |

Two deliberate divergences from sowel: the release notes are shown **inside the app** (GuestFlow
has no public docs site, and a click-out is a worse experience than reading them in the dialog),
and the update engine **auto-rolls back** on a failed boot (sowel leaves a failed container to the
operator; a PM2 process that fails to boot leaves GuestFlow unreachable, so nobody could click
anything to recover).

---

## 2. Goal

An admin opens GuestFlow, sees that a new version is available with its release notes, and
installs it in one click — backup, download, integrity check, install, restart and rollback on
failure all handled by the app. Production never runs a GitHub agent again: it only fetches
signed-off releases over HTTPS, when the operator asks for it.

---

## 3. Functional rules

### A. Versioning and release pipeline

1. The **single source of truth for the version** is the root `package.json` `version` field.
   `server/package.json` and `client/package.json` carry the same value, bumped together.
2. Versions are `MAJOR.MINOR.PATCH` (no pre-release, no build metadata). Anything else is
   rejected by the tooling and by the update engine.
3. A release is cut through a **`release/vX.Y.Z` branch → PR on `master` → squash-merge by the
   user → tag `vX.Y.Z` pushed on `master`**. The release commit contains: the three version
   bumps + the `CHANGELOG.md` section produced by `node scripts/build-changelog.mjs --release X.Y.Z`
   + the deletion of the consumed `changelog.d/` fragments.
4. Claude never merges the release PR and never pushes to `master` (CLAUDE.md §5.2 is unchanged).
   Claude creates the branch, the PR, and — after the user confirms the merge — pushes the tag.
5. Pushing the tag `vX.Y.Z` triggers `.github/workflows/release.yml` on a **GitHub-hosted runner**
   (`ubuntu-latest`). No self-hosted runner is involved in any workflow.
6. The workflow **refuses to publish** (before building anything) when:
   - the tag does not match the root `package.json` version, or the three `package.json` versions
     disagree;
   - `CHANGELOG.md` has no `## [X.Y.Z] - YYYY-MM-DD` section;
   - `changelog.d/` still contains fragments (they must have been folded into the section).
7. On success the workflow publishes a **GitHub Release** `vX.Y.Z` whose body is the CHANGELOG
   section for that version, with these assets:
   - `guestflow-X.Y.Z.tar.gz` — the deployable archive (server sources + built client + root
     `package.json`), no `node_modules`, no database, no uploads;
   - `SHA256SUMS` — the SHA-256 of every other asset, one per line;
   - `guestflow-booking-<pluginVersion>.zip` — the WordPress plugin
     (see [wordpress-plugin-self-update.md](wordpress-plugin-self-update.md)).
8. The full test suite (server `node --test`, client Vitest, client build, Playwright E2E) runs in
   the release workflow before packaging. A red suite blocks the release — this archive installs
   itself in production, it does not get a lighter gate than a PR.
9. `.github/workflows/deploy.yml`, the permanent `release` branch and the self-hosted runner are
   **removed**. `release.sh` stays, as the archive builder called by the release workflow, and
   produces a `.tar.gz` instead of a `.zip`.
10. A **`/guestflow-release` Claude skill** drives the whole thing (pre-flight checks, changelog
    fold, version bumps, branch, PR, tag, CI monitoring, verification) — the transposition of
    `.claude/skills/sowel-release`.

### B. Detection

11. The server exposes its running version, read once at boot from the deployed root
    `package.json`. It falls back to `0.0.0-dev` when the file is missing (dev tree).
12. The server polls `https://api.github.com/repos/adn-dev-adrien/guestFlow/releases/latest`
    **60 s after boot and every hour**, unauthenticated (public repo, 60 req/h/IP is ample).
13. A release is "newer" only if its version compares strictly greater, component by component.
    A rolled-back or malformed remote version never advertises an update.
14. Failures (offline, rate limit, malformed payload) are logged at debug level, keep the last
    known result, and never surface an error to the user.
15. An admin can force a check from the UI. That endpoint is throttled to **1 call / 10 s**.
16. The detection result is persisted (settings keys) so a restart does not lose it and the
    dashboard has something to show before the first poll of the new process.

### C. What the operator sees and decides

17. **Nothing is ever installed automatically.** The update only ever starts on an explicit admin
    click, confirmed in a dialog.
18. The update is offered to **admins only**. Other roles never see the alert, the settings
    section, or the endpoints (403).
19. The offer shows: current version → target version, publication date, and the **release notes
    of the target version**, rendered inside the app.
20. "Plus tard" dismisses the offer **for that version only**; the alert comes back when a newer
    version appears. The dismissal is stored server-side (it is an operator decision, not a
    browser preference).
20b. The **installed version is displayed permanently in the top bar**, on every page, and an update
    icon appears beside it as soon as a newer release exists — opening the same release-notes
    dialog. That icon deliberately **ignores the rule-20 dismissal**: "Plus tard" is about not being
    nagged on the dashboard, not about losing the way back to the notes. It does step aside while an
    update is running, since the progress overlay already owns the screen. Non-admins see no version
    at all — the running version stays behind the admin gate for the same reason rule 30 keeps it
    out of the public probe.

### D. Update engine — staging phase (application still serving)

21. Pre-flight, all must pass or the update is refused with an explicit French message:
    admin role; no update already running; self-update supported by the layout
    (`~/guestflow/current` is a symlink, `ecosystem.config.js` present, `pm2` resolvable);
    at least **2 GB** free on the deployment filesystem.
22. Download: only from `https://api.github.com/repos/adn-dev-adrien/guestFlow/…` and the GitHub
    release-asset hosts it redirects to (`objects.githubusercontent.com`, `release-assets.githubusercontent.com`).
    Any other final host aborts the update. Hard size cap of **200 MB**.
23. Integrity: the archive's SHA-256 must equal the value published in the release's `SHA256SUMS`
    asset. A mismatch aborts before anything is extracted, and the partial download is deleted.
24. Extraction into `releases/X.Y.Z.partial/`, rejecting any member with an absolute path or a
    `..` segment, then a **layout assertion** (`server/src/index.js`, `client/build/index.html`,
    root `package.json` whose version equals the target).
25. Install: `npm ci --omit=dev` then a **forced from-source rebuild of `better-sqlite3`**, then a
    load smoke-test (`require('better-sqlite3')`). This is the exact ABI foot-gun that has already
    taken production down; it must fail here, while the current version is still serving, and
    never after the swap.
25b. **Wire the release to what must outlive it.** A release archive is code only, so three paths
    inside the extracted `server/` become links into the persistent locations before the tree can
    ever be booted: `.env.local` → `data/.env.local`, `uploads/` → `data/uploads/`, and `certs/` →
    `<root>/certs` when the host keeps any. Losing the first is the quietest failure this engine
    could produce: the new version boots perfectly, generates a fresh session secret and a fresh AES
    key, logs everyone out and can no longer decrypt the Google, SMTP, Qonto and Météo-France
    credentials stored at rest — while every health check passes and nothing rolls back. Files the
    archive did ship at those paths are folded into the persistent copy rather than deleted, and the
    persistent copy wins on conflict.
26. Backup: a **WAL-safe** snapshot of the database (better-sqlite3's `backup()` API, not a file
    copy — a `cp` silently loses everything still sitting in the `-wal` file, as observed
    2026-08-19) into `data/backups/guestflow-pre-vX.Y.Z-<timestamp>.db`. A failed backup aborts
    the update. Rotation keeps the **5 most recent** backups.
27. Only when all of the above succeeded is the staging directory renamed to `releases/X.Y.Z/`
    and the detached helper spawned.

### E. Update engine — swap phase (helper, survives the restart)

28. The swap is performed by a **child process that has left the application's process tree**, so
    it outlives the PM2 restart it triggers. This is the PM2 transposition of sowel's helper
    container (sowel spec 060 FR1: a process cannot orchestrate its own replacement).

    A new *session* is not enough, and assuming it was cost the first real update in production
    (2026-08-20, 2.0.0 → 2.1.0). PM2 stops a process with `treekill` — its default — which walks the
    **descendants** of the process it is killing, by PPID, and signals every one of them. Node's
    `detached: true` calls `setsid(2)`: it changes the session and the process group, and leaves the
    parent alone. The helper was therefore still a child of the application PM2 was restarting, and
    was killed in the middle of the restart it had just requested — its log stopping mid-sentence at
    `[PM2] Applying action restartProcessId`.

    The helper is therefore launched through **`setsid --fork`**: `setsid` forks, the intermediate
    process exits immediately, and the shell running the swap is re-parented to PID 1 before PM2
    ever enumerates the tree. `--fork` is not optional — without it `setsid` only forks when it
    already leads its process group, and the whole rollback path would rest on that coincidence.
    Hosts with no `setsid` (util-linux; a macOS dev machine has none) fall back to the plain
    detached spawn, which is degraded but no worse than the previous behaviour. The command is still
    built as an argv array, never a shell string.
29. The helper, in order: repoint `current` → `releases/X.Y.Z` (atomic `ln -sfn`), restart the app
    (`pm2 startOrRestart ecosystem.config.js --update-env`), then **verify**.
30. Verification succeeds when, within **120 s**, the existing public probe `GET /api/version`
    answers 200 **and** `data/runtime-state.json` reports the target version as running. A "done"
    status is never written on the strength of the restart command returning 0 (sowel spec 104's
    lesson). No new public endpoint is added, and the running version stays behind authentication:
    the liveness probe says "alive", the version file says "which one", and only the second is
    sensitive.
30b. **The application concludes what the helper could not.** A killed helper leaves the status on
    a non-terminal phase, and a non-terminal phase is exactly what the client overlay waits on —
    it never stops spinning, and reloading the page brings it straight back, because nothing in the
    UI can outvote the status file. So at boot, when the status sits on `swapping` or `restarting`,
    the version that actually came up settles the run: the **target** version with no error recorded
    means the swap succeeded (`done`); the version we were coming **from**, with a failure already
    written by the helper, means the rollback succeeded (`rolled_back`). Anything else — a staging
    phase, a terminal phase, the old version back with no failure recorded (the helper may simply
    still be working) — is left untouched. This is a safety net, not a replacement for rule 28: only
    the helper can *perform* a rollback, so a helper that cannot survive is still a broken rollback.

    When the helper *did* survive, both write the same verdict and the run keeps a single history
    line. The one visible seam is a helper that outlives us and then judges the new version
    unhealthy: the boot has already published `done`, so the operator may see the update close
    before the rollback restarts the app. The history is corrected when it does — the run's line is
    replaced, never doubled (§5).

31. On verification failure the helper **rolls back**: `current` → previous release, restart, wait
    for health again, and record the status `rolled_back` with the last 50 log lines. The database
    is **not** auto-restored — migrations are additive-only (CLAUDE.md §8), so the previous code
    runs fine against the migrated schema, and auto-restoring would destroy every write made since
    the backup. The backup stays on disk for a manual restore.
32. The helper writes every transition to `data/update-status.json` (survives the restart, read
    back by the new process) and a full log to `logs/update-X.Y.Z-<timestamp>.log`.
33. After a successful update, the helper prunes old releases, keeping the **3 most recent**
    (current + two rollback targets).
34. Database migrations are **not** a helper step: `database.js` runs them at boot as it does
    today. A failing migration therefore fails the boot, which triggers the rollback of rule 31.
35. The update logic that runs is the one shipped in the **currently installed** version, not the
    downloaded one. Improvements to the engine take effect on the update *after* the one that
    ships them.

### F. Concurrency, observability

36. A lock file `data/update.lock` (pid + target version + timestamp) plus an in-memory flag make a
    second concurrent update return **409**. A lock older than 30 min is considered stale and
    ignored (the process that took it is long gone).
37. The status endpoint reports a phase from: `idle`, `checking`, `downloading`, `verifying`,
    `extracting`, `installing`, `backup`, `swapping`, `restarting`, `done`, `failed`,
    `rolled_back`, plus a French human-readable label, the target version, and — on failure — the
    error and the log tail.
38. The last 5 update outcomes are kept and shown in the settings section (version, date, result).

**Edge cases**

- Update requested while offline → check/download fails → status `failed`, explicit message, the
  running version is untouched.
- Archive downloaded but SHA-256 mismatch → abort, partial file deleted, status `failed` naming the
  integrity check (a corrupted *or tampered* asset must never reach the disk as a release).
- `npm ci` fails (registry down, lockfile drift) → abort in staging, nothing swapped, app keeps
  serving the old version.
- New version boots but crashes after 30 s (e.g. a bad migration) → health check never passes →
  automatic rollback → the UI shows `rolled_back` with the reason.
- Rollback itself fails (previous release deleted by hand) → status `failed`, log explains the
  manual recovery command. This is the only path where GuestFlow can stay down.
- The helper is killed before it can report (PM2 `treekill`, an OOM kill, the host rebooting mid-swap)
  → the next boot reads the swap phase and the running version and concludes the run itself (rule
  30b). The update finishes in the UI instead of hanging on a spinner forever.
- User closes the browser mid-update → the update continues; the status file lets any later client
  see the outcome.
- Two admins click at the same time → second one gets 409 "Une mise à jour est déjà en cours".
- Dev environment (no symlink layout, no PM2) → `selfUpdateSupported: false`; the version is shown,
  the update button is hidden behind an explanatory tooltip.
- Disk full during extraction → abort, staging directory removed, status `failed`.

---

## 4. Architecture

> **Fat backend, thin frontend.** Version comparison, release-notes parsing, eligibility, progress
> labels and history all come from the server as ready-to-render payloads. The client only renders
> them, polls the status, and reloads when told to.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `routes/` | `system.js` | C | Thin `/api/system` router: version, update status/check/start/dismiss |
| `index.js` (entry) | `index.js` | T | Mounts `/api/system`; calls `initOnBoot()` in the listen callback |
| `controllers/` | `systemController.js` | C | Orchestrates: eligibility, check-now, start update (staging → spawn helper), status assembly, history, boot hook |
| `models/` | `updateStateModel.js` | C | Reads/writes the four state files (state, status, lock, runtime); history ring buffer |
| `middleware/` | `enforceRoleAccess.js` | — | **(none)** — `/api/system/*` inherits the deny-by-default guard, so the whole surface is admin-only without touching the security middleware |
| `constants/` | `updatePhases.js` | C | Phase → French label, terminal phases, helper error code → French message |
| `utils/` | `appVersion.js` | C | Reads the deployed root `package.json` once; memoised, `0.0.0-dev` fallback |
| `utils/` | `deploymentPaths.js` | C | Resolves the on-disk layout and answers whether this deployment can update itself, with a reason |
| `utils/` | `semver.js` | C | Pure `parseVersion` / `isNewerVersion` / `isValidVersion` — unit-tested |
| `utils/` | `releaseClient.js` | C | GitHub Releases API client: latest release, asset lookup, `SHA256SUMS` parsing, changelog-body → structured sections. Injectable `fetch` for tests |
| `utils/` | `updateStaging.js` | C | Download (host allowlist on every redirect hop + size cap) → SHA-256 verify → hardened extract → persistent links → `npm ci` + native rebuild + smoke test → promote staging dir; release pruning |
| `utils/` | `releaseLinks.js` | C | Points a staged release at the secrets, uploads and certificates that must survive the swap (rule 25b) |
| `utils/` | `updateHelper.js` | C | Builds the helper command line and spawns it detached; pure builder exported for tests |
| `utils/` | `dbBackup.js` | C | WAL-safe `better-sqlite3` `.backup()` + rotation (keep 5) — reused by the pre-update backup |
| `scheduledTasks.js` | `scheduledTasks.js` | T | Registers the update check (boot + 60 min) |
| `database.js` | — | — | (none — no schema change, settings keys only) |
| `scripts/` | `apply-update.sh` | C | The detached helper: symlink swap, PM2 restart, health verification, auto-rollback, logging |

**New dependency:** none. `node:child_process`, `node:crypto`, `node:zlib` and `tar` (system) cover
it; `better-sqlite3` already provides the WAL-safe backup. This is the first use of
`child_process` in the codebase — the only command it ever builds is `apply-update.sh` with
argument-array spawning (never a shell string), and every interpolated value is a
`^\d+\.\d+\.\d+$`-validated version.

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `pages/` | `Dashboard.jsx` | T | Renders `<UpdateAvailableAlert />` in the existing alert stack |
| `pages/` | `SettingsPage.jsx` | T | Renders `<SettingsSystemUpdateSection />` |
| `App.jsx` (shell) | `App.jsx` | T | Renders `<AppVersionBadge />` at the right end of the top bar, in place of the former `prod <sha>` pill |
| `components/` | `AppVersionBadge.jsx` | C | Top-bar installed version + update icon opening `UpdateDialog` |
| `components/` | `UpdateAvailableAlert.jsx` | C | Admin-only dashboard alert: "GuestFlow X.Y.Z est disponible" + actions |
| `components/` | `UpdateDialog.jsx` | C | Release notes + confirm; starts the update |
| `components/` | `UpdateProgressOverlay.jsx` | C | Full-screen progress, polls the status, reloads on `done`, shows `failed`/`rolled_back` |
| `components/` | `SettingsSystemUpdateSection.jsx` | C | Settings card: version, last check, "Vérifier maintenant", update action, history |
| `hooks/` | `useAppUpdate.js` | C | Single source of update state for the client: fetch status, poll while active, expose actions |
| `api.js` | `api.js` | T | `/api/system/*` calls |
| `constants/` | — | — | (none — every label comes from the server) |

**Component reuse declaration**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `StatusCard`, `SummaryItem`, `StatusBadge`, `ConfirmDialog`, `FormDialog`, `ErrorAlert`, `LoadingState`, `CollapsibleSection` | The settings card is a `StatusCard` + `SummaryItem` lines; the confirm is `ConfirmDialog`. |
| **Created (new generic)** | — | Nothing here is reusable beyond the feature. |
| **Specific (kept feature-local)** | `UpdateAvailableAlert`, `UpdateDialog`, `UpdateProgressOverlay`, `SettingsSystemUpdateSection`, `AppVersionBadge` | The alert follows the established `<Feature>Alert` family of the dashboard (`EmailPendingAlert`, `IcalNewReservationsAlert`, …) and the section follows the `Settings<Feature>Section` family. The overlay is a one-of-a-kind full-screen blocker tied to the restart lifecycle. |

### 4.3 API contract

| Method | Endpoint | Auth | Request | Response |
|---|---|---|---|---|
| GET | `/api/version` | none | — | **unchanged** — the pre-existing liveness probe (`env`, `commitSha`), reused by the swap helper. No app version is added to it: that would publish which release a public deployment runs |
| GET | `/api/system/version` | admin | — | `{ current, latest, updateAvailable, publishedAt, notes[], lastCheckAt, dismissedVersion, selfUpdateSupported, selfUpdateReason, updateInProgress, history[] }` |
| GET | `/api/system/update/status` | admin | — | `{ phase, label, terminal, fromVersion, targetVersion, startedAt, updatedAt, errorCode, error, logTail[] }` |
| POST | `/api/system/version/check` | admin | — | same shape as `GET /system/version`; `429` with `Retry-After` when called within 10 s |
| POST | `/api/system/update/start` | admin | `{ targetVersion }` | `202 { started: true, targetVersion }`; `409` update in progress; `400` version mismatch / unknown target; `412` `selfUpdateSupported: false`; `507` insufficient disk |
| POST | `/api/system/update/dismiss` | admin | `{ version }` | `{ dismissedVersion }` |

The release notes travel **inside the version payload** rather than behind a dedicated endpoint: the
hourly check already fetched and parsed them, so the dialog needs no second round-trip. The update
history travels there too, for the settings card.

Errors follow the existing shape (`{ error: 'CODE', message: '…' }`), messages in French.

### 4.4 CI/CD and tooling

| File | T/C | Responsibility |
|---|---|---|
| `.github/workflows/release.yml` | C | Tag-triggered, GitHub-hosted: `verify` → `test` → `package` → `publish` |
| `.github/workflows/deploy.yml` | **D** | Deleted with the self-hosted runner |
| `release.sh` | T | Produces `guestflow-X.Y.Z.tar.gz` (was `.zip`), plus the SHA-256; drops the CRA-era `dist`→`build` rename? **no** — keeps it (the PM2 layout still expects `client/build`) |
| `scripts/build-changelog.mjs` | — | Unchanged, called by the skill with `--release X.Y.Z` |
| `scripts/bootstrap-vm.sh` | C | One-shot VM migration: `current/` directory → `releases/<v>` + `current` symlink, writes `ecosystem.config.js`, keeps `data/` untouched |
| `.claude/skills/guestflow-release/SKILL.md` | C | The release workflow for Claude (see §4.5) |
| `README.md` | T | Deployment section rewritten: no runner, release + in-app update, manual recovery commands |
| `CLAUDE.md` | T | New section: releases are tag-based, release notes mandatory, never re-introduce a self-hosted runner |

### 4.5 The `/guestflow-release` skill

Steps, each with a check, mirroring `sowel-release`:

1. Validate the version argument (semver; suggest the next patch/minor from `package.json`).
2. Pre-flight: on `master`, up to date, clean tree, `npm --prefix server test`, client Vitest,
   client build, `npm run test:e2e` green.
3. `node scripts/build-changelog.mjs --release X.Y.Z` — and **refuse to release with an empty
   section** (a release with no changelog entry is a release nobody can read).
4. Bump the three `package.json` files.
5. Branch `release/vX.Y.Z`, commit `release: vX.Y.Z` with the explicit file list, push, `gh pr create`.
6. Hand the PR URL over and **stop**. The user squash-merges.
7. After confirmation: `git checkout master && git pull`, verify HEAD is the release commit, tag
   `vX.Y.Z`, push the tag.
8. Monitor the release workflow, report the Release URL and the asset list.
9. Explicitly state that publishing a release does **not** deploy it — the operator installs it
   from the app when they choose to.

### 4.6 Target layout on the VM

```
~/guestflow/
  current -> releases/1.3.0          # atomic symlink swap
  releases/1.3.0/{server,client,package.json}
      server/.env.local -> ../../../data/.env.local   # linked at staging (rule 25b)
      server/uploads    -> ../../../data/uploads
  releases/1.2.1/…                   # kept: last 3
  ecosystem.config.js                # PM2 process definition (env lives here, persistent)
  data/
    guestflow.db  .env.local         # unchanged, already persistent
    uploads/                         # moved out of the release by bootstrap-vm.sh
    backups/guestflow-pre-v1.3.0-<ts>.db
    update-state.json  update-status.json  update.lock  runtime-state.json
  logs/update-1.3.0-<ts>.log
```

`ecosystem.config.js` carries `NODE_ENV`, `HTTPS_ENABLED`, `TRUST_PROXY_HOPS`, `DB_PATH`,
`SKIP_MIGRATIONS` — the values `deploy.yml` used to pass inline — so a restart never depends on a
workflow's environment again.

**Finding `data/` when `DB_PATH` is not declared.** A host can legitimately leave it unset and rely
on the historical wiring instead — `current/server/guestflow.db` symlinked into `data/` — which is
exactly how the production VM was set up. The data directory is therefore resolved through
`realpath` on the database file, not from the declared path: taking the link at face value would
place `data/` *inside* the release, where the update state would be destroyed by the very swap it
has to survive, and where `selfUpdateSupported()` would look for `releases/` and
`ecosystem.config.js` one level too deep.

---

## 5. Data model

**No schema change.** State lives in four JSON files under `data/`, each with a single writer:

| File | Writer | Content |
|---|---|---|
| `data/update-state.json` | the app | Last release seen on GitHub (version, date, parsed notes), `lastCheckAt`, `dismissedVersion`, and the 5-entry history ring buffer |
| `data/update-status.json` | the app during staging, then `apply-update.sh` during the swap | Current phase — the only channel that survives the process being replaced |
| `data/update.lock` | the app | `{ pid, targetVersion, startedAt }` — concurrency guard, stale after 30 min |
| `data/runtime-state.json` | the app at boot | `{ version, pid, bootedAt }` — how the helper proves the *right* version came back |

Why files and not the `settings` table, which is where configuration normally lives: the status has
to be readable by the *new* process to report the outcome of the update that killed the old one, and
writable by `apply-update.sh` — a shell script running after we are dead, on a host where shelling
out to `sqlite3` is not guaranteed. Every write is atomic (tmp file + rename), so a crash can never
leave a half-written state to be read back as garbage.

`update-state.json` and `update-status.json` are also the reason the settings table needed no new
column: none of this is user configuration, it is deployment state.

**One history line per update run.** Each history entry carries the run's `startedAt` — the same
value the status file holds and the helper receives as `--started-at` — and that is what makes an
entry unique, not the `historyRecorded` flag. The flag alone cannot do the job: `apply-update.sh`
rewrites the whole status document when it finishes, resetting the flag, so a run already concluded
at boot (rule 30b) would be logged twice. A later boot reporting a *different* outcome for the same
run replaces the line rather than adding one — a rollback must never leave a stale `done` standing
beside it.

**Data impact:** none on existing records. The pre-update backup adds a file per update under
`data/backups/` (rotated, 5 kept). The VM layout migration (`bootstrap-vm.sh`) moves directories
around `~/guestflow/` but never touches `data/`.

---

## 6. UI / UX

### 6.1 Dashboard — `UpdateAvailableAlert`

Rendered in the existing alert stack of [Dashboard.jsx](../client/src/pages/Dashboard.jsx#L363),
admin only, only when `updateAvailable && version !== dismissedVersion`.

> ⬆️ **GuestFlow 1.3.0 est disponible** — vous utilisez la 1.2.1.
> [Voir les nouveautés]  [Plus tard]

Severity `info`, same visual family as `EmailPendingAlert` / `IcalNewReservationsAlert`.
When `selfUpdateSupported` is false the alert still informs, but the primary action becomes
"Voir les nouveautés" only, with a caption explaining the manual procedure.

### 6.2 `UpdateDialog`

Title `Mise à jour vers GuestFlow 1.3.0`, subtitle `Publiée le 20 août 2026`.
Body: the release notes, grouped by section (Ajouts / Modifications / Corrections / Migration),
as a plain list — no markdown renderer on the client, the server sends the structure.
Footer caption: *« Une sauvegarde de la base est faite avant l'installation. L'application sera
indisponible environ une minute. »*
Actions: `Installer maintenant` (primary) / `Plus tard`.
`fullScreen` on `xs`.

### 6.3 `UpdateProgressOverlay`

Full-screen blocking overlay from the moment the update starts:

> **Mise à jour vers la 1.3.0**
> Téléchargement… / Vérification de l'archive… / Installation des dépendances… /
> Sauvegarde de la base… / Redémarrage…
> *La page se rechargera automatiquement.*

Polls `GET /api/system/update/status` every 2 s. Network errors during the restart window are
expected and shown as "Redémarrage en cours…", not as a failure. On `done` →
`window.location.reload()`. After 5 minutes without resolution, a "Recharger la page" button
appears. On `failed` / `rolled_back`: the overlay turns into an error card with the French reason,
the log tail behind a `CollapsibleSection`, and a "Fermer" button — the app is still usable, it is
simply still on the old version.

### 6.4 Settings — `SettingsSystemUpdateSection`

A `StatusCard` titled **Système et mises à jour** with `SummaryItem` lines: version installée,
dernière vérification, version disponible, statut de la dernière mise à jour.
Actions: `Vérifier maintenant` (with a spinner and the 10 s throttle surfaced as a disabled
state), `Installer la mise à jour` (hidden when nothing to install or unsupported).
Below, a collapsible **Historique des mises à jour** (last 5).

### 6.5 Barre du haut — `AppVersionBadge`

Right end of the application's `AppBar`, on every page, admin only:

> `v2.1.0`  ⬆️

The version is plain monospace caption text, not a control — nothing to click when there is nothing
to do. When a newer release exists, an `IconButton` (`SystemUpdateAltIcon`, `primary`) joins it,
tooltip *« GuestFlow 2.2.0 est disponible »*, and opens `UpdateDialog` — the same release notes and
the same "Installer maintenant" as the dashboard alert, reachable from wherever the operator
happens to be.

This replaces the former `prod <commit-sha>` pill. A commit SHA answered "which build" only for
someone able to map it back to a commit; the release version is the identifier the changelog, the
GitHub release and the update dialog all speak in — and the one the operator quotes when something
looks wrong.

Per rule 20b: the icon survives a "Plus tard" (the alert is what goes quiet, not the way back), and
disappears while an update runs.

### 6.6 Responsive

- `xs` — alert text wraps to two lines, actions stack full-width; dialog `fullScreen`; overlay
  padding reduced, steps stay on one column; settings card actions stack vertically. The top-bar
  badge stays visible (version + icon fit next to the search magnifier), and is hidden only while
  the mobile search field is expanded over the whole bar.
- `md` — alert on one line with trailing actions; dialog standard.
- `lg` — unchanged from `md`; the settings card sits in the existing single-column settings flow.

### 6.7 `PageActionBar`

No new page is created. `SettingsPage` keeps its existing bar (Enregistrer / Annuler); the update
actions live inside the section card, not in the bar, because they are not part of the settings
save flow.

---

## 7. Test plan

### Server unit tests (56 new, `cd server && npm test` → 3455 green)

- [x] `tests/self-update-semver.unit.test.js` — strict parsing, numeric (not lexicographic) ordering,
      and "no update" for every unparseable or rolled-back input (rules 2, 13).
- [x] `tests/self-update-release-client.unit.test.js` — host allowlist (lookalike hosts, plain HTTP,
      a real GitHub host that is not an allowed one), CHANGELOG headings → French sections, wrapped
      bullets, `SHA256SUMS` parsing, and every way a release payload can be refused as untrustworthy.
- [x] `tests/self-update-staging.unit.test.js` — archive members: symlinks and hardlinks in **both**
      tar dialects, absolute paths, `..` traversal, foreign roots; a redirect that leaves the
      allowlist; the size cap on both the declared and the actual length; the layout and version
      assertions; the full staging chain against a real tarball; and a checksum mismatch installing
      nothing (rules 22-25, 27).
- [x] `tests/self-update-helper.unit.test.js` — the argv builder refuses every version string that
      could break out of the shell helper's status JSON or its command line; the child is spawned
      through `setsid --fork` with an argv array, and falls back to a plain detached bash on a host
      with no `setsid` (rule 28).
- [x] `tests/self-update-state.unit.test.js` — lock acquire/release, staleness, corrupted state read
      as empty, history cap, and the boot reconciliation recording a finished update exactly once
      (rules 32, 36, 38); a boot on the target version concluding a swap the helper never reported,
      the symmetric case for a rollback, everything `concludeAbandonedSwap` refuses to guess, and
      one history line per run whether the boot, the helper, or both conclude it (rule 30b).
- [x] `tests/self-update-release-links.unit.test.js` — the staged release reads the *same*
      `.env.local`, a first install links a file that does not exist yet so generated secrets land
      in `data/`, uploads survive, archive-shipped files are folded in rather than dropped, the
      persistent copy wins on conflict, certificates are linked only where they exist, and relinking
      is idempotent (rule 25b).
- [x] `tests/self-update-db-backup.unit.test.js` — the WAL-safe snapshot captures rows a plain `cp`
      misses, a failed backup propagates, rotation keeps 5 and leaves foreign files alone (rule 26).
- [x] `tests/self-update-controller.unit.test.js` — the version and status payloads, the dev-tree
      refusal with its reason, the loopback health URL, the French failure messages, and the hourly
      check keeping its last answer when GitHub is unreachable (rules 14, 21, 37).

### Client tests (28 new, `cd client && npm test` → 1076 green)

- [x] `UpdateAvailableAlert.test.jsx` — silent for a non-admin (and no admin call made at all),
      silent when up to date / postponed / already updating, "Plus tard" postpones that exact
      version, and the install button opens the notes dialog before anything is triggered.
- [x] `UpdateProgressOverlay.test.jsx` — takes over on mount when an update is already running,
      renders a failing poll as "Redémarrage en cours…" rather than a failure, reloads on `done`,
      and shows the rollback with its log tail.
- [x] `SettingsSystemUpdateSection.test.jsx` — up-to-date / available / in-progress / unsupported
      states, the throttled check surfacing the server's message, and the history rendering.
- [x] `AppVersionBadge.test.jsx` — the top bar shows the installed version and nothing to click when
      up to date, no version and no admin call at all for a non-admin, the icon opening the notes
      before anything installs, the icon surviving a « Plus tard » (rule 20b) and stepping aside
      while an update runs.

### Manual verification

Done before merge (2026-08-20):

- [x] **UI, desktop (1512px) and mobile (390px)** — with a published release simulated in
      `update-state.json`: the dashboard alert announces the version, the dialog renders the notes
      grouped by section, and the Réglages card shows installed/published/last-check plus the
      history. On mobile the alert stacks with full-width actions and the dialog goes full-screen.
- [x] **The dev tree correctly refuses to update itself** — the install button is disabled and the
      dialog states the reason (`no « current » symlink`), instead of failing halfway through.
- [x] **The swap helper, both outcomes**, against a fake deployment (a `releases/` tree, a fake
      `pm2` that stamps `runtime-state.json` the way a real boot does, and a real HTTP endpoint):
      - new version answers → `current` → `releases/1.1.0`, status `done`, exit 0;
      - **PM2 relaunches the old code anyway** (the silent-failure case this design exists for) →
        detected as `WRONG_VERSION`, symlink rolled back to `releases/1.0.0`, previous version
        serving again, status `rolled_back`, exit 1, and the log says why.
- [x] **The release workflow's shell logic** — the CHANGELOG grep accepts the matching section and
      refuses a missing one; the `awk` extraction returns exactly the section body that becomes the
      release notes.
- [x] **The top-bar badge, desktop (1512px) and mobile (390px)** (2026-08-20) — up to date it reads
      `v2.1.0` alone; with a 2.2.0 simulated in `update-state.json` the icon appears beside it and
      opens the notes dialog from the dashboard, which on the dev tree correctly refuses to install
      (« current » symlink absent). At 390px version and icon still fit next to the search
      magnifier, and the dialog goes full-screen.
- [x] **Regression** — dashboard alert stack, settings page, full E2E suite (65 passed, 1 skipped).

Only possible on the production host, after `bootstrap-vm.sh` (see §10):

- [x] **A real update installed end-to-end from a published release, data intact after the swap** —
      2.0.0 → 2.1.0 on 2026-08-20. The archive verified against its `SHA256SUMS`, `current` repointed
      to `releases/2.1.0`, PM2 back online on 2.1.0, and `.env.local`, `uploads/` and the database
      still linked into `data/` (rule 25b held: no session was lost and no secret regenerated). The
      run also **exposed the rule 28 defect**: the helper was tree-killed at the restart and never
      wrote `done`, so the status stayed on `restarting` and the operator's overlay never closed.
- [ ] A deliberately broken release rolled back automatically on the real host. **Blocked until the
      rule 28 fix ships**: on the version installed today the helper does not survive the restart,
      so there is nothing left alive to roll anything back.
- [ ] The WordPress plugin updating itself from the WordPress admin.

## 8. Out of scope

- Automatic (unattended) updates — every install stays an explicit operator decision.
- Downgrade / install-an-arbitrary-version from the UI. Rollback exists only as the automatic
  recovery of a failed update; going back further is a documented manual procedure.
- Signing the archive (minisign/cosign). Decided against for now — see §9.
- Automatic database restore after a failed update.
- Multi-instance / staging-environment orchestration. GuestFlow is single-instance.
- A push notification when a version is published (the infra exists — `web-push` — but the
  dashboard alert covers the need; can be a follow-up).
- The WordPress plugin's own update path — separate spec,
  [wordpress-plugin-self-update.md](wordpress-plugin-self-update.md).

---

## 9. Open questions

Resolved 2026-08-20 with the user before writing this spec:

- **Q: What becomes of the self-hosted runner and `deploy.yml`?**
  A: **Removed entirely.** Builds run only on GitHub-hosted runners; production makes outbound
  calls only. This is the whole point of the spec.
- **Q: How is the downloaded archive verified?**
  A: **SHA-256 published by CI** in the release's `SHA256SUMS`, over HTTPS, with a hard allowlist
  of source hosts and of the repository. Honest limitation: this protects against corruption, a
  truncated download and CDN-level tampering, **not** against someone who has taken over the
  GitHub account and publishes a malicious release. Minisign signing with a key held outside
  GitHub was offered and declined for now; it remains the natural hardening step if the threat
  model changes.
- **Q: Release channel?**
  A: **Tag `vX.Y.Z` on `master` via a `release/vX.Y.Z` PR**, sowel-style. The permanent `release`
  branch disappears.
- **Q: The WordPress plugin, currently pushed by the same workflow?**
  A: **Native WordPress auto-update.** GuestFlow serves an update manifest that the plugin polls,
  so the plugin updates from the WordPress admin like any other plugin. The update engine never
  gets Docker access — handing the Node process a Docker socket would mean handing it root on the
  VM, which is exactly the kind of power this spec is removing.

Still open, to settle during implementation:

- Q: Does the production VM still have the build toolchain (`python3`, `make`, `g++`) needed for
  the `better-sqlite3` from-source rebuild once the runner is gone?
  - A (2026-08-20): **yes** — `python3`, `make`, `g++` and `cc` are all present. The 2.0.0 install
    rebuilt `better-sqlite3` from source on the host and it loads (ABI 137, Node 24.19).
- Q: Which system user owns `~/guestflow` and the PM2 daemon on the new Proxmox VM?
  - A (2026-08-20): **`adrien`**, on hostname `guestflow` (192.168.0.24). The app, PM2 and the whole
    update path run as that user; no `sudo` anywhere in it.
- Q: Does the release archive carry `scripts/`, which the README tells the operator to run from
  `~/guestflow/current/scripts/bootstrap-vm.sh`?
  - A (2026-08-20): it did not — the first install needed the script copied over by hand. Fixed in
    `release.sh`; the path is real from the next release on.

---

## 10. Implementation progress

| Phase | Content | Status |
|---|---|---|
| 1 | Versioning + `appVersion` + `/api/system/version` + hourly check | ✅ |
| 2 | Release workflow (GitHub-hosted) + `release.sh` → tar.gz + `verify` gate | ✅ |
| 3 | `/guestflow-release` skill + CLAUDE.md / README rewrite | ✅ |
| 4 | Update engine: staging (download/verify/extract/install/backup) | ✅ |
| 5 | Helper `apply-update.sh`: swap, restart, verify, rollback + `bootstrap-vm.sh` | ✅ |
| 6 | UI: dashboard alert, dialog, overlay, settings section | ✅ |
| 7 | Removal: `deploy.yml` deleted, `release` branch retired | ✅ |
| 7b | On the host: `bootstrap-vm.sh` run, runner uninstalled and deregistered | ✅ 2026-08-20 |
| 8 | Rules 28 / 30b: the helper leaves the PM2 process tree, and a boot concludes an abandoned swap | ✅ 2026-08-20 |
| 9 | Top-bar version badge replacing the `prod <sha>` pill (§6.5, rule 20b) | ✅ 2026-08-20 |

**Done in production on 2026-08-20**, in this order, with a verified off-host backup taken first:
layout migrated (`current/` → `releases/1.0.0` + symlink, uploads moved to `data/uploads`), the app
checked still serving on the old version, then v2.0.0 downloaded, SHA-256 verified, installed and
swapped in. The host now reports `selfUpdateSupported: true`, `data/` resolves to `~/guestflow/data`,
and the hourly check has run against the real GitHub API — seeing 2.0.0 published, parsing its notes
into five sections, and correctly offering no update since it matches the installed version.

The GitHub Actions runner was stopped, uninstalled and deregistered the same day: **0 runners on the
repository, 0 systemd units, credentials removed from disk.**

### Amendment — 2026-08-20, after the first real update

`2.0.0 → 2.1.0` was the maiden voyage of this engine and it did the hard part correctly: verified
archive, wired persistent paths, swapped release, healthy boot on the new version. It then hung, and
the operator was left staring at a progress overlay that could not be dismissed or reloaded away.

The cause was a single wrong assumption in rule 28 — that a detached child *is* a child no longer.
PM2's `treekill` follows PPIDs, `setsid(2)` does not change the PPID, and the helper was killed by
the very restart it had asked for, one line into it. Two changes came out of it: the helper now
leaves the tree for real (`setsid --fork`, rule 28), and the application no longer depends on the
helper being alive to reach a terminal status (rule 30b).

Worth stating plainly, because it is the part that was not visible on screen: for as long as the
helper died at every restart, **rule 31's automatic rollback did not exist on this host**. The 2.1.0
update looked fine only because the new version booted. Had it not, nothing would have put 2.0.0
back. Per rule 35 the engine that runs is the one already installed, so this fix protects the update
*after* the one that ships it — 2.1.0 → next is still run by 2.1.0's helper, and its outcome is
concluded by 30b in the version that boots.
