# WordPress plugin — native self-update

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/self-update-and-releases` (shipped with the parent spec) |
| **Created** | 2026-08-20 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

The `guestflow-booking` WordPress plugin lives in this repository
([integrations/wordpress/guestflow-booking](../integrations/wordpress/guestflow-booking)) and runs
inside the `wp_app` Docker container on the production host. It is currently deployed by the last
step of [.github/workflows/deploy.yml](../.github/workflows/deploy.yml), which `tar`-streams the
plugin directory into the container through `docker exec` — from a job running on the self-hosted
runner.

[self-update-and-releases.md](self-update-and-releases.md) deletes that workflow and the
runner. Without a replacement, the plugin would go back to the manual `docker cp` drift that PR
\#325 was written to fix, and the site would silently fall out of sync with the API it talks to.

Giving the GuestFlow Node process access to the Docker socket would solve it in one line and is
exactly the wrong answer: the socket is root on the host, and the point of the parent spec is to
take that class of power away from the application.

## 2. Goal

The plugin updates itself the way every other WordPress plugin does: a badge in
**Extensions → Mises à jour**, a "Mettre à jour" button, no SSH, no Docker, no GitHub agent on the
host.

## 3. Functional rules

1. The plugin's version is `GF_BOOKING_VERSION` in
   [guestflow-booking.php](../integrations/wordpress/guestflow-booking/guestflow-booking.php), which
   must always equal the `Version:` header. It follows its **own** semver line, independent from
   GuestFlow's — the site does not have to update because the app did.
2. The release workflow publishes `guestflow-booking-<pluginVersion>.zip` as a release asset, whose
   archive root is the directory `guestflow-booking/` (WordPress installs by folder name).
3. The plugin's version is only bumped when its files actually changed since the previous release;
   the `/guestflow-release` skill checks this and asks before bumping.
4. GuestFlow exposes a **public update manifest** describing the latest published plugin version,
   derived from the GitHub release assets and cached server-side for 1 h.
5. The plugin polls that manifest through WordPress's own update machinery
   (`pre_set_site_transient_update_plugins`), caching the answer in a transient for 12 h, and
   presents the details through `plugins_api` so the "Voir les détails" modal shows the changelog.
6. The download URL served by the manifest is always the GitHub release asset over HTTPS, on the
   `github.com` / `objects.githubusercontent.com` hosts. The plugin refuses any other host.
7. When GuestFlow is unreachable or the manifest is malformed, the plugin reports no update and
   logs nothing user-visible — a broken API must never break the site's admin.
8. The manifest endpoint is public (it advertises nothing more than a published version number and
   a public download link), rate-limited like the other public endpoints, and cached.

**Edge cases**

- Plugin version ahead of the manifest (local dev copy) → no update offered.
- GuestFlow reachable but no release yet published → manifest returns the current version, no update.
- WordPress on a site that cannot reach GitHub → the update fails inside WordPress's own updater,
  with its standard error; nothing GuestFlow-specific to handle.
- The manifest must never be able to point WordPress at an arbitrary URL — rule 6 is enforced on
  both sides (server builds it from a constant, plugin validates the host).

## 4. Architecture

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `routes/public/` | `pluginUpdate.js` | C | `GET /public/v1/plugin-update` — the manifest |
| `routes/public/` | `index.js` | T | Mounts it inside the existing key-authenticated public tree |
| `controllers/public/` | `pluginUpdateController.js` | C | Builds the manifest from the release state the hourly check already stored; refuses an asset hosted off-GitHub; escapes the changelog HTML |
| `models/` | `updateStateModel.js` | T | Stores `latestPlugin` (name, url, version) alongside the release |
| `utils/` | `releaseClient.js` | — | Already extracts the plugin asset (parent spec) |

### 4.2 WordPress plugin (`integrations/wordpress/guestflow-booking/`)

| File | T/C | Responsibility |
|---|---|---|
| `includes/class-gf-updater.php` | C | Hooks `pre_set_site_transient_update_plugins`, `plugins_api`, `upgrader_process_complete`; transient cache; host validation |
| `guestflow-booking.php` | T | Requires and boots the updater |
| `readme.txt` | T | Keeps the `Stable tag` in sync with the version |

### 4.3 API contract

| Method | Endpoint | Auth | Response |
|---|---|---|---|
| GET | `/public/v1/plugin-update` | public API key (the one the plugin already holds) | `{ slug, version, download_url, requires, requires_php, tested, last_updated, sections: { changelog } }`; `404 NO_PLUGIN_RELEASE` when nothing usable is published |

The shape is the one WordPress's updater expects, so the plugin passes it through with minimal
massaging. It lives inside the existing `/public/v1` tree rather than on an anonymous route, so it
inherits the API key check and the public rate limiter — no new unauthenticated surface.

## 5. Data model

None. The manifest is derived from GitHub release data already cached by the parent spec; the
plugin stores its answer in a WordPress transient.

## 6. UI / UX

No GuestFlow UI. On the WordPress side the experience is the stock one: an update badge in
**Extensions**, the plugin row showing "Une nouvelle version de GuestFlow Booking est disponible",
a "Voir les détails" modal listing the changes, and the standard update button. Nothing to make
responsive — it is WordPress's own admin.

## 7. Test plan

### Server unit tests

- [x] `tests/wordpress-plugin-manifest.unit.test.js` — manifest shape, refusal when no plugin asset
      is published, refusal of any asset hosted off-GitHub or served over plain HTTP, and the
      changelog HTML escaping what it renders.

### Manual verification

- [ ] Publish a release with a bumped plugin version → the WordPress admin shows the update within
      12 h (or immediately after clearing the transient) and installs it successfully.
- [ ] The site keeps working after the update (blocks render, availability + quote calls succeed).
- [ ] GuestFlow stopped → the WordPress plugins page still loads normally, no update offered.

## 8. Out of scope

- Auto-updating the plugin without a click (WordPress's `auto_update_plugins` can be enabled by the
  operator; we do not force it).
- Publishing the plugin on wordpress.org.
- Updating any other WordPress component (theme, mu-plugins under
  [integrations/wordpress/solio-site](../integrations/wordpress/solio-site) — those stay a documented
  manual deployment).

## 9. Open questions

- Q: Which base URL does the plugin use to reach GuestFlow for the manifest — the configured API
  base URL of the existing settings, or a separate one?
  - A: reuse the configured base URL; a second setting is a second thing to get wrong.
- Q: Do we keep a `scripts/deploy-wp-plugin.sh` as a break-glass path for when the site cannot
  update itself?
  - A (2026-08-20): no script. WordPress can install a plugin zip from its own admin
    (Extensions → Ajouter → Téléverser), and the release publishes exactly that zip — a shell script
    would only re-create the `docker exec` coupling this spec removes.

Verified in production **2026-08-20**, with the v2.0.0 release: from inside the WordPress
container, `GET /public/v1/plugin-update` returns 200 and announces version 1.7.0, and the plugin
reads it through its own API client. Plugin 1.7.0 was installed once by hand — unavoidable, since
the update mechanism ships *inside* it — and every version after this one updates from the
WordPress admin.

Two things that install turned up, both predating this spec: the site was still running plugin
**1.4.0** (three versions behind — the `docker exec` sync had been failing silently), and its
configured GuestFlow address still pointed at the decommissioned Raspberry Pi, so the booking funnel
had been down since the Proxmox migration. Repointing it at `https://guestflow.domainesolio.com`
restored it and allowed TLS verification to be turned back on.
