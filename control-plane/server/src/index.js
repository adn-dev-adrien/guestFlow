/**
 * The GuestFlow control plane — the operator console (specs/control-plane-plans-and-access.md).
 *
 * Environment:
 *   CP_DATA_DIR              its database, the secrets key and the exports (default ./data)
 *   CP_INSTANCES_ROOT        the instances' directories, <root>/<slug>/data (required)
 *   CP_LICENCE_PRIVATE_KEY   Ed25519 private key, base64 DER PKCS8 (required; rule 30)
 *   CP_DOMAIN                customers live at <slug>.<CP_DOMAIN> (default guestflow.fr)
 *   CP_PUBLIC_URL            the console's own address, for the export links and Qonto's return
 *   CP_APP_HOST              the shared login page's host (default app.<CP_DOMAIN>; rule 24)
 *   CP_SESSION_SECRET        required in production
 *   CP_SMTP_HOST/PORT/USER/PASS/FROM
 *   CP_PORT                  default 4100
 */

const path = require('path');
const session = require('express-session');
const SqliteStore = require('better-sqlite3-session-store')(session);
const { openDatabase } = require('./database');
const { createContext } = require('./context');
const { createApp } = require('./app');
const { createScheduler } = require('./tasks/scheduler');
const { createMailer } = require('./utils/mailer');
const { loadOrCreateKey, createSecrets } = require('./utils/secrets');
const { loadPrivateKey } = require('./utils/licenceIssuer');
const { createFirstAdminRunner } = require('./utils/firstAdmin');
const clock = require('./utils/clock');

const env = process.env;
const production = env.NODE_ENV === 'production';

function required(name) {
  if (!env[name]) {
    console.error(`[console] ${name} is required`);
    process.exit(1);
  }
  return env[name];
}

const dataDir = path.resolve(env.CP_DATA_DIR || path.join(__dirname, '..', 'data'));
const instancesRoot = path.resolve(required('CP_INSTANCES_ROOT'));
const privateKey = loadPrivateKey(required('CP_LICENCE_PRIVATE_KEY'));
const sessionSecret = production ? required('CP_SESSION_SECRET') : (env.CP_SESSION_SECRET || 'dev-only-console-secret');

const db = openDatabase(path.join(dataDir, 'control-plane.db'));
const ctx = createContext({
  db,
  now: () => clock.now(env),
  mailer: createMailer(env),
  secrets: createSecrets(loadOrCreateKey(dataDir)),
  directoryKey: loadOrCreateKey(dataDir, '.directory-key'),
  privateKey,
  instancesRoot,
  dataDir,
  domain: env.CP_DOMAIN || 'guestflow.fr',
  consoleUrl: env.CP_PUBLIC_URL,
  runFirstAdmin: createFirstAdminRunner(),
});

const app = createApp(ctx, {
  sessionSecret,
  sessionStore: new SqliteStore({ client: db, expired: { clear: true, intervalMs: 15 * 60 * 1000 } }),
  secureCookies: production,
  clientDist: path.join(__dirname, '..', '..', 'client', 'dist'),
  appHost: env.CP_APP_HOST || `app.${env.CP_DOMAIN || 'guestflow.fr'}`,
});

createScheduler(ctx).start();

const port = Number(env.CP_PORT || 4100);
app.listen(port, () => console.log(`[console] listening on :${port} — instances in ${instancesRoot}`));
