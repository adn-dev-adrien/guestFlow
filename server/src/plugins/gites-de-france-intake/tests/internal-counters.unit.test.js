// specs/gites-de-france-mail-intake.md rule 33 — the unread counters are internal settings, and the reader keeps
// small records (tests/mail-reader-envelope-retention.unit.test.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('rule 33: lastRunAt, unreadMails and unreadStreak are declared internal and the plugin asks for SDK 2.17', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
  for (const key of ['lastRunAt', 'unreadMails', 'unreadStreak']) assert.match(src, new RegExp(`key: '${key}', internal: true`));
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8'));
  assert.equal(manifest.sdk, '^2.17.0');
});
