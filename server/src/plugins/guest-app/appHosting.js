/**
 * Serving the two web apps of the plugin (specs/guest-app.md §4.1, plan step 50), through `ctx.webApp`:
 *   - the guest app « Mon séjour » (`apps/guest` in this folder) on the guest host, at every path but the core's trees — the stay link
 *     `/s/<token>`, the poster `/l/<code>`, `/retrouver`, the Qonto return `/commande/<id>`… all open the app;
 *   - the booklet studio (`apps/studio`) at `/studio` on the admin host, for an admin session only (rule 47).
 *
 * Caching: the hashed bundles under `/assets/` are immutable; `index.html`, the service worker and the manifest are
 * revalidated on every load, so a new version reaches a guest at the next visit. Every other path that is not a file is
 * the app's own route: its `index.html`. A build that is not there answers a plain 503 page.
 *
 * Where the builds are: inside the plugin package (`server/assets/<name>`, copied there by
 * scripts/build-plugin-packages.mjs), else this folder's own build (`apps/<name>/dist`) when the plugin runs from its sources.
 */

const fs = require('fs');
const path = require('path');

const NO_CACHE = 'no-cache';
const IMMUTABLE = 'public, max-age=31536000, immutable';
const ONE_DAY = 'public, max-age=86400';
const REVALIDATED = new Set(['/index.html', '/sw.js', '/manifest.webmanifest']);

/** The build of `name`: the first candidate holding an `index.html`, or null. */
function distDirOf(name, candidates = [
  path.join(__dirname, 'assets', name),
  path.join(__dirname, 'apps', name, 'dist'),
]) {
  return candidates.find((dir) => fs.existsSync(path.join(dir, 'index.html'))) || null;
}

/** The guest app's policy: itself only; the Soliomap frame only while « Intégrer dans l'app » is on (rule 15). */
function guestCsp({ frameOrigin = null } = {}) {
  return [
    "default-src 'self'",
    "script-src 'self'",
    // MUI / emotion inject their styles at run time.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "manifest-src 'self'",
    "worker-src 'self'",
    `frame-src ${frameOrigin || "'none'"}`,
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}

/** The Soliomap origin the guest app may frame, or null. */
function soliomapFrameOrigin({ soliomapUrl, soliomapEmbed }) {
  if (!(soliomapEmbed === true || soliomapEmbed === '1' || soliomapEmbed === 1)) return null;
  try {
    const url = new URL(String(soliomapUrl));
    return url.protocol === 'https:' ? url.origin : null;
  } catch {
    return null;
  }
}

const page = (title, text) => `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body style="font-family:system-ui,sans-serif;margin:3rem auto;max-width:28rem;padding:0 1rem;color:#22271F;background:#F5F0E6"><h1 style="font-weight:400">${title}</h1><p>${text}</p></body></html>`;

/**
 * A handler serving one build. `dir()` → the build directory or null; `base` the path the app lives under ('' or
 * '/studio'); `csp()` the policy of every answer.
 */
function staticApp({ dir, base = '', csp }) {
  return (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    res.set('Content-Security-Policy', csp());
    res.set('X-Content-Type-Options', 'nosniff');
    const root = dir();
    if (!root) {
      res.set('Cache-Control', 'no-store');
      return res.status(503).type('html').send(page('Application indisponible', 'Cette application n’est pas encore installée sur ce serveur.'));
    }
    let rel = req.path.slice(base.length) || '/';
    if (!rel.startsWith('/')) rel = `/${rel}`;
    let decoded;
    try {
      decoded = decodeURIComponent(rel);
    } catch {
      return res.status(400).end();
    }
    const file = path.resolve(root, `.${decoded}`);
    const inside = file === root || file.startsWith(`${root}${path.sep}`);
    if (inside && decoded !== '/' && fs.existsSync(file) && fs.statSync(file).isFile()) {
      const cache = decoded.startsWith('/assets/') ? IMMUTABLE : (REVALIDATED.has(decoded) ? NO_CACHE : ONE_DAY);
      return res.sendFile(file, { headers: { 'Cache-Control': cache }, dotfiles: 'deny' });
    }
    // A missing file is a 404; any other path is a route of the app.
    if (!inside || /\.[a-z0-9]{1,8}$/i.test(decoded)) return res.status(404).type('text').send('Not found');
    return res.sendFile(path.join(root, 'index.html'), { headers: { 'Cache-Control': NO_CACHE } });
  };
}

/** Rule 47 — the studio for an admin session only: no session → the GuestFlow login, another role → 403. */
function adminOnly(handler, { loginPath = '/login' } = {}) {
  return (req, res, next) => {
    const user = req.session && req.session.user;
    if (!user) {
      res.set('Cache-Control', 'no-store');
      return res.redirect(302, `${loginPath}?next=${encodeURIComponent(req.originalUrl || '/studio')}`);
    }
    const roles = Array.isArray(user.roles) ? user.roles : [user.role];
    if (!roles.includes('admin')) {
      res.set('Cache-Control', 'no-store');
      return res.status(403).type('html').send(page('Accès réservé', 'Le studio du livret est réservé aux administrateurs.'));
    }
    return handler(req, res, next);
  };
}

module.exports = {
  adminOnly, distDirOf, guestCsp, soliomapFrameOrigin, staticApp,
};
