#!/usr/bin/env node
/**
 * The weekly restore check (rule 13), run now against the console's database and drivers — the job
 * the scheduler runs on Sundays. Lab only (deploy/hosting/test/); run from
 * control-plane/server with the console's environment loaded. Prints the results as one JSON line.
 */
const path = require('path');
const base = process.cwd();
const { openDatabase } = require(path.join(base, 'src/database'));
const { createContext } = require(path.join(base, 'src/context'));
const { createMailer } = require(path.join(base, 'src/utils/mailer'));
const { loadOrCreateKey, createSecrets } = require(path.join(base, 'src/utils/secrets'));
const { loadPrivateKey } = require(path.join(base, 'src/utils/licenceIssuer'));

const env = process.env;
const dataDir = path.resolve(env.CP_DATA_DIR);
const ctx = createContext({
  db: openDatabase(path.join(dataDir, 'control-plane.db')),
  now: () => new Date(),
  mailer: createMailer(env),
  secrets: createSecrets(loadOrCreateKey(dataDir)),
  directoryKey: loadOrCreateKey(dataDir, '.directory-key'),
  privateKey: loadPrivateKey(env.CP_LICENCE_PRIVATE_KEY),
  instancesRoot: env.CP_INSTANCES_ROOT,
  dataDir,
  domain: env.CP_DOMAIN,
  releasesDir: env.CP_RELEASES_DIR,
  hostingEnv: env,
  runFirstAdmin: async () => ({ created: false }),
});
ctx.restoreVerifier.weekly().then((r) => {
  console.log(JSON.stringify(r.map((x) => ({ customerId: x.customerId, ok: x.ok, reservations: x.reservations, detail: x.detail }))));
  process.exit(0);
});
