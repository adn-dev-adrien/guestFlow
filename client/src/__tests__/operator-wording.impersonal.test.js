/**
 * specs/ui-review-2026-10-19-operations.md rule 36 — the operator's confirmations, alerts and
 * tooltips are short and impersonal: no « Veuillez », « Voulez-vous » or « Êtes-vous » in the client.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..');
const FORBIDDEN = /\b(Veuillez|Voulez-vous|Êtes-vous)\b/;

function sources(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sources(full);
    return /\.(jsx?|mjs)$/.test(entry.name) && !/\.test\./.test(entry.name) ? [full] : [];
  });
}

test('rule 36 — no formal address in the operator-facing sources', () => {
  const offenders = sources(ROOT).filter((file) => FORBIDDEN.test(fs.readFileSync(file, 'utf8')));
  expect(offenders.map((f) => path.relative(ROOT, f))).toEqual([]);
});
