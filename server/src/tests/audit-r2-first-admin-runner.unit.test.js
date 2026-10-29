// specs/control-plane-plans-and-access.md rule 42 (review of PR 859) — a name starting with `-` reaches the strict script.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createFirstAdminRunner } = require('../../../control-plane/server/src/utils/firstAdmin');

test('rule 42: the console runner passes a dash-leading name and company as --opt=value and creates the admin', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-first-admin-runner-'));
  try {
    const run = createFirstAdminRunner({ serverDir: path.join(__dirname, '..', '..') });
    const out = await run({ dbPath: path.join(dir, 'guestflow.db'), email: 'a@b.fr', name: '-Domaine Dupont', company: '-Domaine' });
    assert.equal(out.created, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
