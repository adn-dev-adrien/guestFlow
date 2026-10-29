/**
 * specs/ui-review-2026-10-19-operations.md rule 36 — the operator's confirmations, alerts and
 * tooltips are short and impersonal: no « Veuillez », « Voulez-vous » or « Êtes-vous » in the client.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..');
// `\b` does not see « Ê » as a word character, so the boundaries are spelled with Unicode letters.
const FORBIDDEN = /(^|[^\p{L}])(Veuillez|Voulez-vous|Êtes-vous)(?![\p{L}])/u;
// Text a guest reads is not operator text (rule 36).
const GUEST_FACING = ['plugins/gate-access/SasGateAccessStep.jsx'];

function sources(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sources(full);
    return /\.(jsx?|mjs)$/.test(entry.name) && !/\.test\./.test(entry.name) ? [full] : [];
  });
}

test('rule 36 — the guard matches the three phrases, accents included', () => {
  ['Êtes-vous sûr ?', 'Voulez-vous continuer ?', 'Veuillez saisir.', '« Veuillez »'].forEach((text) => expect(text).toMatch(FORBIDDEN));
  ['Veuillezz', 'Pouvez-vous', 'Voulez-vousx'].forEach((text) => expect(text).not.toMatch(FORBIDDEN));
});

test('rule 36 — no formal address in the operator-facing sources', () => {
  const offenders = sources(ROOT)
    .filter((file) => !GUEST_FACING.includes(path.relative(ROOT, file).split(path.sep).join('/')))
    .filter((file) => FORBIDDEN.test(fs.readFileSync(file, 'utf8')));
  expect(offenders.map((f) => path.relative(ROOT, f))).toEqual([]);
});
