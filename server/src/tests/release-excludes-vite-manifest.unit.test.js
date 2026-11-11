const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// specs/inte-performance.md rule 19 — the Vite manifest the bundle budget reads is a build artefact of
// CI; the release archive (what production serves) must not carry it.

const RELEASE = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'release.sh'), 'utf8');

test('rule 19: release.sh copies client/dist without its .vite folder', () => {
  const copy = RELEASE.split('\n').find((line) => line.includes('client/dist/') && line.includes('rsync'));
  assert.ok(copy, 'the rsync of client/dist is found');
  assert.match(copy, /--exclude '\.vite'/);
});
