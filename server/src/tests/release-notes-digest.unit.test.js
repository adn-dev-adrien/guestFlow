const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { parseReleaseNotes, splitSummary } = require('../utils/releaseClient');

// specs/self-update-and-releases.md §6.2 rule 20c — a release carries a short operator digest, and
// that block alone is what the update dialog shows. Everything else is published but folded.

const WITH_DIGEST = [
  '### Summary',
  '- Les emails clients attendent votre validation.',
  "- L'assurance annulation se facture à la nuit.",
  '',
  '### Added',
  '- **Un réglage** décide si GuestFlow écrit aux clients tout seul, et il est désactivé',
  '  par défaut.',
  '',
  '### Fixed',
  '- La taxe de séjour se base sur le seul hébergement.',
].join('\n');

const WITHOUT_DIGEST = [
  '### Added',
  '- Une nouveauté.',
  '',
  '### Fixed',
  '- Une correction.',
].join('\n');

test('a known heading carries its canonical key; an unknown one carries none', () => {
  const sections = parseReleaseNotes(WITH_DIGEST);
  assert.deepEqual(sections.map((s) => s.key), ['summary', 'added', 'fixed']);
  assert.deepEqual(sections.map((s) => s.title), ['En bref', 'Ajouts', 'Corrections']);

  const [odd] = parseReleaseNotes('### Notes de bas de page\n- Une ligne.');
  assert.equal(odd.key, null, 'an unrecognised heading must not be mistaken for a known section');
});

test('splitSummary hands the digest to the dialog and keeps the rest folded', () => {
  const { summary, details } = splitSummary(parseReleaseNotes(WITH_DIGEST));

  assert.deepEqual(summary, [
    'Les emails clients attendent votre validation.',
    "L'assurance annulation se facture à la nuit.",
  ]);
  assert.deepEqual(details.map((s) => s.key), ['added', 'fixed']);
  assert.equal(
    details[0].items[0],
    'Un réglage décide si GuestFlow écrit aux clients tout seul, et il est désactivé par défaut.',
    'a wrapped bullet is re-joined and its markdown stripped',
  );
});

test('a release published before the convention falls back to showing everything', () => {
  const { summary, details } = splitSummary(parseReleaseNotes(WITHOUT_DIGEST));
  assert.deepEqual(summary, []);
  assert.deepEqual(details.map((s) => s.key), ['added', 'fixed']);
});

test('splitSummary survives the empty and malformed states the state file can hold', () => {
  for (const input of [null, undefined, [], 'nonsense']) {
    const { summary, details } = splitSummary(input);
    assert.deepEqual(summary, []);
    assert.deepEqual(details, []);
  }
});

// The release workflow gates on `--check-digest`, which is this same function. A rule that lives in
// two places is a rule that will disagree with itself, so the YAML calls the script and the script
// is tested here.
const SCRIPT = path.join(__dirname, '..', '..', '..', 'scripts', 'build-changelog.mjs');

test('checkDigest refuses what the operator could not read', async () => {
  const { checkDigest } = await import(SCRIPT);

  assert.equal(checkDigest(`\n${WITH_DIGEST}`).ok, true);
  assert.deepEqual(checkDigest(`\n${WITH_DIGEST}`).bullets.length, 2);

  const missing = checkDigest(`\n${WITHOUT_DIGEST}`);
  assert.equal(missing.ok, false);
  assert.match(missing.errors[0], /no "### Summary" block/);

  const todo = checkDigest('### Summary\n- TODO — write the operator digest: 1 to 6 short lines.\n');
  assert.equal(todo.ok, false);
  assert.match(todo.errors[0], /TODO line is still there/);

  const empty = checkDigest('### Summary\n\n### Added\n- Quelque chose.');
  assert.equal(empty.ok, false);
  assert.match(empty.errors[0], /empty/);

  const tooMany = checkDigest(['### Summary', ...Array.from({ length: 7 }, (_, i) => `- Ligne ${i}.`)].join('\n'));
  assert.equal(tooMany.ok, false);
  assert.match(tooMany.errors[0], /7 lines, at most 6/);

  const tooLong = checkDigest(`### Summary\n- ${'a'.repeat(161)}`);
  assert.equal(tooLong.ok, false);
  assert.match(tooLong.errors[0], /161 characters, at most 160/);
});

test('sectionFor cuts exactly one version out of a CHANGELOG', async () => {
  const { sectionFor } = await import(SCRIPT);
  const changelog = [
    '# Changelog', '', '## [Unreleased]', '',
    '## [2.3.0] - 2026-09-01', '', '### Summary', '- La nouveauté.', '',
    '## [2.2.0] - 2026-08-20', '', '### Added', '- L\'ancienne.', '',
  ].join('\n');

  assert.match(sectionFor(changelog, '2.3.0'), /La nouveauté/);
  assert.doesNotMatch(sectionFor(changelog, '2.3.0'), /ancienne/, 'the next version must not bleed in');
  assert.match(sectionFor(changelog, '2.2.0'), /ancienne/, 'the last section runs to the end of the file');
  assert.equal(sectionFor(changelog, '9.9.9'), null);
});
