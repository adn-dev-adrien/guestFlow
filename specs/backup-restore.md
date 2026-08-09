# Backup & restore — pulling production data off the Raspberry Pi

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/backup-restore` |
| **Created** | 2026-08-09 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

GuestFlow production runs on a single Raspberry Pi (PM2 + SQLite, see README §"Production
Deployment"). Everything that matters lives in exactly one place, on one SD card:

- `~/guestflow/data/guestflow.db` — the whole business database (reservations, clients, finances,
  documents, iCal state).
- `~/guestflow/data/.env.local` — the AES-256-GCM `GUESTFLOW_ENCRYPTION_KEY` plus the session
  secret and the Google / Qonto / VAPID / SMTP credentials.
- `~/guestflow/certs/` — the self-signed TLS cert + key trusted by every device on the LAN.
- `~/guestflow/current/server/uploads/` — user-uploaded files (company logo, photos).

The Pi keeps rolling `backup-*.db` copies in `data/`, but **they are on the same SD card as the
original**: an SD-card failure, a corrupted filesystem or a stolen Pi loses the data and the
backups together. There is no off-device copy today.

The `.env.local` dependency makes this sharper than "just save the DB": the encrypted columns of
`app_settings` (`settingsModel.ENCRYPTED_COLUMNS`) are unreadable without the exact key that
encrypted them. A database backup without its key is a partial data loss.

## 2. Goal

Adrien can, from his Mac, take a complete off-device snapshot of GuestFlow production in one
command, and bring a crashed/replaced Raspberry Pi back to that exact state with one more.

## 3. Functional rules

1. A backup is pulled **from the Mac** over SSH — nothing new is installed or scheduled on the Pi.
2. The database snapshot is taken with `sqlite3 .backup`, not `cp`: the WAL is folded into the
   copy, so the snapshot is consistent even though PM2 keeps serving writes during the backup.
3. The snapshot is rejected if `PRAGMA integrity_check` on it does not return exactly `ok`. A
   failed backup exits non-zero and says why — it never leaves a half-good directory advertised as
   good.
4. A backup contains, at minimum: `guestflow.db`, `.env.local`, `certs/`, `uploads/`,
   `manifest.txt`, `checksums.sha256`, `integrity_check.txt`.
5. The backup directory is created `0700` and `.env.local` / `server.key` are `0600`: a backup is a
   pile of production secrets in clear, and is treated as such.
6. Backups are timestamped (`guestflow-YYYYMMDD-HHMMSS`) and never overwrite each other; a `latest`
   symlink always points at the most recent one.
7. Rotation keeps the N most recent backups (default 30, `--keep 0` disables pruning).
8. `manifest.txt` records what is needed to interpret the snapshot later: date, source host, the
   local repo `HEAD` and `origin/release` SHAs (i.e. which code the data belongs to), the Pi's node
   version and app version, the integrity-check result, and the file inventory.
9. Restore never destroys the target's current state: the existing remote `guestflow.db` and
   `.env.local` are moved/copied aside as `*.pre-restore-<stamp>` before being replaced.
10. Restore removes any stale `guestflow.db-wal` / `guestflow.db-shm` on the target — they belong
    to the *replaced* database file and would corrupt the restored one.
11. Restore stops PM2 before writing, re-creates the `current/server/{guestflow.db,.env.local}`
    symlinks the deploy workflow expects, and restarts PM2 afterwards.
12. Restore refuses to run against a directory that does not contain both `guestflow.db` and
    `.env.local`, and asks for confirmation before overwriting production (`--yes` to skip).
13. No host, IP or absolute path is hardcoded: the Pi is given by `--host` / `$GUESTFLOW_SSH_HOST`,
    the destination by `--dest` / `$GUESTFLOW_BACKUP_DIR` (default `~/GuestFlowBackups`).

**Edge cases:**
- Pi unreachable / SSH key not set up → clear error, exit 1, no empty backup directory advertised.
- No TLS cert on the Pi → skipped with a warning (a cert is regenerable, unlike data).
- No `uploads/` directory → skipped with a warning.
- Pi replaced with a different LAN IP → `restore-to-pi.sh --skip-certs`, then regenerate the cert
  with `server/scripts/generate-self-signed-cert.sh` (the old cert's SANs no longer match).
- App not deployed yet on a fresh Pi → restore still drops the data in `~/guestflow/data/`, skips
  the symlinks, and warns that PM2 has no `guestflow` process (deploy `release` first).

---

## 4. Architecture

No server or client code is involved: this is operator tooling around the deployment, living in
`scripts/` next to the other operational scripts.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| all | — | — | (none — no application code touched) |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| all | — | — | (none — no UI) |

**Component reuse declaration:** not applicable, no UI surface.

### 4.3 Tooling (`scripts/`)

| File | T/C | Responsibility |
|---|---|---|
| `scripts/backup-from-pi.sh` | C | Pulls a consistent snapshot (DB via `sqlite3 .backup`, `.env.local`, `certs/`, `uploads/`), verifies integrity, writes manifest + checksums, rotates old backups. |
| `scripts/restore-to-pi.sh` | C | Pushes a backup back onto a Pi: stops PM2, archives current data, uploads DB/secrets/certs/uploads, re-links `current/server/*`, restarts PM2. |
| `README.md` | T | New §"Backup & restore" documenting the two commands and the disaster-recovery runbook. |

### 4.4 Disaster-recovery runbook (Pi is dead)

1. Flash Raspberry Pi OS, restore SSH access, install node + `pm2`, re-register the GitHub Actions
   self-hosted runner (README §"Deployment using GitHub runner").
2. Push `release` (or re-run the deploy workflow) so `~/guestflow/current/` is rebuilt from git.
   The app boots on an **empty** database — expected, do not use it yet.
3. `scripts/restore-to-pi.sh --host pi@<new-host> --from ~/GuestFlowBackups/latest`
   (add `--skip-certs` if the Pi's IP changed, then regenerate the cert).
4. Verify: `ssh pi@<new-host> 'pm2 logs guestflow --lines 30'`, then open the app and check the
   reservation count and that Paramètres shows Google / SMTP / Qonto still connected — that last
   point is what proves `.env.local` and the DB came back as a coherent pair.

### 4.5 API contract

Not applicable — no HTTP surface.

---

## 5. Data model

No schema change. Read-only against production; the restore path writes whole files, never rows.

**Data impact:** a restore replaces the production database wholesale. Mitigated by rule 9 (the
replaced database stays on the Pi as `guestflow.db.pre-restore-<stamp>`).

## 6. UI / UX

No UI. Both scripts are CLI-only, English output, `--help` on each. No `PageActionBar`, no
responsive concern.

## 7. Test plan

### Server unit tests
None — no server business logic is added (CLAUDE.md §9 "Tests not required for: pure plumbing").

### Manual verification (done 2026-08-09)
- [x] Backup against the live Pi while PM2 was running → `integrity_check: ok`.
- [x] Row counts in the snapshot match the live DB (`reservations` 42, `clients` 42,
      `properties` 2) — proves the 4 MB WAL was folded in.
- [x] The backed-up `.env.local` key decrypts all six `ENCRYPTED_COLUMNS` of the backed-up DB
      (Google calendar id + OAuth refresh token, SMTP password, Qonto access + refresh tokens,
      Météo-France key) — proves DB and key are a usable pair.
- [x] Permissions: backup dir `0700`, `.env.local` and `server.key` `0600`.
- [x] `manifest.txt` + `checksums.sha256` generated; `latest` symlink points at the new backup.
- [ ] Full restore onto a Pi — **not executed**: the only Pi available is production, and rule 9's
      safety net does not justify a live overwrite rehearsal. To be exercised on the next SD-card
      swap or on a spare Pi.

## 8. Out of scope

- Automatic scheduling (launchd / cron). Decided 2026-08-09: manual runs only for now. The script
  is schedulable as-is if that changes.
- Off-site / cloud replication (the backup lives on the Mac; Time Machine covers the Mac).
- Backing up the WordPress container (`wp_app`) that shares the Pi — separate concern, separate
  tooling.
- Encrypting the backup at rest on the Mac.
- Backing up PM2's process list or the OS configuration — both are re-created by the deploy runbook.

## 9. Open questions

- Q: Should the backup directory itself be encrypted, given it holds `.env.local` in clear?
  - A: Deferred. It sits in `~/GuestFlowBackups` with mode `0700` on a FileVault-encrypted Mac,
    which matches the protection level of the Pi itself. Revisit if backups ever move to a shared
    or removable disk.
- Q: Scheduled backups?
  - A: 2026-08-09 — no, manual only (user's call). Revisit if a manual run gets forgotten.
