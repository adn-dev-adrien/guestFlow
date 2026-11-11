# Hosting host — runbook

The host that runs the hosted GuestFlow fleet: one process per customer, behind Caddy, backed up by
Litestream, driven by the console. Why it is built this way: [`specs/hosting-h1-fleet-runtime.md`](../../specs/hosting-h1-fleet-runtime.md)
(decisions H-D1 to H-D6). Self-hosted installs (Solio) do **not** use any of this: they keep PM2 and
the in-app update of [`specs/self-update-and-releases.md`](../../specs/self-update-and-releases.md).

## Identities (rule 21)

| User | Runs | Can |
|---|---|---|
| `root` | systemd, Caddy, the three wrappers | — |
| `guestflow` | the console | create and read the instances' directories (member of `guestflow-app`), open Caddy's admin socket (member of `caddy`), run `guestflow-systemctl`, `guestflow-litestream-apply` and `guestflow-instance-identity` through sudo |
| `gf-c<customer id>` | one instance each (group `guestflow-app`) | sees only its own directory, the releases read-only, only its own processes in `/proc`; never `/srv/guestflow/console`, `/srv/guestflow/envs`, `/run/caddy` |
| `guestflow-backup` | Litestream (group `guestflow-app`) | reads and writes the databases, nothing else; root-owned configuration |

The instance users are created, kept across a rename (they are keyed on the customer) and removed at
the erasure by `guestflow-instance-identity`, which also writes the unit's `User=` drop-in
(`/etc/systemd/system/guestflow@<slug>.service.d/identity.conf`). Without it the unit runs as
`nobody` and fails. Caddy adds a secret header (`header_up X-Guestflow-Proxy …`) to everything it
forwards; the console (`CP_PROXY_SECRET`) and each instance (`GUESTFLOW_PROXY_SECRET`, in its env
file) ignore `X-Forwarded-*` without it, so a process calling them on 127.0.0.1 cannot claim another
client address.

## Layout

```
/srv/guestflow/
  instances/                 guestflow:guestflow-app 2770 (setgid: everything inside stays in the group)
  instances/<slug>/          one directory per customer — the console creates it
    data/guestflow.db        its database, 0660 (+ licence.jws, local.env, platform-mail.json, backups/)
    uploads/                 its photos and logo
    private-documents/       its property documents (outside the public uploads tree)
  releases/<version>/        each GuestFlow version, unpacked once, shared by every instance on it
                             (guestflow:guestflow-app 2750, files g+r never g+w: read-only for the instances)
  envs/<slug>                each instance's whole configuration (0600 in a 0700 dir of guestflow);
                             systemd reads it as root; the instances never see it
  console/                   guestflow 700 — invisible to the instances
    src/                     the repository at the deployed tag (the console runs from it)
    env                      the console's environment (mode 600)
    data/                    the console's database, keys and exports; backups/ its nightly copies (7)
  closed/index.html          « Cet espace a été fermé »
/etc/caddy/Caddyfile         main file; admin API on /run/caddy/admin.sock (0660, group caddy);
                             imports /etc/caddy/sites/*.caddy (one per address, written by the console)
/etc/litestream.yml          root 644, one entry per database, written only by guestflow-litestream-apply
/etc/default/litestream      root 600: the object storage keys, for the Litestream service — copied by
                             bootstrap from the console's env, their only source
/etc/systemd/system/guestflow@.service       the instance template
/etc/systemd/system/guestflow-console.service
/usr/local/sbin/guestflow-systemctl          root wrapper: the instance units only (via sudo)
/usr/local/sbin/guestflow-litestream-apply   root wrapper: Litestream's configuration from checked entries, then a restart
/usr/local/sbin/guestflow-instance-identity  root wrapper: an instance's user gf-c<id> and its unit's User= drop-in
```

| File here | Installed as |
|---|---|
| `guestflow@.service` | `/etc/systemd/system/guestflow@.service` |
| `guestflow-console.service` | `/etc/systemd/system/guestflow-console.service` |
| `guestflow-systemctl` | `/usr/local/sbin/guestflow-systemctl` (root, 755) |
| `guestflow-litestream-apply` | `/usr/local/sbin/guestflow-litestream-apply` (root, 755) |
| `guestflow-instance-identity` | `/usr/local/sbin/guestflow-instance-identity` (root, 755) |
| `litestream.override.conf` | `/etc/systemd/system/litestream.service.d/guestflow.conf` (Litestream as `guestflow-backup`) |
| `caddy.override.conf` | `/etc/systemd/system/caddy.service.d/guestflow.conf` (`/run/caddy` for the admin socket) |
| `guestflow.sudoers` | `/etc/sudoers.d/guestflow` (440) |
| `Caddyfile` | `/etc/caddy/Caddyfile` (`__DOMAIN__`, `__ACME_EMAIL__` replaced) |
| `closed/index.html` | `/srv/guestflow/closed/index.html` |
| `litestream.yml` | `/etc/litestream.yml` (root:root, 644) |
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
6. **Keep a copy of the console's keys offline**: the licence private key
   (`CP_LICENCE_PRIVATE_KEY` in `/srv/guestflow/console/env`, generated by bootstrap) and the key
   files `/srv/guestflow/console/data/.key` and `.directory-key` (created at the console's first
   start). The database is replicated, these are not: without the licence key no licence, support
   link or registry index can be signed again.

## Bootstrap

```bash
# on the host, as root, from a copy of this directory
DOMAIN=guestflow.fr ACME_EMAIL=ops@guestflow.fr \
REPO_URL=https://github.com/<owner>/guestFlow.git REF=v3.10.0 \
S3_ACCESS_KEY_ID=… S3_SECRET_ACCESS_KEY=… \
bash deploy/hosting/bootstrap-host.sh
```

The repository is public: the host clones it over HTTPS, with no key. (A private fork would need a
read-only deploy key for the `guestflow` user, `sudo -u guestflow ssh-keygen -t ed25519`, and an
SSH `REPO_URL`.)

What bootstrap writes into `/srv/guestflow/console/env` by itself:
- the session and proxy secrets;
- **the licence key pair** (H1 rule 26): an Ed25519 private key in base64 DER (PKCS8) in
  `CP_LICENCE_PRIVATE_KEY`, generated when it is empty (an optional `CP_REGISTRY_PRIVATE_KEY`, same format, signs the plugin registry's index instead — specs/plugins-phase-4-registry.md rule 42). It prints the public key for the record;
  nothing has to be done with it — the console writes it into every instance's environment;
- **optional release signing** (self-update rule 41): `GUESTFLOW_RELEASE_PUBLIC_KEY` in the console env makes the
  console refuse any fleet release without a valid `SHA256SUMS.sig`. Bootstrap never sets it, and while it is unset the console logs a `[security]` line at boot and keeps a host alert open (self-update rule 47): signing is the only barrier against a malicious release; the maintainer
  generates the key pair off the host (`node scripts/sign-release.mjs keygen <file>`) and signs each release
  (`... sign <file> vX.Y.Z`). Set it only once the next release is signed;
- **the object storage, typed once** (H1 rule 27): `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY`
  become `LITESTREAM_ACCESS_KEY_ID` / `LITESTREAM_SECRET_ACCESS_KEY`, and `BACKUP_URL`,
  `BACKUP_ENDPOINT`, `BACKUP_REGION` (optional) replace the example's Scaleway target. The console's
  env is their only source: `/etc/default/litestream` is rewritten from it at every bootstrap run,
  and rclone gets the same bucket and keys from the console, its remote derived from
  `CP_BACKUP_URL` — no `rclone config`.

Then:

1. **Fill in `/srv/guestflow/console/env`** — what is left « à remplir »: the console's own SMTP
   (`CP_SMTP_*`) and the platform sender (`CP_PLATFORM_SMTP_*`).
2. **Copy the licence private key offline** (owner action 6).
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
| A failed creation step | « Reprendre » on that step (a failed invitation is sent again, with a new provisional password) |
| A customer never got their invitation, or lost their password or phone | the customer's page → « Renvoyer l’invitation » or « Réinitialiser l’accès » |
| A process that crashed (also past systemd's restart limit) | the alert, then « Redémarrer » on the customer's page |
| Push a plugin version from the registry to the instances that have it | **Versions** → « Plugins » |
| Install a new GuestFlow version on the host | **Versions** → « Vérifier » → « Installer » |
| Update one customer, a selection or the fleet | **Versions** → « Mettre à jour » |
| Put a customer's database back to a moment | the customer's page → « Restaurer à une date » |
| See what is wrong | the alerts on the home page (also emailed once, then every 24 h) |

Nothing here needs a shell. The console only ever calls: `guestflow-systemctl` and
`guestflow-litestream-apply` (through sudo), `caddy reload` (admin socket), `litestream
generations|restore` (by replica URL, keys in its environment), `rclone sync|copy|purge`, and `node`
for an instance's own scripts (a new database, its first administrator, a pushed plugin package).

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
- **Losing the host**: rent a new one and bootstrap it; put back the console's database from its
  newest nightly copy (with the console's env loaded, `set -a; . /srv/guestflow/console/env; set +a`, and the
  derived remote of rule 27 declared: `RCLONE_CONFIG_GFBACKUP_TYPE=s3 … rclone copy gfbackup:<bucket path>/console/ /tmp/console/`, then
  `/srv/guestflow/console/data/control-plane.db`)
  and put back its keys (`CP_LICENCE_PRIVATE_KEY`, `.key`, `.directory-key`, kept offline by the owner — they are
  not in the database); then restore each customer with `litestream restore -o
  /srv/guestflow/instances/<slug>/data/guestflow.db <CP_BACKUP_URL>/c<id>/db` before starting its
  unit, and copy its `uploads` and `private-documents` back with `rclone copy` (the second
  holds the property documents and is absent for a customer who never added one).

## Real-host check (lab)

`deploy/hosting/test/` rebuilds this host in a throwaway privileged Docker container — Debian 12
with systemd as PID 1, SeaweedFS's S3 gateway for the object storage, a local SMTP sink, Caddy's own
CA — runs `bootstrap-host.sh` as above, then every scenario through the console's API: two
customers, a fleet update and a forced rollback, the replica in the object storage, a restore at a
date, the weekly check, deprovision, reactivate, rename, erase, and the isolation from inside an
instance (another instance's files and `/proc`, Litestream's environment, the console's directory,
the env files, the releases, Caddy's socket). Run it before changing anything in this directory:

```bash
deploy/hosting/test/run.sh          # KEEP=1 keeps the containers for a look inside
```

It needs privileged containers, so it is not part of CI. It bundles the **committed** branch.

