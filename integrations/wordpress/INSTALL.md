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
   curl -H "Authorization: Bearer <PUBLIC_API_KEY>" https://<guestflow-host>/public/v1/properties
   ```
   - A **JSON** body `{"data":[...]}` → the public API is live. ✅
   - **HTML** (`<!DOCTYPE html>…`) → you are hitting an older GuestFlow build **without** the public
     API; it falls through to the SPA. Deploy a GuestFlow build that includes the public API before
     continuing. ❌
   - **HTTP 404 `{"error":"PLUGIN_INACTIVE","plugin":"website-booking"}`** → the « Réservation depuis le
     site » plugin is installed but switched off: turn it on in Paramètres › Plugins. ❌
   - **HTTP 404 `{"error":{"code":"NOT_FOUND",…}}`** → the plugin is not installed: install it from
     Paramètres › Plugins. ❌ « Tester la connexion » says *« Module « Réservation depuis le site »
     inactif dans GuestFlow. »* in both cases.
   - **HTTP 000 / connection error over `http://`** → the server is HTTPS-only (see §4 SSL). Use `https://`.

2. The **URL and the key**, shown in GuestFlow under **Paramètres › Intégrations › Site internet**
   (admin only): « URL de l'API GuestFlow » and « Clé d'API », each with « Copier ». The key is
   created when the « Réservation depuis le site » plugin is installed; uninstalling the plugin never
   rotates it. « Régénérer la clé » replaces it at once — the site stops answering until the new key
   is pasted into WordPress. (The key lives in the instance's `.env.local`; a `PUBLIC_API_KEY` set in
   the server's real environment wins and cannot be regenerated from the screen.)

3. **Network reachability from the WordPress host to GuestFlow.** If WordPress runs in **Docker**,
   `localhost` inside the container is the *container*, not the host — use the host's LAN IP/hostname
   or `host.docker.internal`, **not** `http://localhost:4000`.

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

Paste the two values from §0.2, save — that is the whole setup. Everything else has a derived
default.

| Field | Value |
|---|---|
| **URL de l'API GuestFlow** | Copied from GuestFlow (base URL **without** `/public/v1`, e.g. `https://guestflow.example.com`). |
| **Clé d'API** | Copied from GuestFlow (see §3.1 for the more secure constant). |
| **Vérification SSL** | Leave **checked** in production. **Uncheck** only for a self-signed local/LAN server (see §4). |
| **Logement par défaut** | Chosen by name in GuestFlow's list (pre-selected when there is only one). Used by a booking block that names no property. |
| **Page de réservation** | *Automatique* = the published page holding the booking block; or pick a page; or « Créer la page » (a « Réserver » page with the booking block, which lists the properties until one is chosen). Property cards link to it with `?property=ID`. |
| **Page des conditions générales** | *Automatique* = the published page holding `[guestflow_cgv]`; or pick a page; or « Créer la page ». The booking form's CGV checkbox links to it — the acceptance GuestFlow records depends on it. |
| **Réglages avancés › Proxys du réseau local** | On by default: a reverse proxy with a private or loopback address (10/8, 172.16/12, 192.168/16, 127/8) passes the visitor's IP through `X-Forwarded-For` without being listed. |
| **Réglages avancés › Proxys de confiance** | Only for a proxy with a **public** address in front of WordPress. The screen names the one it sees when there is one. The CGV acceptance record and the anti-spam limit use the visitor's IP. |
| **Réglages avancés › Cache lecture / disponibilités (s)** | Response cache TTLs (defaults 600 / 300). |

Click **Enregistrer les modifications**. Once configured, the page runs **Tester la connexion** by
itself → expect *« Connexion réussie — N logement(s). »*

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
block sidebar (or rely on the default property).

---

## 6. Troubleshooting

| Symptom (Test de connexion / blocks) | Cause | Fix |
|---|---|---|
| *Clé ou URL d'API non configurée* | URL or key empty | Fill both in Réglages → GuestFlow. |
| *Échec d'authentification : clé invalide* (401) | Wrong key, or regenerated in GuestFlow | Re-copy it from Paramètres › Intégrations › Site internet. |
| *Module « Réservation depuis le site » inactif dans GuestFlow.* | Plugin off or not installed | Paramètres › Plugins in GuestFlow (§0.1). The blocks show *« Réservation temporairement indisponible. »* meanwhile. |
| *Réservation en ligne fermée pour le moment.* (in the booking block) | No CGV published while GuestFlow requires them | Publish the CGV in Paramètres › Conditions générales, or lift the requirement there. |
| *Serveur injoignable ou erreur (code 502)* | TLS rejected (self-signed) **or** host unreachable | Uncheck SSL verify for self-signed (§4); check the URL/host reachability from the WP host (§0.3). |
| Test "succeeds" but returns **HTML** / 0 properties | GuestFlow build **without** the public API | Install a GuestFlow release that includes `/public/v1` (Paramètres › Système). |
| Works on host but not from the Docker container | `localhost` resolves to the container | Use the host LAN IP/hostname or `host.docker.internal` (§0.3). |

Quick server-side checks (from the WordPress host):

```bash
# Is the public API live and the key valid? (‑k accepts a self-signed cert)
curl -k -H "Authorization: Bearer <PUBLIC_API_KEY>" https://<host>/public/v1/properties
# From inside a Docker WordPress container:
docker exec <wp_container> curl -sk -o /dev/null -w '%{http_code}\n' https://<host>/public/v1/properties
```

---

## 7. This deployment (Domaine Solio)

- WordPress runs on its own host; GuestFlow is published at `https://guestflow.domainesolio.com`
  behind a reverse proxy with a valid certificate, so **Vérification SSL stays checked**.
- Plugin config: the URL and key copied from Paramètres › Intégrations › Site internet, the key via
  `GUESTFLOW_API_KEY` in `wp-config.php`. « Proxys de confiance » lists the edge proxy, as before;
  « Proxys du réseau local » covers it too when its address is private.
- GuestFlow updates are releases installed from Paramètres › Système; the WordPress plugin updates
  itself from the GuestFlow manifest (`specs/wordpress-plugin-self-update.md`).
