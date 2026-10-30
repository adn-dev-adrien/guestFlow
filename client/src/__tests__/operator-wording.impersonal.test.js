/**
 * specs/ui-review-2026-10-19-operations.md rule 36 — the operator's confirmations, alerts and
 * tooltips are short and impersonal: no « Veuillez », « Voulez-vous » or « Êtes-vous » in the client,
 * and no imperative of the 2nd person singular (« Enregistre », « clique », « vérifie »…) either.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..');
// `\b` does not see « Ê » as a word character, so the boundaries are spelled with Unicode letters.
const FORBIDDEN = /(^|[^\p{L}])(Veuillez|Voulez-vous|Êtes-vous)(?![\p{L}])/u;
// Imperatives of the 2nd person singular that a button, an alert or a helper text must not use. Only
// verbs whose singular form differs from a noun or an infinitive are listed (no « Entre », « Reste »).
const TU_VERBS = [
  'Enregistre', 'Clique', 'Réessaie', 'Vérifie', 'Sélectionne', 'Saisis', 'Choisis', 'Ajoute', 'Supprime', 'Ouvre',
  'Renseigne', 'Indique', 'Attends', 'Essaie', 'Regarde', 'Coche', 'Décoche', 'Utilise', 'Relance', 'Corrige',
  'Complète', 'Confirme', 'Appuie', 'Précise', 'Reviens', 'Consulte', 'Contacte', 'Rafraîchis', 'Recharge',
  'Regroupe', 'Envoie', 'Retire', 'Désactive', 'Télécharge',
];
// At the start of a sentence, or after a dash or an opening guillemet / « — ».
const TU_FORBIDDEN = new RegExp(`(?:^|[.!?:—–»]\\s+|—\\s*)(?:${TU_VERBS.join('|')})(?![\\p{L}])`, 'iu');
const TU_INLINE = new RegExp(`(?:^|\\s)(?:clique|vérifie|sélectionne|réessaie|corrige|enregistre|saisis|choisis|renseigne|attends|coche)(?![\\p{L}])\\s+[«l'd]`, 'u');
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

test('rule 38 — the guard matches 2nd-person-singular imperatives', () => {
  ['Enregistre d’abord', 'Réessaie après', 'Sélectionne les clients', 'Regroupe l’option', 'Aucun compte — vérifie la connexion'].forEach((text) => expect(text).toMatch(TU_FORBIDDEN));
  ['Une fois payé, clique « Vérifier »', 'corrige les champs'].forEach((text) => expect(text).toMatch(TU_INLINE));
  ['Enregistrement', 'Devis à enregistrer', 'Connexion à vérifier', 'Option regroupée', 'Valider', 'Enregistrée', 'Valide jusqu’au 3 mars'].forEach((text) => { expect(text).not.toMatch(TU_FORBIDDEN); expect(text).not.toMatch(TU_INLINE); });
});

const COMMENTS = /\/\*[\s\S]*?\*\/|(^|[^:'"`])\/\/[^\n]*/g;

test('rule 38 — no 2nd-person-singular imperative in the operator-facing string literals', () => {
  const literal = /(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g;
  const offenders = sources(ROOT)
    .filter((file) => !GUEST_FACING.includes(path.relative(ROOT, file).split(path.sep).join('/')))
    .filter((file) => [...fs.readFileSync(file, 'utf8').replace(COMMENTS, '').matchAll(literal)].some((m) => /\s/.test(m[2]) && (TU_FORBIDDEN.test(m[2]) || TU_INLINE.test(m[2]))));
  expect(offenders.map((f) => path.relative(ROOT, f))).toEqual([]);
});
