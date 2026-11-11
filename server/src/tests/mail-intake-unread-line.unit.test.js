// specs/gites-de-france-mail-intake.md rule 32(b), specs/airbnb-mail-intake.md rule 32(b) (review of PR #868) — the
// home line « Mails … non lus : N (afflux). » appears once two passes in a row hit the cap (a first read of a
// backlog or a re-read after a parser update is no flood), and clears with a pass that is not capped, skipped, or
// that throws.
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const registry = require('../plugins/sdk/registry');
const settingsModel = require('../models/settingsModel');
const mailboxReader = require('../plugins/sdk/mailboxReader');
const { createContext } = require('../plugins/sdk/createContext');
const { applyPluginSchema, skipWithout } = require('../plugins/sdk/testing');

const SETTINGS = { 'gites-de-france-intake': { giteNumbers: '{"1":"309700"}' }, 'airbnb-intake': { listings: '{"1":"1234567890123456789"}' } };

for (const id of Object.keys(SETTINGS)) {
  test(`rule 32(b): ${id} — the line needs two capped passes in a row and clears otherwise`, { skip: skipWithout([id]) }, async () => {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE ical_sources (propertyId INTEGER, url TEXT, isActive INTEGER, disabled INTEGER)');
    applyPluginSchema(db, id);
    const originalSmtp = settingsModel.decryptedSmtpSettings;
    const originalRead = mailboxReader.readMailsFrom;
    let next = null;
    settingsModel.decryptedSmtpSettings = () => ({ host: 'smtp.example.com', user: 'u', password: 'p' });
    mailboxReader.readMailsFrom = async (args) => {
      if (next === 'throw') throw new Error('imap down');
      if (next === 'capped') args.onCap({ notRead: 340, limit: 200 });
      return [];
    };
    try {
      const store = { ...SETTINGS[id] };
      const settings = { get: (pluginId, key) => (store[key] !== undefined ? store[key] : ''), set: (pluginId, key, value) => { store[key] = value; }, raw: () => '' };
      require(`../plugins/${id}`).register(createContext(id, { db, settingsModel: () => settings }));
      const router = registry.get(id).mounts.find((m) => !m.public).router;
      const route = (path, method) => router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]).route.stack[0].handle;
      const run = (mode) => new Promise((resolve) => {
        next = mode;
        route('/run', 'post')({}, { json: resolve, status: () => ({ json: resolve }) });
      });
      const unread = () => new Promise((resolve) => { route('/', 'get')({}, { json: (body) => resolve(body.unread) }); });
      await run('capped');
      assert.equal(await unread(), 0, 'first capped pass: no line');
      await run('capped');
      assert.equal(await unread(), 340, 'second capped pass in a row: the line');
      await run('clear');
      assert.equal(await unread(), 0, 'an uncapped pass clears it');
      await run('capped');
      await run('capped');
      assert.equal(await unread(), 340);
      await run('throw');
      assert.equal(await unread(), 0, 'a pass that throws clears it');
      await run('capped');
      assert.equal(await unread(), 0, 'and the streak starts again');
      store[Object.keys(SETTINGS[id])[0]] = '{}';
      await run('capped');
      await run('capped');
      assert.equal(await unread(), 0, 'a skipped pass never shows it');
    } finally {
      settingsModel.decryptedSmtpSettings = originalSmtp;
      mailboxReader.readMailsFrom = originalRead;
      registry.discard(id);
    }
  });
}
