- **Off-device backup & restore of the production Pi** (spec `backup-restore.md`, 2026-08-09).
  `scripts/backup-from-pi.sh` pulls a complete snapshot from the Raspberry Pi to a workstation —
  SQLite database via `sqlite3 .backup` (WAL folded in, `PRAGMA integrity_check` enforced),
  `data/.env.local` (the encryption key, without which the encrypted settings columns are
  unreadable), `certs/` and `server/uploads/` — into a timestamped `0700` directory with a
  manifest, SHA-256 checksums, a `latest` symlink and 30-backup rotation.
  `scripts/restore-to-pi.sh` pushes a backup back: stops PM2, archives the current DB and
  `.env.local` as `*.pre-restore-<stamp>`, clears the stale WAL/SHM, re-creates the deploy
  symlinks and restarts PM2. Documented in README §"Backup & restore" with the disaster-recovery
  runbook. No application code touched.
