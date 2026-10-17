# Hosting H1 — the console runs the fleet: provisioning, routing, backups, updates, monitoring

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/hosting-h1-fleet-runtime` (from `inte/plugins`) |
| **Created** | 2026-10-08 |
| **Author** | Adrien |
| **Related PR** | — (target `inte/plugins`) |
| **Parent study** | [`specs/plugins-inventory.md`](plugins-inventory.md) — D3, D5, §9, phase H of §12 |
| **Console** | [`specs/control-plane-plans-and-access.md`](control-plane-plans-and-access.md) — the manual steps of rules 7, 20–22 become automatic here |
| **Summary for review** | [`docs/specs/2026-10-08-hosting-h1-fleet-runtime.html`](../docs/specs/2026-10-08-hosting-h1-fleet-runtime.html) |

---

## 1. Context

D3 decided that each customer gets one GuestFlow process, behind a thin control plane. The console (C1–C3)
already handles several things:
- it signs licences and creates the first administrator;
- it bills, exports and erases;
- it routes the common login page.

Everything that touches the host is still a ticked box « À faire à la main jusqu'à la phase H »
(`control-plane/server/src/controllers/customersController.js`):
- the instance directory, its key and its database;
- the process;
- the proxy route and the certificate;
- stopping, restarting and renaming.

The fleet view hard-codes `version: null, process: null, lastBackup: null`. Nothing backs the databases
up. Updates are still the instance's own button (`/api/system/update/*`), which a hosted customer must
not press. Each customer must also configure an SMTP server before any email leaves, the heaviest
setting of a new install.

## 2. Goal

The operator creates, stops, restarts, renames, updates and erases a customer from the console. None of
these needs a shell. Every database is continuously backed up, and a restore is tested every week. The
operator is told before a customer notices a problem. A new customer sends emails on day one without
configuring anything.

## 3. Functional rules

### 3.A Decisions taken for this phase (2026-10-08)

These are the recommended options, taken under the owner's instruction to run the plan through.

- **H-D1 — systemd.** Hosted instances run as systemd units: one template `guestflow@.service`, a
  memory limit per instance, restart on failure. PM2 stays for self-hosted installs such as Solio
  today.
- **H-D2 — Caddy.** Caddy is the proxy, with one site file per instance (`<slug>.<domain>`). Caddy
  obtains certificates automatically. The console reloads Caddy after each change.
- **H-D3 — Litestream.** Litestream streams every database to EU object storage (S3 API). Restores are
  done by the console.
- **H-D4 — releases shared on the host.** Releases are unpacked once per host
  (`<root>/releases/<version>`) and shared by every instance. An instance runs the version written in
  its environment file.
- **H-D5 — a platform SMTP.** The platform sends from its own domain, with the gîte's address as
  Reply-To. A customer who configures their own SMTP uses it instead.
- **H-D6 — drivers.** Every host action goes through a driver: `process`, `proxy`, `backup` and
  `mail`. Each driver has a `local` implementation for development and the test suites (child
  processes, no proxy, a backup into a local folder), so the whole lifecycle runs on a laptop and in
  CI.

### 3.B Provisioning and lifecycle

1. Creating a customer runs, in order and automatically:
   1. the directory `<CP_INSTANCES_ROOT>/<slug>/` with `data/`, `uploads/` and `env` (mode 600);
   2. an encryption key and a session secret, generated;
   3. a free port taken from `CP_PORT_RANGE`;
   4. the database initialised by starting the instance once;
   5. the process unit, enabled and started;
   6. the proxy site, then a reload;
   7. a health check `GET https://<slug>.<domain>/api/version` (`/api/version` on the local port with
      the `local` driver);
   8. the backup replica added.

   The licence step and the first-admin step are unchanged. Each step is shown live on the customer's
   page.
2. A failed step stops the sequence. It shows the step's error and offers « Reprendre » from that step.
   Every step is idempotent, so resuming after a partial run never duplicates anything.
3. Deprovisioning (`deprov-stop`) stops and disables the unit. It replaces the proxy site with the
   static page « Cet espace a été fermé » and keeps the backup replica until the erasure of control-plane
   rule 20.
4. Reactivating (`restart`) re-enables the unit and restores the proxy site.
5. Renaming (`rename`) moves the directory, starts the unit under the new slug, and adds the new site.
   The old address answers 301 to the new one for 90 days.
6. Erasure (control-plane rule 20) also deletes the unit, the site, the replica and the environment
   file.
7. All the steps of control-plane rules 7, 20, 21 and 22 that were `manual` become `auto`. The « À
   faire à la main » hints disappear.

### 3.C Releases and updates

8. **A release is installed on a host once.** It is downloaded with its `SHA256SUMS`, verified,
   unpacked to `<root>/releases/<version>/`, and its dependencies are installed there. The console page
   « Versions » lists the installed releases and the number of instances on each.
9. **On a managed instance (`GUESTFLOW_MANAGED=1`), updating is the operator's job.**
   - `POST /api/system/update/start` answers 403.
   - Réglages › Système shows the version with « Mises à jour gérées par l'hébergeur » and no button.
10. **The operator updates one customer, a selection, or the whole fleet**, one instance at a time:
    1. snapshot the database (a backup is forced first);
    2. switch the version;
    3. restart;
    4. check health within 60 s.

    A failed health check rolls that instance back to its previous version, and the fleet update stops
    there with the error shown.
11. **Plugin updates (phase 4) can be pushed the same way**, per plugin, to the instances that have it
    installed.

### 3.D Backups

12. Every instance database is replicated continuously: Litestream, WAL shipping, with a snapshot every
    24 h kept for 30 days. The uploads folder is synced every night to the same storage.
13. **Every Sunday the console restores each customer's latest backup into a temporary folder.** It
    runs `PRAGMA integrity_check`, counts the reservations, and records `lastBackupVerifiedAt`. A failed
    restore is an alert.
14. The customer page offers « Restaurer à une date ». The operator picks a point in time within the
    retention, and the console:
    1. stops the instance;
    2. keeps the current database aside as `guestflow.db.before-restore-<ts>`;
    3. restores;
    4. restarts and checks health.

### 3.E Fleet view and monitoring

15. **The fleet view shows real values.** Each customer row shows its version, its process state (from
    the driver), its last replicated backup, its last verified restore, its disk use and its
    certificate expiry.
16. **A probe runs every minute and raises console alerts.** These use the existing alerts table and
    page, plus an email to the operator:
    - instance down for 3 minutes in a row;
    - backup older than 1 h;
    - a weekly restore that failed;
    - host disk above 85 %;
    - a certificate expiring within 14 days;
    - memory above 90 % of the unit's limit.

    An alert closes itself when the condition clears.
17. **Each alert is sent once.** It is repeated every 24 h while it stays open, never every minute.

### 3.F Email without configuration

18. **A managed instance without its own SMTP sends through the platform**, with no setting and no
    customer action:
    - `From: "<Nom de l'entreprise>" <noreply@<platform domain>>`;
    - `Reply-To: <company email>`.

    Provisioning writes the platform SMTP into the instance environment (`GUESTFLOW_PLATFORM_SMTP_*`).
19. **Paramètres › Emails shows « Envoi par la plateforme »** with one line explaining that replies go
    to the company address, and a « Utiliser mon propre serveur » expander for those who want it. A
    configured SMTP always wins.
20. **The platform counts sent emails per instance per day.** Above `CP_MAIL_DAILY_LIMIT` (default 300)
    it refuses with a clear error in the email history and raises an operator alert, which protects the
    shared sender's reputation.

**Edge cases:**
- Port range exhausted → creation stops at the port step, naming the range.
- The proxy reload fails → the previous proxy configuration stays live, and the step fails with Caddy's
  message.
- The object storage is unreachable → the instance keeps running; the « backup older than 1 h » alert
  fires.
- Restoring a customer while a fleet update is running → refused (409) until the update ends.
- A self-hosted instance (Solio today, not managed) → nothing changes: its update button, its PM2 and
  its SMTP stay as they are.

### 3.G Isolation and resilience (added 2026-10-17 after the review of PR #691)

21. **No customer reaches another, the console, or root.** Instances run as `guestflow-app`, never as
    the console's user `guestflow`; each one sees only its own directory (the others are hidden by
    its mount namespace), the releases read-only, and neither the console's directory nor Caddy's
    admin socket. Litestream runs as `guestflow-app` too. Its configuration is root-owned and written
    only by a root wrapper that accepts `c<id>=<instance database>` entries and nothing else; Caddy's
    admin API is a unix socket only the console's group opens. The console's root commands are these
    two wrappers.
    - *Second review, 2026-10-17:* each instance runs as **its own user** `gf-c<customer id>` (group
      `guestflow-app`), created by a third root wrapper with the unit's `User=` drop-in (the template
      runs as `nobody` and fails closed); Litestream as `guestflow-backup`; `/proc` shows each one only
      its own processes. Env files live in `/srv/guestflow/envs/` (0700), out of the instance's reach.
      Releases are group-readable and never group-writable; databases the console creates or
      replaces are 0660. The console never follows a link an instance planted, and forwarded headers
      are believed only with the secret header Caddy adds.
22. **A step cut short by a console restart becomes a failed step.** At start-up every step still
    « running » is marked failed (« Console redémarrée pendant l'étape. »), so « Reprendre » is
    offered instead of a customer blocked forever.
23. **One customer's failed erasure never stops the daily run.** It raises an alert, the other
    customers are erased, and it is tried again the next day.

---

## 4. Architecture

### 4.1 Control plane (`control-plane/server/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `utils/drivers/` | `index.js`, `process-systemd.js`, `process-local.js`, `proxy-caddy.js`, `proxy-none.js`, `backup-litestream.js`, `backup-local.js` | C | H-D6 |
| `utils/` | `provisioner.js` | C | Idempotent step runner (rules 1–7) |
| `utils/` | `releases.js` | C | Download, verify, unpack, list (rule 8) |
| `utils/` | `fleetUpdater.js` | C | One-by-one update with snapshot, health, rollback (rules 10–11) |
| `utils/` | `restoreVerifier.js` | C | Weekly restore check, point-in-time restore (rules 13–14) |
| `tasks/` | `probe.js`, `weeklyRestore.js` | C | Rules 15–17 and 13 |
| `controllers/` | `customersController.js` | T | Steps become `auto`, resume, restore |
| `controllers/` | `fleetController.js` | C | Versions, fleet update, monitoring values |
| `routes/` | `fleet.js` | C | Thin |
| `database.js` | — | T | `instances` (port, version, unit state), `fleet_updates`, `backup_checks`, `mail_counters`, `host_redirects`, `host_alerts` — in their own block |
| `utils/drivers/` | `mail-platform.js`, `exec.js` | C | The `platform` / `local` mail drivers; the one injectable way to run a host command |
| `utils/` | `instanceEnv.js`, `health.js`, `sqliteBackup.js`, `hostAlerts.js`, `hostView.js` | C | Env file build/parse (mode 600); health polling; SQLite online backup and integrity check; alerts sent once then every 24 h; ready-to-render fleet columns |
| `models/` | `hostingModel.js` | C | The tables above |
| `scripts/` | `dev-release.js` | C | A release directory built from the checkout, for development and the integration test |

### 4.2 Instance (`server/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `controllers/` | `systemController.js` | T | 403 on a managed instance; status says « gérées par l'hébergeur » (rule 9) |
| `utils/` | `emailService.js` | T | Platform transport fallback, From/Reply-To, daily counter (rules 18, 20) |
| `utils/` | `platformMail.js` | C | The platform sender's settings, the day's counter file `<data>/platform-mail.json`, the local outbox |
| `utils/` | `instancePaths.js` | C | `GUESTFLOW_UPLOADS_DIR`, `GUESTFLOW_LOCAL_ENV`: an instance's own files live outside the shared release (H-D4) |
| `utils/` | `settingsResponse.js`, `models/settingsModel.js` | T | The `smtp.platform` block (rule 19); `smtpConfigured()` true when the platform sends |
| `index.js` | — | T | `/api/version` carries `version` (rule 10's check); `GUESTFLOW_TLS_UPSTREAM`, `GUESTFLOW_LISTEN_HOST` behind Caddy |

### 4.3 Client

- Console:
  - `CustomerPage` (live steps, resume, restore);
  - `FleetPage` (real columns);
  - `VersionsPage` (C, releases and fleet update).
- Instance:
  - `SystemSettings` (managed message);
  - `EmailSettings` (platform state, own server expander).
- Component reuse: `StatusBadge`, `StatusCard`, `ConfirmDialog`, `PageActionBar`, `ErrorAlert`.

### 4.4 Host files

`deploy/hosting/` (C) holds:
- `guestflow@.service`;
- `Caddyfile` with its `sites/` import and the closed-space page;
- `litestream.yml` template;
- `guestflow-systemctl`, `guestflow-litestream-apply` + `guestflow.sudoers`: the only root commands
  the console may run — the instance units, and Litestream's configuration from checked entries;
- `litestream.override.conf`, `caddy.override.conf`: Litestream as `guestflow-app`, Caddy's admin
  socket directory;
- `guestflow-console.service` and `console.env.example`;
- `bootstrap-host.sh` (one-time host setup);
- `README.md`: the host runbook, which lists the owner's actions of §8.

## 5. Data model

The control plane's `instances` table gains:
- `port`, `version`, `previous_version`;
- `unit_state`, `last_backup_at`, `last_backup_verified_at`;
- `disk_bytes`, `cert_expires_at`.

New tables:
- `fleet_updates(id, target_version, scope, state, started_at, ended_at, error)`;
- `fleet_update_items`;
- `backup_checks`;
- `mail_counters(instance, day, count)`;
- `host_redirects(slug, customer_id, until)` — the 301 of a renamed address, removed after 90 days
  (added at implementation);
- `host_alerts(key, customer_id, kind, severity, text, opened_at, last_sent_at, closed_at)` — rules
  16–17 (added at implementation: the C-phase alerts are computed, not stored).

The `instances` table did not exist before H1: it is created with these columns (plus
`disk_measured_at`, `memory_bytes`, `memory_max_bytes`, `down_since`, `probed_at` for the probe).
`provisioning_steps` accepts the status `running` (table rebuilt once, rows kept).

The instance needs no schema change: the platform's daily count lives in
`<data>/platform-mail.json`.

## 6. UI / UX

See the summary page: a create sequence with live steps, the fleet table, the Versions page with fleet
update progress, and alerts.

Mobile: the fleet table becomes cards, and the step list stays vertical.

## 7. Test plan

**Control-plane unit tests:**
- each driver's file generation (systemd unit, Caddy site, Litestream config);
- the step runner: idempotence, resume after failure;
- port allocation;
- release verification (a bad hash is refused);
- fleet update rollback on a failed health check;
- probe thresholds, and an alert sent once then every 24 h;
- restore check.

**Instance unit tests:**
- 403 on a managed instance;
- platform mail From/Reply-To;
- an own SMTP wins;
- the daily limit.

**Integration** (the `local` drivers, CI):
- create a customer;
- the instance answers;
- stop shows the closed page, then restart;
- update to a second release, with a failing release rolled back;
- backup and restore;
- erase.

## 8. Owner actions (cannot be coded)

- Buy the platform domain and set its wildcard DNS (`*.<domain>`).
- Rent the host (Hetzner CX33/43, EU).
- Open the EU object storage (Scaleway or Hetzner) for Litestream.
- Create the transactional email account and set SPF, DKIM and DMARC on the platform domain.
- Run `deploy/hosting/bootstrap-host.sh` once on the host, following the runbook.

## 9. Open questions

None. H-D1 to H-D6 are recorded in §3.A.

## 10. Implementation progress

Implemented 2026-10-08 → 2026-10-17 on `feature/hosting-h1-fleet-runtime` (PR to `inte/plugins`).

**Choices made at implementation** (none contradicts §3):
- **Step order.** The ten steps run as: directory, secrets, port, licence, database, **first admin**,
  process, route, health, backup. The first administrator is created before the process ever starts,
  so the seeded bootstrap account of a new database is never reachable from outside.
- **Version of a new customer**: the newest release installed on the host.
- **Rename (rule 5) and control-plane rule 22.** The old address answers 301 for 90 days and stays
  reserved for 12 months (rule 22 kept its 12-month reservation; its redirect is now 90 days).
- **A replica is keyed by the customer** (`c<id>`), never the slug: a rename keeps its history. The
  console's own database is replicated too (key `console`).
- **Health checks** read `/api/version` and require the expected `version`; a process that already
  exited fails at once instead of waiting 60 s.
- **Restore (rule 14)** restores into `guestflow.db.restoring`, checks it, and only then stops the
  instance; a backup that does not read is refused before anything stops. Replication is paused
  around the swap.
- **Platform mail (rules 18–20)**: the instance enforces the quota itself and keeps the day's count
  in `<data>/platform-mail.json`; the probe copies it into `mail_counters` and alerts at the limit.
  The `local` driver writes each message as JSON into `<instance>/outbox`.
- **Certificates (rule 15)** are read from what Caddy serves on 127.0.0.1:443 (SNI), not from its
  private data directory.
- **Root access**: the console runs as `guestflow`; sudo only allows `/usr/local/sbin/guestflow-systemctl`
  (the instance units) and `/usr/local/sbin/guestflow-litestream-apply` (rule 21).
- **Rule 11** is wired end to end (scope = instances whose `plugins` table has the plugin, same
  snapshot/health/rollback loop) behind a `pluginInstaller` adapter. Until the registry of phase 4
  provides it, the push answers 412 and « Versions » does not show it.
- **Local drivers**: detached child processes with a pid file and an `.enabled` marker (restarted
  when the console starts, as systemd does at boot), `proxy-routes.json` instead of Caddy, timestamped
  SQLite online-backup snapshots (every 10 min, 30 days) instead of Litestream. The copies outlive
  `removeReplica` until the purge, like a real replica.

**Review of 2026-10-17 (PR #691)** — fixed on the branch:
- Litestream no longer runs as root with a config the console could write (rule 21): it runs as
  `guestflow-app`, `/etc/litestream.yml` is root 644 and written by `guestflow-litestream-apply`
  from checked entries; the backup target lives in root-owned `/etc/guestflow/backup.env`.
- Instances, Litestream and the console have separate identities and views (rule 21, units in
  `deploy/hosting/`); Caddy's admin API moved to `/run/caddy/admin.sock` (0660, group `caddy`).
- The console lists and restores replicas **by URL** with `LITESTREAM_ACCESS_KEY_ID` /
  `LITESTREAM_SECRET_ACCESS_KEY` from its own environment (never in a file); a failed listing
  puts its reason into the backup alert. A deprovisioned customer's kept copies are therefore
  restorable and checked weekly without a false alert.
- The console's own database is no longer a Litestream entry (Litestream cannot read the console's
  directory): it is copied every night (7 kept) and sent with rclone.
- « Restaurer à une date » moves the current files aside by renaming them (a corrupt or missing
  database no longer blocks the restore), runs in the customer's sequence lock, and holds fleet
  updates back (409 `RESTORE_RUNNING`).
- A fleet update stops the instance before its snapshot, then starts it on the new version, so a
  rollback loses nothing; each instance is updated inside its customer's sequence lock.
- Port allocation retries on the UNIQUE conflict of two simultaneous creations.
- An alert email counts as sent once one operator received it.
- The probe asks each replica every 5 minutes, measures disk asynchronously and probes 8 customers
  at a time.
- The platform's daily quota is reserved before the send (a failed send gives its slot back), so
  simultaneous sends never pass it.
- Rules 21–23 appended (§3.G).

**Second review of 2026-10-17 (commit after 2cf8fa46)** — fixed on the branch:
- Litestream 0.3 ignores an endpoint or region given in a replica URL's query: the console's listings
  and restores now use a one-database configuration file (endpoint, region, `force-path-style`)
  written to its own `data/tmp/` and removed after the call; the keys stay in the environment.
- Releases: `releases/` is `guestflow:guestflow-app` 2750 and every file is made group-readable,
  never group-writable, after extraction and `npm ci` (`shareRelease`).
- Databases created or replaced by the console (init, first admin, rollback, restore) are set 0660;
  SQLite gives their `-wal`/`-shm` the database's mode.
- One user per instance, keyed on the customer (a rename keeps it), Litestream as its own user,
  `ProtectProc=invisible` + `ProcSubset=pid` (`PrivatePIDs=` needs systemd 257; Debian 12 has 252).
- Every console read, copy or export of an instance's file refuses links and paths leading out of the
  instance's directory; the licence's temporary file is created with `O_EXCL`.
- Env files moved to `/srv/guestflow/envs/<slug>` (an older one is moved once by the provisioner).
- A restore counts as running from its first instant; its swap never starts an instance without a
  database and moves Litestream's state of the old file aside.
- The Litestream wrapper refuses a database listed twice and takes the backup target from the
  console (one source of truth; `/etc/guestflow/backup.env` is gone); bootstrap restarts Litestream.
- Instances and the console share the host's loopback: Caddy adds a secret header
  (`GUESTFLOW_PROXY_SECRET`, `CP_PROXY_SECRET`) and both drop `X-Forwarded-*` without it.
- The real-host check, `deploy/hosting/test/` (privileged Docker, Debian 12 + systemd + SeaweedFS
  S3), runs `bootstrap-host.sh` and every scenario through the console; not in CI. Run on
  2026-10-17: 37/37 checks (two customers, fleet update and forced rollback, replica listed and
  restored at a date, weekly check, deprovision/reactivate/rename/erase, isolation from inside an
  instance). It found and fixed: copied files keeping their source's group (release unreadable by
  the instances), `RestrictSUIDSGID=` refusing directories in the setgid instance directories,
  simultaneous creations dropping each other from Litestream's configuration and racing on Caddy's
  reload, and two bootstrap errors (pipefail on a fresh host, the firewall's OpenSSH profile).
- On a real host a release that dies at start is retried by systemd (`Restart=on-failure`), so the
  rollback comes after the full 60 s health window, not at once as with the local driver.

**Tests.**
- Control plane: `hosting-drivers` (15), `hosting-provisioner` (13), `hosting-releases` (3),
  `hosting-fleet-update` (6), `hosting-probe` (10), `hosting-restore` (7), `hosting-instance-files`
  (5) unit suites, and
  `hosting-lifecycle.integration.test.js` (real instances, local drivers, ~8 s) in the
  `console-server` CI job. C-phase suites updated where a manual step became automatic.
- Instance: `hosting-managed-instance.unit.test.js` (12).

**After merging #693 (2026-10-17):** the email-texts page's « M'envoyer un test » goes through the
account mailer, whose `available()` is `smtpConfigured()` — true on a managed instance without its own
SMTP — and which sends through `createEmailService`: the test leaves by the platform, From the
company's name at the platform address, Reply-To the company, counted in the day's quota. Previews
need no SMTP. Covered by a rule 19 test.
- Console client: `CustomerPage.hosting`, `FleetPage.hosting`, `VersionsPage.updates`. Instance client:
  `SettingsSystemUpdateSection.managed`, `SettingsSmtpSection.platform`.

**Left to the owner**: §8, and the host runbook `deploy/hosting/README.md`. Not exercised against a
real host: systemd, Caddy, Litestream and rclone are covered by their generated files and command
lines only.
