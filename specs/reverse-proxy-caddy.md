# Reverse proxy Caddy + TLS termination at the edge

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/reverse-proxy-caddy` _(user-managed)_ |
| **Created** | 2026-06-10 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

Both services now live on the same Raspberry Pi (LAN `192.168.0.196`):

- **WordPress** — Docker container `wp_app`, serving the public site `domainesolio.com`.
- **GuestFlow** — Node/Express under PM2, **terminating TLS itself** on `:4000` with a Let's Encrypt
  certificate issued and renewed by a homemade script
  ([server/scripts/issue-letsencrypt-cert-http01.sh](../server/scripts/issue-letsencrypt-cert-http01.sh):
  acme.sh standalone HTTP-01 + a daily cron at `00:27` + a PM2 reload hook).

Current public routing relies on the Freebox forwarding `WAN:443 → Pi:4000` (GuestFlow) and
`WAN:80 → Pi:80` (acme.sh challenge). There is **no shared front door**: WordPress and GuestFlow
can't both answer on `:443` because Node owns it.

This homemade renewal system is exactly the maintenance burden we want gone, and we now need a
single entry point that can dispatch by hostname to two different backends.

## 2. Goal

A single reverse proxy on the Pi terminates HTTPS for the whole domain and dispatches by hostname:

- `https://domainesolio.com` (and `www`) → WordPress (`wp_app`).
- `https://guestflow.domainesolio.com` → GuestFlow (Express on `:4000`).

Certificates are obtained and **renewed fully automatically** (no cron, no script). GuestFlow stops
terminating TLS and serves plain HTTP internally, while the public connection stays HTTPS — so its
security posture (Secure cookies, HSTS, `upgrade-insecure-requests`) is preserved. All the homemade
TLS/renewal code and deploy wiring is removed.

## 3. Functional rules

1. **Reverse proxy = Caddy**, installed as a **native binary** on the Pi host (systemd service),
   not in Docker. Rationale: it reaches both GuestFlow (`127.0.0.1:4000`, PM2 on the host) and
   WordPress (the Docker-published host port) without extra Docker networking.
2. Caddy listens on `:80` and `:443`. It **auto-redirects HTTP→HTTPS** (Caddy default).
3. Caddy obtains and **auto-renews** Let's Encrypt certs for `domainesolio.com`, `www.domainesolio.com`,
   and `guestflow.domainesolio.com` via the ACME protocol — **no cron, no acme.sh, no manual step**.
4. Host-based routing:
   - `domainesolio.com`, `www.domainesolio.com` → `reverse_proxy 127.0.0.1:8080` (the `wp_app`
     container publishes `0.0.0.0:8080 → 80`, confirmed via `docker ps`).
   - `guestflow.domainesolio.com` → `reverse_proxy 127.0.0.1:4000`.
5. Caddy forwards the standard proxy headers (`X-Forwarded-Proto: https`, `X-Forwarded-For`,
   `Host`) so the upstreams see the real scheme/host. GuestFlow already runs `app.set('trust proxy', 1)`.
6. **GuestFlow no longer terminates TLS.** It always serves plain HTTP on `:4000`. The HTTPS server
   branch, the cert-loading code, and the cert files are removed.
7. **GuestFlow keeps its HTTPS-edge security posture.** Because the public edge (Caddy) is HTTPS:
   - the session cookie stays `Secure`,
   - HSTS is emitted,
   - `upgrade-insecure-requests` is emitted in the CSP.
   These are gated on a renamed env flag `HTTPS_EDGE` (was `HTTPS_ENABLED`) meaning "an HTTPS edge
   sits in front of me", decoupled from "I terminate TLS myself" (which is now never true).
8. The homemade renewal system is removed end-to-end: the acme.sh issuance script, the self-signed
   generator, the `server/certs/` material, and the deploy step + PM2 env vars that referenced them.
9. The setup script is **idempotent and re-runnable**: installing Caddy when missing, (re)writing the
   Caddyfile, validating it (`caddy validate`), and reloading the service without dropping connections.
10. The setup script also **cleans up the old acme.sh cron** on the Pi (the `--cron` line installed
    by the old issuance script) so no stale renewal job lingers.

**Edge cases:**
- Caddy can't reach an upstream (WP container down) → Caddy returns 502; it must NOT take down the
  other vhost. Each `reverse_proxy` is independent.
- Port 80/443 already bound (old setup) → the setup script stops/disables any conflicting binder
  (Node was on `:443` via Freebox forward, not locally; the real change is the Freebox forward,
  see §3-prerequisites). The script logs what it finds on 80/443 and refuses to clobber silently.
- ACME challenge fails (DNS not propagated, Freebox forward wrong) → Caddy retries; the script
  prints how to check `journalctl -u caddy` and the DNS/forward prerequisites.
- HSTS already pinned in browsers from the old direct-HTTPS setup → still HTTPS at the edge, so no
  breakage; the host/scheme are unchanged for `guestflow.*`.

**Operational prerequisites (outside the code, documented in the setup script + README):**
- **DNS** (registrar of `domainesolio.com`): `domainesolio.com` (apex) and `www` + `guestflow`
  must resolve to the home connection. Apex can't be a CNAME → use an A record (or the registrar's
  ALIAS/ANAME) pointing at the Freebox dynamic DNS / WAN IP; `www` and `guestflow` as CNAME →
  apex or the Freebox dyndns host.
- **Freebox port-forward**: `WAN:80 → Pi:80` and `WAN:443 → Pi:443` (both now to **Caddy**, no
  longer `443 → Pi:4000`). This is the single most important change to flip the public entry point.
- **WordPress upstream port**: `127.0.0.1:8080` (confirmed — `wp_app` publishes `0.0.0.0:8080 → 80`).

**State of the Pi at spec time (confirmed over SSH 2026-06-10):**
- `wp_app` → `0.0.0.0:8080 → 80`; GuestFlow Node listening on `:4000`. Nothing bound on local
  `:80`/`:443` (the Freebox forwards `WAN:443 → Pi:4000` today), so Caddy can take `:80`/`:443` freely.
- Caddy not installed yet. No acme.sh cron under the `pi` user (the setup script still checks the
  `root` crontab to be safe).
- An unrelated `ancestry-*` Docker stack also runs on the Pi (ports 5500/5501/5432) — **untouched**
  by this work.

---

## 4. Architecture

> This change is infra + backend only. **No client code changes** — the React build is still served
> by Express and reached through Caddy unchanged.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `utils/` | `httpsBootstrap.js` | T | Drop the HTTPS branch + `loadTlsMaterial`; `buildServer` always returns a plain `http.Server`. Keep the thin seam for testability, or inline into index.js if it becomes trivial. |
| `utils/` | `securityConfig.js` | T | Rename `shouldEnforceHttps`/env `HTTPS_ENABLED` → `HTTPS_EDGE`; semantics now "HTTPS edge in front of me". HSTS + `upgrade-insecure-requests` + Secure cookie gated on it (unchanged logic, clearer name + doc). |
| `index.js` | `index.js` | T | Use the simplified `buildServer` (HTTP only); read `HTTPS_EDGE`; drop any cert path references. |
| `scripts/` | `issue-letsencrypt-cert-http01.sh` | **D** | Delete — Caddy owns issuance/renewal. |
| `scripts/` | `generate-self-signed-cert.sh` | **D** | Delete — no local TLS material needed. |
| `certs/` | `server/certs/*` | **D** | Delete cert material + its README. |
| `tests/` | `https-bootstrap.unit.test.js` | T | Drop the HTTPS-branch assertions; keep the "always HTTP" assertion. |
| `tests/` | `security-config.unit.test.js` | T | Update to the `HTTPS_EDGE` name; assert Secure cookie + HSTS + upgrade when `HTTPS_EDGE=true`, off otherwise. |

### 4.2 Infra / deploy (repo root)

| File | T/C | Responsibility |
|---|---|---|
| `deploy/caddy/Caddyfile` | C | The Caddy config: two site blocks (`domainesolio.com`/`www` → WP, `guestflow.domainesolio.com` → GuestFlow), header forwarding, automatic HTTPS. Uses an env placeholder for the WP upstream. |
| `scripts/setup-reverse-proxy.sh` | C | Run **on the Pi**. Installs Caddy (official apt repo) if absent, copies the Caddyfile to `/etc/caddy/Caddyfile` (substituting `WP_UPSTREAM` / email), `caddy validate`, enables + reloads the systemd service, and removes the stale acme.sh renewal cron. Idempotent. |
| `.github/workflows/deploy.yml` | T | Remove the commented self-signed provisioning step (lines ~267-289) and the PM2 env `HTTPS_ENABLED`/`TLS_CERT_PATH`/`TLS_KEY_PATH` (lines ~388-390); replace with `HTTPS_EDGE=true`. Remove any cert symlink/persistence wiring. |
| `README.md` | T | Replace the "HTTPS / self-signed cert / acme.sh" section with the Caddy reverse-proxy topology (DNS + Freebox + Caddyfile + setup script). |
| `changelog.d/` | C | `changed--reverse-proxy-caddy.md` (+ `removed--*` for the dropped TLS scripts). |

### 4.3 API contract

No API contract change. Only the transport/topology in front of the API changes (HTTPS terminated
by Caddy instead of by Node; same paths, same payloads).

---

## 5. Data model

No database change.

## 6. UI / UX

No UI change. The app renders identically; only the URL host for GuestFlow changes to
`guestflow.domainesolio.com`. No `PageActionBar` impact.

## 7. Test plan

### Server unit tests
- [x] `tests/https-bootstrap.unit.test.js` — `buildServer` always returns an HTTP server (no
      HTTPS branch, no cert lookup).
- [x] `tests/security-config.unit.test.js` — `HTTPS_EDGE=true` → Secure cookie + HSTS +
      `upgrade-insecure-requests`; unset/false → none of them.

_Full suite: 1318 tests pass (`cd server && npm test`)._

### Manual verification (on the Pi, post-deploy)
- [ ] `caddy validate --config /etc/caddy/Caddyfile` passes.
- [ ] `https://domainesolio.com` serves WordPress with a valid (browser-trusted) cert.
- [ ] `https://guestflow.domainesolio.com` serves GuestFlow with a valid cert; login works
      (Secure cookie round-trips over the HTTPS edge).
- [ ] `http://…` redirects to `https://…` for both hosts.
- [ ] GuestFlow process listens on plain HTTP `:4000` (`curl -sI http://127.0.0.1:4000` on the Pi).
- [ ] Stop `wp_app` → `domainesolio.com` returns 502 but `guestflow.*` still works (isolation).
- [ ] No acme.sh cron remains (`crontab -l` for the relevant user is clean).
- [ ] Re-run `setup-reverse-proxy.sh` → idempotent, no errors, service reloaded.

## 8. Out of scope

- Migrating WordPress itself or its content (separate WordPress recreation work).
- Hardening Caddy beyond defaults (rate limiting, WAF, geo-blocking).
- Encrypting GuestFlow secrets at rest (separate tech-debt item).
- Changing the GitHub Actions → PM2 deploy mechanism itself (only its TLS env wiring is touched).
- Automating DNS / Freebox port-forward (manual operator steps, documented not scripted).

## 9. Open questions

- Q: WordPress upstream host port published by `wp_app`?
  - A: **Resolved 2026-06-10** — `127.0.0.1:8080` (`wp_app` publishes `0.0.0.0:8080 → 80`).
- Q: Keep the `httpsBootstrap.js` seam or inline into `index.js` once it's HTTP-only?
  - A: _proposed: keep a minimal `buildServer` for test symmetry; decide at implementation._
- Q: Rename `HTTPS_ENABLED` → `HTTPS_EDGE`, or keep the old name to avoid churn?
  - A: **Resolved 2026-06-10** — rename to `HTTPS_EDGE` (old name wrongly implies Node serves HTTPS).
- Q: ACME email for Let's Encrypt registration (expiry notices)?
  - A: **Resolved 2026-06-10** — `adrien.jouve@adn-dev.fr`.
