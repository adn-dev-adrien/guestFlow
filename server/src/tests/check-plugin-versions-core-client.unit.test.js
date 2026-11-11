// specs/plugins-phase-4-registry.md rule 28, reading of 2026-11-10 (audit R36-CON-L1) — a core client file a plugin's
// web app builds in (the studio's `@guestflow/…` imports and what they import) counts as a change of that plugin: its
// package carries the build, so a core change reaching it under an unchanged version was only seen by the release's
// `package` job, after the tag. The PR gate now asks for the bump; the release skill's pre-flight builds the apps first.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const { skipWithout } = require('../plugins/sdk/testing');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const load = () => import(pathToFileURL(path.join(ROOT, 'scripts', 'check-plugin-versions.mjs')).href);

test('rule 28 reading: the studio’s core components, and what they import, are guest-app’s; other core files are not', { skip: skipWithout(['guest-app']) }, async () => {
  const { coreClientClosure } = await load();
  const closure = coreClientClosure();
  const files = closure['guest-app'];
  ['client/src/components/StatusBadge.jsx', 'client/src/components/PageActionBar.jsx', 'client/src/theme.js'].forEach((file) => assert.ok(files.has(file), file));
  const transitive = [...files].filter((file) => !/^client\/src\/(components\/(StatusBadge|PageActionBar|ErrorAlert|LoadingState|EmptyState|ConfirmDialog|FormDialog)\.jsx|theme\.js)$/.test(file));
  assert.ok(transitive.length > 0, 'the imports of those files are followed');
  assert.equal(files.has('client/src/pages/ReservationPage.jsx'), false);
});

test('rule 28 reading: a change to such a file asks for that plugin’s bump; a test or an unrelated file does not', async () => {
  const { pluginsOf } = await load();
  const coreClient = { 'demo-app': new Set(['client/src/components/StatusBadge.jsx', 'client/src/theme.js']) };
  assert.deepEqual([...pluginsOf(['client/src/components/StatusBadge.jsx'], { coreClient })], ['demo-app']);
  assert.deepEqual([...pluginsOf(['client/src/pages/ReservationPage.jsx', 'client/src/components/__tests__/StatusBadge.test.jsx'], { coreClient })], []);
  assert.deepEqual([...pluginsOf(['server/src/plugins/demo-other/index.js', 'client/src/theme.js'], { coreClient })].sort(), ['demo-app', 'demo-other']);
});

test('rule 28 reading: the release skill builds the plugins’ web apps before it judges their packages', () => {
  const skill = fs.readFileSync(path.join(ROOT, '.claude', 'skills', 'guestflow-release', 'SKILL.md'), 'utf8');
  const build = skill.indexOf('for app in server/src/plugins/*/apps/*/; do');
  const pack = skill.indexOf('node scripts/build-plugin-packages.mjs');
  assert.ok(build > 0 && build < pack, 'the apps are built before the packages');
});
