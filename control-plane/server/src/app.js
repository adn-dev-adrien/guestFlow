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
const { exportRoutes } = require('./routes/exports');
const { requireOperator } = require('./middleware/requireOperator');

function createApp(ctx, { sessionSecret, sessionStore, secureCookies = false, clientDist } = {}) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(express.json({ limit: '200kb' }));
  app.use(session({
    name: 'gfcp.sid',
    secret: sessionSecret,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'strict', secure: secureCookies, maxAge: 12 * 60 * 60 * 1000 },
  }));

  app.use('/api/auth', authRoutes(ctx));
  app.use('/api', requireOperator({ now: ctx.now }), consoleRoutes(ctx));
  app.use('/exports', exportRoutes(ctx));

  if (clientDist && fs.existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get(/^\/(?!api|exports).*/, (req, res) => res.sendFile(path.join(clientDist, 'index.html')));
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
