// specs/settings-one-save-and-automatic-webhook.md rule 17 (audit R26 E26-1, 2026-11-06) — every message the tree ships that
// sends the operator to the public address names the page that holds it, « (Paramètres → Système) »: never « Paramètres ›
// Société » nor « Réglages → Système », pages GuestFlow does not have. A scan of the server and client sources, tests excluded.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const SOURCES = [path.join(ROOT, 'server', 'src'), path.join(ROOT, 'client', 'src')];
const SKIP = new Set(['node_modules', 'tests', '__tests__', 'build', 'dist']);
const SYSTEM_PAGE = '(Paramètres → Système)';
const ADVICE = /(URL publique|adresse publique)/i;
const QUOTED = /(['"`]).*?(URL publique|adresse publique).*?\1/i;
const PAGE = /\((?:Paramètres|Réglages)[^)]*\)/g;

/** The wrong page references of one source line, or [] when it names none or only the right one. */
function wrongPages(line) {
  if (!ADVICE.test(line) || !QUOTED.test(line)) return [];
  return (line.match(PAGE) || []).filter((ref) => ref !== SYSTEM_PAGE);
}

function* sourceFiles(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* sourceFiles(full);
    else if (/\.(c?js|jsx|mjs)$/.test(entry.name)) yield full;
  }
}

test('the two messages the audit found would be caught', () => {
  assert.deepEqual(wrongPages("error: 'URL publique de GuestFlow non renseignée (Paramètres › Société).'"), ['(Paramètres › Société)']);
  assert.deepEqual(wrongPages(`? "Adresse déduite de ce navigateur : l'URL publique n'est pas renseignée (Réglages → Système)."`), ['(Réglages → Système)']);
  assert.deepEqual(wrongPages("action: 'URL publique à renseigner (Paramètres → Système), puis « Test ».'"), []);
  assert.deepEqual(wrongPages('// BASE_URL reste prioritaire si l’URL publique differe (Réglages).'), []);
});

test('every public-address message of the tree names « (Paramètres → Système) »', () => {
  const found = [];
  for (const dir of SOURCES) {
    if (!fs.existsSync(dir)) continue;
    for (const file of sourceFiles(dir)) {
      fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        for (const ref of wrongPages(line)) found.push(`${path.relative(ROOT, file)}:${i + 1} ${ref}`);
      });
    }
  }
  assert.deepEqual(found, []);
});
