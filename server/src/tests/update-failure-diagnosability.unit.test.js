/**
 * What an update tells the operator when it fails EARLY — before the helper, before the restart,
 * before any log the helper would have written.
 *
 * On 2026-08-28 a 2.6.0 install died three times on a 648 MB VM with no swap: `npm ci` was taken by
 * the OOM killer, and the operator was shown « Command failed » with a pointer to a log file that
 * had never been created. Diagnosing it took a dmesg read. These tests pin the three defects that
 * made that possible.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { stagingErrorMessage, isKnownStagingCode, REQUIRED_FREE_MEMORY_BYTES } = require('../controllers/systemController').__test;
const { availableMemoryBytes } = require('../utils/deploymentPaths');

test('a declared staging code keeps its own message, and its detail is not shown raw', () => {
  // ARCHIVE_ABSOLUTE_MEMBER:<name> — the prefix is the code, the suffix is internal detail.
  assert.equal(isKnownStagingCode('ARCHIVE_ABSOLUTE_MEMBER'), true);
  assert.equal(
    stagingErrorMessage('ARCHIVE_ABSOLUTE_MEMBER', 'ARCHIVE_ABSOLUTE_MEMBER:/etc/passwd'),
    "L'archive contient un chemin absolu : mise à jour refusée.",
  );
});

test('an UNDECLARED failure carries its cause into the message instead of losing it', () => {
  // The regression: `Command failed: npm ci …` was split on the colon, the code became
  // « Command failed », and everything after it — the only useful part — was dropped.
  const raw = 'Command failed: npm ci --omit=dev\nnpm error signal SIGKILL';
  assert.equal(isKnownStagingCode('Command failed'), false);
  const message = stagingErrorMessage('STAGING_FAILED', raw);
  assert.match(message, /npm ci --omit=dev/);
  assert.doesNotMatch(message, /Voir le journal/);
});

test('with no detail at all the operator still gets a sentence, not an empty string', () => {
  assert.equal(
    stagingErrorMessage('STAGING_FAILED', ''),
    "L'installation de la nouvelle version a échoué. Voir le journal de mise à jour.",
  );
});

test('the message is capped and single-line, so a stack trace cannot flood the dialog', () => {
  const message = stagingErrorMessage('STAGING_FAILED', `${'x'.repeat(5000)}\nsecond line`);
  assert.ok(message.length < 400, `message trop long : ${message.length}`);
  assert.doesNotMatch(message, /second line/);
});

test('available memory counts MemAvailable PLUS SwapFree, not os.freemem()', () => {
  // The two readings that mattered on the day: before the swapfile, and after it.
  const broken = 'MemTotal:         663552 kB\nMemAvailable:     274432 kB\nSwapFree:              0 kB\n';
  const fixed = 'MemTotal:         663552 kB\nMemAvailable:     470016 kB\nSwapFree:        1887436 kB\n';
  assert.equal(availableMemoryBytes(() => broken), 274432 * 1024);
  assert.equal(availableMemoryBytes(() => fixed), (470016 + 1887436) * 1024);
});

test('the pre-flight would have refused the failing host and admits the fixed one', () => {
  const broken = 'MemTotal:         663552 kB\nMemAvailable:     274432 kB\nSwapFree:              0 kB\n';
  const fixed = 'MemTotal:         663552 kB\nMemAvailable:     470016 kB\nSwapFree:        1887436 kB\n';
  assert.ok(availableMemoryBytes(() => broken) < REQUIRED_FREE_MEMORY_BYTES, 'la VM en panne devait être refusée');
  assert.ok(availableMemoryBytes(() => fixed) >= REQUIRED_FREE_MEMORY_BYTES, 'la VM corrigée doit passer');
});

test('an unreadable /proc/meminfo skips the check rather than blocking every update', () => {
  assert.equal(availableMemoryBytes(() => { throw new Error('ENOENT'); }), null);
  // No MemAvailable line (an ancient kernel) is also a skip, never a zero.
  assert.equal(availableMemoryBytes(() => 'MemTotal: 663552 kB\n'), null);
});

test('the update log is written by the controller, so it exists before staging can fail', () => {
  // The header is written with `fs`, which the controller did NOT import until this fix — the calls
  // threw ReferenceError inside their own try/catch and wrote nothing at all.
  const source = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'systemController.js'), 'utf8');
  assert.match(source, /^const fs = require\('fs'\);$/m, 'systemController doit importer fs');
  assert.match(source, /openUpdateLog\(logFile, \{/, 'le journal doit être ouvert dans le contrôleur');
  const opened = source.indexOf('openUpdateLog(logFile');
  const staged = source.indexOf('await stageRelease(');
  assert.ok(opened !== -1 && staged !== -1 && opened < staged, 'le journal doit être ouvert AVANT le staging');
});
