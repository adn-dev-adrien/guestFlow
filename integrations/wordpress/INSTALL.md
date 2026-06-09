# GuestFlow Booking — install & configure on WordPress

How to package, install and configure the **GuestFlow Booking** WordPress plugin
(`integrations/wordpress/guestflow-booking/`) so a WordPress site can show availability,
compute quotes and send booking requests through the GuestFlow **public API**.

The plugin is a thin **server-to-server proxy + renderer**: the browser only ever talks to the
plugin's PHP proxy on the WordPress server; the GuestFlow API key stays server-side and is never
exposed to the page. All pricing/availability/validation logic stays in GuestFlow.

---

## 0. Prerequisites

1. **A GuestFlow server that exposes the public API** (`/public/v1/*`). Verify before anything else:
   ```bash
   # from the WordPress host, replacing the URL + key:
   curl -k -H "Authorization: Bearer <PUBLIC_API_KEY>" https://<guestflow-host>:4000/public/v1/properties
   ```
   - A **JSON** body `{"data":[...]}` → the public API is live. ✅
   - **HTML** (`<!DOCTYPE html>…`) → you are hitting an older GuestFlow build **without** the public
     API; it falls through to the SPA. Deploy a GuestFlow build that includes `server/src/routes/public`
     (push to the `release` branch) before continuing. ❌
   - **HTTP 000 / connection error over `http://`** → the server is HTTPS-only (see §4 SSL). Use `https://`.

2. The **`PUBLIC_API_KEY`** value, found in GuestFlow's `server/.env.local`
   (`PUBLIC_API_KEY=…`). On a PM2 deploy this is typically `…/guestflow/current/server/.env.local`.

3. **Network reachability from the WordPress host to GuestFlow.** If WordPress runs in **Docker**,
   `localhost` inside the container is the *container*, not the host — use the host's LAN IP/hostname
   (e.g. `https://192.168.0.196:4000`) or `host.docker.internal`, **not** `http://localhost:4000`.

---

## 1. Build the installable zip

No build step — the source is the artifact:

```bash
bash integrations/wordpress/guestflow-booking/bin/make-zip.sh
# → integrations/wordpress/guestflow-booking.zip
```

## 2. Install & activate in WordPress

1. **Extensions → Ajouter une extension → Téléverser une extension**.
2. Choose `guestflow-booking.zip`, **Installer maintenant**, then **Activer l'extension**.
3. A **Réglages → GuestFlow** menu item appears.

(Alternatively, copy the `guestflow-booking/` folder into `wp-content/plugins/` and activate.)

## 3. Configure (Réglages → GuestFlow)

| Field | Value |
|---|---|
| **URL de l'API GuestFlow** | Base URL **without** `/public/v1`, e.g. `https://192.168.0.196:4000`. |
| **Clé d'API** | Paste the `PUBLIC_API_KEY` (see §3.1 for the more secure constant). |
| **Vérification SSL** | Leave **checked** in production. **Uncheck** only for a self-signed local/LAN server (see §4). |
| **Logement par défaut (ID)** | Optional — property id used by a block when none is selected. |
| **Page de réservation** | The page holding the booking block; property cards link to it with `?property=ID`. |
| **Cache lecture / disponibilités (s)** | Response cache TTLs (defaults 600 / 300). |

Click **Enregistrer les modifications**, then **Tester la connexion** → expect
*« Connexion réussie — N logement(s). »*

### 3.1 Recommended: API key via `wp-config.php` constant (production)

Storing the key as a constant keeps it out of the database and the UI. It **wins** over the option:

```php
// wp-config.php, above /* That's all, stop editing! */
define('GUESTFLOW_API_KEY', 'paste-the-PUBLIC_API_KEY-here');
```

When the constant is set, the key field is disabled in the UI. You can pin SSL the same way:

```php
define('GUESTFLOW_SSL_VERIFY', true);  // or false for a trusted self-signed local server
```

## 4. HTTPS & self-signed certificates

GuestFlow may serve **HTTPS with a self-signed certificate** (common on a local PM2 deploy). By
default the plugin **verifies** the certificate, so a self-signed cert makes every call fail with
**HTTP 502** (*« Service de réservation momentanément indisponible »*).

- **Trusted local/LAN server, self-signed cert:** uncheck **Vérification SSL** (or
  `define('GUESTFLOW_SSL_VERIFY', false);`). Only do this on a network you control.
- **Production over the public internet:** use a **valid certificate** (Let's Encrypt / reverse
  proxy) and keep SSL verification **on**.

## 5. Add the blocks to a page

In the block editor, add any of: **GuestFlow — Disponibilités** (calendar), **GuestFlow —
Réservation** (booking form), **GuestFlow — Logements** (properties list). Pick a property in the
block sidebar (or rely on the default property id).

---

## 6. Troubleshooting

| Symptom (Test de connexion / blocks) | Cause | Fix |
|---|---|---|
| *Clé ou URL d'API non configurée* | URL or key empty | Fill both in Réglages → GuestFlow. |
| *Échec d'authentification : clé invalide* (401) | Wrong `PUBLIC_API_KEY` | Re-copy the key from GuestFlow's `server/.env.local`. |
| *Serveur injoignable ou erreur (code 502)* | TLS rejected (self-signed) **or** host unreachable | Uncheck SSL verify for self-signed (§4); check the URL/host reachability from the WP host (§0.3). |
| Test "succeeds" but returns **HTML** / 0 properties | GuestFlow build **without** the public API | Deploy a GuestFlow build that includes `/public/v1` (push to `release`). |
| Works on host but not from the Docker container | `localhost` resolves to the container | Use the host LAN IP/hostname or `host.docker.internal` (§0.3). |

Quick server-side checks (from the WordPress host):

```bash
# Is the public API live and the key valid? (‑k accepts a self-signed cert)
curl -k -H "Authorization: Bearer <PUBLIC_API_KEY>" https://<host>:4000/public/v1/properties
# From inside a Docker WordPress container:
docker exec <wp_container> curl -sk -o /dev/null -w '%{http_code}\n' https://<host>:4000/public/v1/properties
```

---

## 7. This deployment (Domaine Solio, host `192.168.0.196`)

- WordPress runs in Docker (`wp_app`, `wordpress:6-apache`) on `:8080`; GuestFlow runs on the **host**
  (PM2) on **HTTPS `:4000`** with a **self-signed** certificate.
- Plugin config: **URL** `https://192.168.0.196:4000` (host LAN IP — not `localhost`, which would be
  the container), **Vérification SSL unchecked**, key via `GUESTFLOW_API_KEY` in `wp-config.php`.
- The public API must be deployed to the Pi (push to `release`) before the plugin can work — the
  build that was live at first install (`50ae419`) predates `/public/v1`.
