// specs/backup-restore.md rule 14 — shell scripts must survive macOS /bin/bash 3.2 under a UTF-8
// locale. That bash reads the bytes of a non-ASCII character glued to `$VAR` as part of the
// variable name, so `"$STAMP…"` aborts under `set -u` with « STAMP�: unbound variable ».
// restore-to-pi.sh did exactly that right after `pm2 stop guestflow`, leaving production stopped.
// The fix is always the braced form `${STAMP}…`.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const SKIPPED_DIRS = new Set(['node_modules', '.git', 'build', 'dist', 'coverage']);
const UNBRACED_VAR_BEFORE_NON_ASCII = /\$[A-Za-z_][A-Za-z0-9_]*[^\x00-\x7F]/;

function listShellScripts(dir, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name)) listShellScripts(path.join(dir, entry.name), found);
    } else if (entry.isFile() && entry.name.endsWith('.sh')) {
      found.push(path.join(dir, entry.name));
    }
  }
  return found;
}

function offendingLines(source) {
  return source
    .split('\n')
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(({ line }) => UNBRACED_VAR_BEFORE_NON_ASCII.test(line));
}

test('the pattern catches the line that stopped production', () => {
  assert.equal(offendingLines('echo "  · archiving current data as *.pre-restore-$STAMP…"').length, 1);
  assert.equal(offendingLines('echo "  · archiving current data as *.pre-restore-${STAMP}…"').length, 0);
  assert.equal(offendingLines('echo "▶ GuestFlow backup — $SSH_HOST → $DEST"').length, 0);
});

test('no shell script glues a non-ASCII character to an unbraced variable', () => {
  const scripts = listShellScripts(REPO_ROOT);
  assert.ok(scripts.some((file) => file.endsWith(path.join('scripts', 'restore-to-pi.sh'))));

  const offenders = scripts.flatMap((file) =>
    offendingLines(fs.readFileSync(file, 'utf8')).map(
      ({ line, number }) => `${path.relative(REPO_ROOT, file)}:${number}: ${line.trim()}`,
    ),
  );
  assert.deepEqual(offenders, [], 'use ${VAR} before a non-ASCII character (bash 3.2 + UTF-8)');
});
