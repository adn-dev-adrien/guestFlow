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
 *   NODE_ENV                 `development` or `test` to run without the two secrets below; anything
 *                            else (unset included) runs as production (rule 39)
 *   CP_SESSION_SECRET        required outside development/test
 *   CP_SMTP_HOST/PORT/USER/PASS/FROM
 *   CP_PORT                  default 4100
 *   CP_PROXY_SECRET          the header Caddy adds; without it X-Forwarded-* are ignored (H1 rule 21);
 *                            required outside development/test
 *
 * Hosting (specs/hosting-h1-fleet-runtime.md; deploy/hosting/README.md lists the production values):
 *   CP_RELEASES_DIR          the shared releases, <dir>/<version> (default: <CP_INSTANCES_ROOT>/../releases)
 *   CP_PORT_RANGE            the instances' ports (default 4400-4499)
 *   CP_HEALTH_TIMEOUT_MS     the health check's limit (default 60000)
 *   CP_PROCESS_DRIVER / CP_PROXY_DRIVER / CP_BACKUP_DRIVER / CP_MAIL_DRIVER, and their settings
 *                            (utils/drivers/index.js); all default to the `local` drivers
 *   CP_MAIL_DAILY_LIMIT      emails per instance per day through the platform (default 300)
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
const { readBootConfig } = require('./utils/bootConfig');
const { createFirstAdminRunner } = require('./utils/firstAdmin');
const clock = require('./utils/clock');

const env = process.env;

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
const registryPrivateKey = env.CP_REGISTRY_PRIVATE_KEY ? loadPrivateKey(env.CP_REGISTRY_PRIVATE_KEY) : null;
let boot;
try {
  boot = readBootConfig(env);
} catch (err) {
  console.error(`[console] ${err.message}`);
  process.exit(1);
}

const db = openDatabase(path.join(dataDir, 'control-plane.db'));
const ctx = createContext({
  db,
  now: () => clock.now(env),
  mailer: createMailer(env),
  secrets: createSecrets(loadOrCreateKey(dataDir)),
  directoryKey: loadOrCreateKey(dataDir, '.directory-key'),
  privateKey,
  registryPrivateKey,
  instancesRoot,
  dataDir,
  domain: env.CP_DOMAIN || 'guestflow.fr',
  consoleUrl: env.CP_PUBLIC_URL,
  runFirstAdmin: createFirstAdminRunner(),
  releasesDir: env.CP_RELEASES_DIR ? path.resolve(env.CP_RELEASES_DIR) : undefined,
  hostingEnv: env,
  consoleDbFile: path.join(dataDir, 'control-plane.db'),
});

const app = createApp(ctx, {
  sessionSecret: boot.sessionSecret,
  sessionStore: new SqliteStore({ client: db, expired: { clear: true, intervalMs: 15 * 60 * 1000 } }),
  secureCookies: boot.secureCookies,
  clientDist: path.join(__dirname, '..', '..', 'client', 'dist'),
  appHost: env.CP_APP_HOST || `app.${env.CP_DOMAIN || 'guestflow.fr'}`,
  proxySecret: boot.proxySecret,
});

createScheduler(ctx).start();

const port = Number(env.CP_PORT || 4100);
app.listen(port, () => console.log(`[console] listening on :${port} — instances in ${instancesRoot}`));
