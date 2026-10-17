# Hosting host — runbook

The host that runs the hosted GuestFlow fleet: one process per customer, behind Caddy, backed up by
Litestream, driven by the console. Why it is built this way: [`specs/hosting-h1-fleet-runtime.md`](../../specs/hosting-h1-fleet-runtime.md)
(decisions H-D1 to H-D6). Self-hosted installs (Solio) do **not** use any of this: they keep PM2 and
the in-app update of [`specs/self-update-and-releases.md`](../../specs/self-update-and-releases.md).

## Layout

```
/srv/guestflow/
  instances/<slug>/          one directory per customer — the console creates it
    env                      its whole configuration (mode 600), written by the console
    data/guestflow.db        its database (+ licence.jws, local.env, platform-mail.json, backups/)
    uploads/                 its photos and documents
  releases/<version>/        each GuestFlow version, unpacked once, shared by every instance on it
  console/
    src/                     the repository at the deployed tag (the console runs from it)
    env                      the console's environment (mode 600)
    data/                    the console's database, keys and exports
  closed/index.html          « Cet espace a été fermé »
/etc/caddy/Caddyfile         main file; imports /etc/caddy/sites/*.caddy (one per address, written by the console)
/etc/litestream.yml          one entry per database, rewritten by the console
/etc/default/litestream      the object storage keys
/etc/systemd/system/guestflow@.service       the instance template
/etc/systemd/system/guestflow-console.service
/usr/local/sbin/guestflow-systemctl          the only root command the console may run (via sudo)
```

| File here | Installed as |
|---|---|
| `guestflow@.service` | `/etc/systemd/system/guestflow@.service` |
| `guestflow-console.service` | `/etc/systemd/system/guestflow-console.service` |
| `guestflow-systemctl` | `/usr/local/sbin/guestflow-systemctl` (root, 755) |
| `guestflow.sudoers` | `/etc/sudoers.d/guestflow` (440) |
| `Caddyfile` | `/etc/caddy/Caddyfile` (`__DOMAIN__`, `__ACME_EMAIL__` replaced) |
| `closed/index.html` | `/srv/guestflow/closed/index.html` |
| `litestream.yml` | `/etc/litestream.yml` (root:guestflow, 664) |
| `console.env.example` | `/srv/guestflow/console/env` (guestflow, 600), written once |

## Owner actions — before the first customer

These cannot be coded (spec §8):

1. **Buy the platform domain** and set its DNS: `A`/`AAAA` for `console`, `app` and the wildcard
   `*.<domain>` to the host's addresses.
2. **Rent the host**: Hetzner CX33 or CX43, EU region, Debian 12 or Ubuntu 24.04, SSH key only.
3. **Open the EU object storage** (Scaleway or Hetzner) for Litestream: one bucket, one access key
   limited to it.
4. **Create the transactional email account** for the platform sender (`noreply@<domain>`) and set
   **SPF, DKIM and DMARC** on the domain. Without them the guests' providers bin the emails.
5. **Run `bootstrap-host.sh` once**, then fill in the environment (below).
6. **Keep a copy of the console's key files offline** (`/srv/guestflow/console/data/.key`
   and `.directory-key`): the database is replicated, these files are not.

## Bootstrap

```bash
# on the host, as root, from a copy of this directory
DOMAIN=guestflow.fr ACME_EMAIL=ops@guestflow.fr \
REPO_URL=git@github.com:<owner>/guestFlow.git REF=v3.10.0 \
bash deploy/hosting/bootstrap-host.sh
```

The repository is private (D4): give the `guestflow` user a read-only deploy key before running it
(`sudo -u guestflow ssh-keygen -t ed25519`, then add the public key to the repository).

Then:

1. **Fill in `/srv/guestflow/console/env`** — every « à remplir »: the licence private key
   (`CP_LICENCE_PRIVATE_KEY`, control-plane rule 30), the console's own SMTP, the object storage
   (`CP_BACKUP_*`, `CP_RCLONE_REMOTE`) and the platform sender (`CP_PLATFORM_SMTP_*`).
2. **Fill in `/etc/default/litestream`** with the object storage keys, and configure rclone for the
   same bucket: `sudo -u guestflow rclone config` (remote name `guestflow-backup`, type `s3`).
3. **Start the console** and create the first operator:
   ```bash
   systemctl start guestflow-console
   sudo -u guestflow bash -c 'cd /srv/guestflow/console/src/control-plane/server && set -a && . /srv/guestflow/console/env && node scripts/create-operator.js'
   ```
4. Open `https://console.<domain>` → **Versions** → « Vérifier » → « Installer » the newest version.
5. Create a test customer and watch its ten steps turn green; open its address.

## Day to day — all from the console

| Need | Where |
|---|---|
| Create, stop (deprovision), restart (reactivate), rename, erase a customer | the customer's page |
| A failed creation step | « Reprendre » on that step |
| Install a new GuestFlow version on the host | **Versions** → « Vérifier » → « Installer » |
| Update one customer, a selection or the fleet | **Versions** → « Mettre à jour » |
| Put a customer's database back to a moment | the customer's page → « Restaurer à une date » |
| See what is wrong | the alerts on the home page (also emailed once, then every 24 h) |

Nothing here needs a shell. The console only ever calls: `guestflow-systemctl` (through sudo),
`caddy reload`, `litestream generations|restore`, `rclone sync|purge`, and `node` for a new
database.

## Updating the console itself

```bash
sudo -u guestflow git -C /srv/guestflow/console/src fetch --tags && \
sudo -u guestflow git -C /srv/guestflow/console/src checkout v3.11.0 && \
sudo -u guestflow bash -c 'cd /srv/guestflow/console/src/control-plane/server && npm ci --omit=dev' && \
sudo -u guestflow bash -c 'cd /srv/guestflow/console/src/control-plane/client && npm ci && npm run build' && \
systemctl restart guestflow-console
```

A console restarted in the middle of a fleet update marks that update as stopped; check the instance
it was on.

## When things go wrong

- **An instance does not start**: `journalctl -u guestflow@<slug> -n 100`.
- **Caddy refused a site**: the console kept the previous file and shows Caddy's message on the step;
  `caddy validate --config /etc/caddy/Caddyfile` says the same.
- **Backups lag** (alert « dernière sauvegarde répliquée … »): `journalctl -u litestream -n 100`;
  usually the object storage keys or the network.
- **Disk above 85 %**: `du -sh /srv/guestflow/instances/* | sort -h`; old update snapshots live in
  each `data/backups/` (three kept).
- **Losing the host**: rent a new one and bootstrap it; restore the console's database
  (`litestream restore -o /srv/guestflow/console/data/control-plane.db <CP_BACKUP_URL>/console/db`)
  and put back its key files (`.key`, `.directory-key`, kept offline by the owner — they are
  not in the database); then restore each customer with `litestream restore -o
  /srv/guestflow/instances/<slug>/data/guestflow.db <CP_BACKUP_URL>/c<id>/db` before starting its
  unit, and copy its uploads back with `rclone copy`.
