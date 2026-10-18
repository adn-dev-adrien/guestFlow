/**
 * The console's Express app, without listening or scheduling (index.js does both), so tests can
 * mount it on a random port.
 */

const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const { authRoutes } = require('./routes/auth');
const { consoleRoutes } = require('./routes/console');
const { fleetRoutes } = require('./routes/fleet');
const { exportRoutes } = require('./routes/exports');
const { paymentsRoutes, qontoWebhook } = require('./routes/payments');
const { publicRoutes } = require('./routes/public');
const { registryPublicRoutes, registryRoutes } = require('./routes/registry');
const { requireOperator } = require('./middleware/requireOperator');
const { proxySecret, sameOriginWrites } = require('./utils/gf');

const QONTO_WEBHOOK = '/api/payments/qonto/webhook';

function createApp(ctx, { sessionSecret, sessionStore, secureCookies = false, clientDist, appHost, proxySecret: proxySecretValue = null } = {}) {
  const app = express();
  app.set('trust proxy', 1);
  // The instances share the host's loopback: forwarded headers count only with Caddy's secret
  // (specs/hosting-h1-fleet-runtime.md rule 21).
  app.use(proxySecret.proxySecretGuard(proxySecretValue));
  app.use(helmet());
  // specs/control-plane-plans-and-access.md rule 36 — a write comes from the console's own pages or the
  // login page's own forms. `SameSite=Lax` alone lets a same-site page (an instance on
  // `<slug>.<domain>`) post with the operator's cookie. Exempt: Qonto's webhook, server to server and
  // signed. A request without Origin or Referer (scripts, tests) passes; the session guard still applies.
  app.use(sameOriginWrites.createSameOriginWrites({ isExempt: (req) => req.method === 'POST' && req.path === QONTO_WEBHOOK }));

  // Rule 24: `app.<domain>` is the shared login page and nothing else. It shares this process with the
  // console, and neither answers on the other's host.
  const login = publicRoutes(ctx, { secureCookies });
  app.use((req, res, next) => (appHost && req.hostname === appHost ? login(req, res, next) : next()));
  // specs/plugins-phase-4-registry.md rule 7 — the registry is public, read by the instances.
  app.use('/registry/v1', registryPublicRoutes(ctx));
  // The raw bytes are kept for the Qonto webhook's signature (rule 32).
  app.use(express.json({ limit: '200kb', verify: (req, _res, buf) => { req.rawBody = buf; } }));
  app.use(session({
    name: 'gfcp.sid',
    secret: sessionSecret,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    // `lax`, not `strict`: Qonto's OAuth consent comes back with a top-level GET from qonto.com, which
    // must carry the session holding the OAuth state (rule 32). Cross-site POSTs stay cookie-less.
    cookie: { httpOnly: true, sameSite: 'lax', secure: secureCookies, maxAge: 12 * 60 * 60 * 1000 },
  }));

  app.use('/api/auth', authRoutes(ctx));
  app.post(QONTO_WEBHOOK, qontoWebhook(ctx));
  app.use('/api/registry', requireOperator({ now: ctx.now }), registryRoutes(ctx));
  app.use('/api', requireOperator({ now: ctx.now }), consoleRoutes(ctx), fleetRoutes(ctx));
  app.use('/api/payments', paymentsRoutes(ctx));
  app.use('/exports', exportRoutes(ctx));

  if (clientDist && fs.existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get(/^\/(?!api|exports|registry\/v1).*/, (req, res) => res.sendFile(path.join(clientDist, 'index.html')));
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.status && err.body) return res.status(err.status).json(err.body);
    console.error('[console]', err);
    return res.status(500).json({ error: 'INTERNAL', message: 'Erreur interne de la console.' });
  });
  return app;
}

module.exports = { createApp };
