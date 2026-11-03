// specs/plugins-phase-1-sdk.md rule 34 — the unread counters are internal settings (refused by the PUT, hidden from the GET).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const semver = require('semver');

test('rule 34: lastRunAt, unreadMails and unreadStreak are declared internal and the plugin asks for SDK 2.17 at least', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
  for (const key of ['lastRunAt', 'unreadMails', 'unreadStreak']) assert.match(src, new RegExp(`key: '${key}', internal: true`));
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8'));
  assert.ok(semver.gte(semver.minVersion(manifest.sdk), '2.17.0'), manifest.sdk);
});
