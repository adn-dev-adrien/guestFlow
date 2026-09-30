const express = require('express');
const rateLimit = require('express-rate-limit');
const { MESSAGES, formPage, listPage, rememberedPage } = require('../utils/loginPage');

const COOKIE = 'gf_space';
const REMEMBER_MS = 90 * 24 * 60 * 60 * 1000;

function readCookie(req, name) {
  const pair = String(req.headers.cookie || '').split(';').map((p) => p.trim()).find((p) => p.startsWith(`${name}=`));
  return pair ? decodeURIComponent(pair.slice(name.length + 1)) : null;
}

// The shared login page on `app.<domain>` (specs/control-plane-plans-and-access.md rules 24, 25, 27).
// Thin: the lookup is the login controller's; this file speaks HTML, forms and one cookie.
function publicRoutes(ctx, { secureCookies = false } = {}) {
  const router = express.Router();
  const login = ctx.controllers.login;
  const cookieOptions = { httpOnly: true, sameSite: 'lax', secure: secureCookies, path: '/' };
  const html = (res, status, body) => res.status(status).type('html').set('Cache-Control', 'no-store').send(body);

  // Its own policy rather than helmet's default: a form that ends in a redirect to the customer's
  // space is a `form-action` to `https://*.<domain>`, which `'self'` alone blocks — found in the
  // browser on the first run. No script anywhere, nothing framed.
  const csp = [
    "default-src 'none'", "style-src 'unsafe-inline'", "img-src 'self' data:",
    `form-action 'self' https://*.${ctx.domain}`, "base-uri 'none'", "frame-ancestors 'none'",
    ...(secureCookies ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
  router.use((req, res, next) => { res.set('Content-Security-Policy', csp); next(); });
  router.use(express.urlencoded({ extended: false, limit: '4kb' }));

  const go = (res, slug, email) => {
    res.cookie(COOKIE, slug, { ...cookieOptions, maxAge: REMEMBER_MS });
    return res.redirect(303, login.loginUrl(slug, email));
  };

  router.get('/', (req, res) => {
    const space = login.remembered(readCookie(req, COOKIE));
    if (!space && readCookie(req, COOKIE)) res.clearCookie(COOKIE, cookieOptions);
    return html(res, 200, space ? rememberedPage({ space }) : formPage());
  });

  // Rule 27: a lookup reveals whether an email has a space, so ten a minute per address.
  const limited = rateLimit({
    windowMs: 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (req, res) => html(res, 429, formPage({ message: MESSAGES.tooMany })),
  });

  // Rule 25: only `email` is read from the form.
  router.post('/lookup', limited, (req, res) => {
    const email = String((req.body && req.body.email) || '');
    const found = login.lookup(email);
    if (found.kind === 'one') return go(res, found.spaces[0].slug, email);
    if (found.kind === 'several') return html(res, 200, listPage({ spaces: found.spaces, email: email.trim() }));
    return html(res, 200, formPage({ message: MESSAGES[found.kind], email }));
  });

  router.post('/go', (req, res) => {
    const space = login.remembered(req.body && req.body.slug);
    if (!space) return res.redirect(303, '/');
    return go(res, space.slug, req.body.email);
  });

  router.post('/forget', (req, res) => {
    res.clearCookie(COOKIE, cookieOptions);
    return res.redirect(303, '/');
  });

  router.use((req, res) => res.status(404).type('text').send('Introuvable.'));
  return router;
}

module.exports = { publicRoutes, COOKIE };
