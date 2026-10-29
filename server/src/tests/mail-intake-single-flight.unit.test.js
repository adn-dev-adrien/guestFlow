// specs/gites-de-france-mail-intake.md rule 31(c), specs/airbnb-mail-intake.md rule 31(c) (re-review of PR #865) —
// the job tick and « Lire maintenant » share one pass although each call builds its own service: a single IMAP
// read, and the second caller reports what the first one did.
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const registry = require('../plugins/sdk/registry');
const settingsModel = require('../models/settingsModel');
const mailboxReader = require('../plugins/sdk/mailboxReader');
const { createContext } = require('../plugins/sdk/createContext');
const { applyPluginSchema } = require('../plugins/sdk/testing');

const SETTINGS = { 'gites-de-france-intake': { giteNumbers: '{"1":"309700"}' }, 'airbnb-intake': { listings: '{"1":"1234567890123456789"}' } };

for (const id of Object.keys(SETTINGS)) {
  test(`rule 31(c): ${id} — the job and the route share one pass`, async () => {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE ical_sources (propertyId INTEGER, url TEXT, isActive INTEGER, disabled INTEGER)');
    applyPluginSchema(db, id);
    const originalSmtp = settingsModel.decryptedSmtpSettings;
    const originalRead = mailboxReader.readMailsFrom;
    let reads = 0;
    settingsModel.decryptedSmtpSettings = () => ({ host: 'smtp.example.com', user: 'u', password: 'p' });
    mailboxReader.readMailsFrom = async () => { reads += 1; await new Promise((resolve) => { setImmediate(resolve); }); return []; };
    try {
      const settings = { get: (pluginId, key) => (SETTINGS[id][key] !== undefined ? SETTINGS[id][key] : ''), set() {}, raw: () => '' };
      require(`../plugins/${id}`).register(createContext(id, { db, settingsModel: () => settings }));
      const record = registry.get(id);
      const job = record.jobs[0];
      const router = record.mounts.find((m) => !m.public).router;
      const handler = router.stack.find((l) => l.route && l.route.path === '/run' && l.route.methods.post).route.stack[0].handle;
      const click = new Promise((resolve) => { handler({}, { json: resolve, status: () => ({ json: resolve }) }); });
      const [fromClick] = await Promise.all([click, job.run()]);
      assert.equal(reads, 1, `one IMAP pass ${JSON.stringify(fromClick)}`);
      assert.ok(!('error' in fromClick));
    } finally {
      settingsModel.decryptedSmtpSettings = originalSmtp;
      mailboxReader.readMailsFrom = originalRead;
      registry.discard(id);
    }
  });
}
