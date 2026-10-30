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
// Imperatives of the 2nd person singular that a button, an alert or a helper text must not use.
// Unambiguous: no noun, adjective or 3rd-person homograph that opens a sentence, so any follower counts.
const TU_VERBS = [
  'Enregistre', 'Clique', 'Réessaie', 'Vérifie', 'Sélectionne', 'Saisis', 'Choisis', 'Ajoute', 'Supprime', 'Ouvre',
  'Renseigne', 'Indique', 'Attends', 'Essaie', 'Regarde', 'Coche', 'Décoche', 'Utilise', 'Relance', 'Corrige',
  'Complète', 'Confirme', 'Appuie', 'Précise', 'Reviens', 'Consulte', 'Contacte', 'Rafraîchis', 'Recharge',
  'Regroupe', 'Envoie', 'Retire', 'Désactive', 'Télécharge', 'Remplis', 'Mets', 'Fais', 'Patiente', 'Reconnecte',
  'Relis', 'Laisse', 'Scanne', 'Glisse', 'Donne', 'Pense', 'Renvoie', 'Vois', 'Réactive', 'Recommence', 'Reprends',
];
// Also a noun, an adjective or a participle (« Copie de la fiche », « Active »): only with an article or a preposition after.
const TU_CAREFUL_VERBS = [
  'Copie', 'Colle', 'Tape', 'Active', 'Configure', 'Modifie', 'Crée', 'Ferme', 'Importe', 'Exporte',
  'Imprime', 'Connecte', 'Garde', 'Ajuste', 'Remplace', 'Déplace', 'Signale',
];
const FOLLOWER = "(?:le|la|les|l['’]|un|une|des|du|d['’]|à|«|sur|ici|ce|cette|ces|ton|ta|tes|aux|au|avant|après|dans|pour|en)(?![\\p{L}])";
// Start of a sentence, after `. ! ? : ; , (` or a dash, or after a closing guillemet.
const BOUNDARY = '(?:^|[.!?:;,(»—–]\\s*|\\s[—–]\\s*)';
const TU_FORBIDDEN = new RegExp(`${BOUNDARY}(?:(?:${TU_VERBS.join('|')})(?![\\p{L}'’])|(?:${TU_CAREFUL_VERBS.join('|')})(?![\\p{L}'’-])\\s+${FOLLOWER})`, 'iu');
const TU_INLINE = new RegExp(`(?:^|[^\\p{L}])(?:clique|vérifie|sélectionne|réessaie|corrige|enregistre|saisis|choisis|renseigne|attends|coche|ajoute|ouvre|utilise|supprime)(?![\\p{L}])\\s+(?:«|[ld]['’]|le|la|les|sur|ici|pour|à|un|une|des)(?![\\p{L}])`, 'u');
const TU_PRONOUN = /(?:^|[^\p{L}])(?:tu|ton|ta|tes|toi)(?![\p{L}])/iu;
const tuForm = (text) => TU_FORBIDDEN.test(text) || TU_INLINE.test(text) || TU_PRONOUN.test(text);
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

const CAUGHT = [
  'Copie le lien dans WordPress.', 'Tape le code reçu.', 'Colle la clé ici.', 'Active le plugin d’abord.', 'Configure le SMTP avant.',
  'Reconnecte Google Calendar.', 'Remplis les champs.', 'Glisse les options.', 'Modifie la fiche.', 'Crée un logement.',
  'Importe le fichier CSV.', 'Ferme la fenêtre.', 'Patiente quelques secondes.', 'Renvoie le mail.', 'Mets à jour.',
  'Fais un essai.', 'Laisse vide pour aucun.', 'Pense à enregistrer.', 'Donne un nom au document.', 'Relis le texte.',
  'Scanne le QR code.', 'Identifiants enregistrés, clique sur « Connexion ».', 'Puis vérifie la connexion.',
  'Une fois payé, ouvre la fiche.', 'Ensuite ajoute un logement.', 'Pour finir, choisis une date.', 'Il faut que tu enregistres.',
  'Ton compte est prêt.', 'Si tu veux, recommence.', '(clique ici)', 'Clés : enregistre-les.', 'Erreur, réessaie plus tard.',
  'Enregistre-le d’abord.', 'Clique « Vérifier »', 'utilise le bouton « Relire ».', 'Enregistre d’abord', 'Aucun compte — vérifie la connexion',
];
const CLEAN = [
  'Enregistrement', 'Devis à enregistrer', 'Connexion à vérifier', 'Option regroupée', 'Valider', 'Enregistrée',
  'Valide jusqu’au 3 mars', 'Identifiants enregistrés. « Connexion » autorise la nouvelle application', 'Copie de la fiche',
  'Option active', 'Active : oui', 'Enregistrement requis avant la demande de paiement.', 'Regroupement dans un menu dépliant (vide : aucun).',
  'Une fois payé : « Vérifier le paiement ».', 'Envoi d’un « Email de test GuestFlow » à l’adresse du compte connecté.', 'Entre 1 et 14 jours.',
  'Reste à payer', 'Mise à jour du tableau', 'Fixe',
];

test('rule 38 — the guard catches the 2nd-person-singular probe sentences and spares the impersonal ones', () => {
  expect(CAUGHT.filter((text) => !tuForm(text))).toEqual([]);
  expect(CLEAN.filter((text) => tuForm(text))).toEqual([]);
});

const COMMENTS = /\/\*[\s\S]*?\*\/|(^|[^:'"`])\/\/[^\n]*/g;

test('rule 38 — no 2nd-person-singular imperative or pronoun in the operator-facing string literals', () => {
  const literal = /(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g;
  const offenders = sources(ROOT)
    .filter((file) => !GUEST_FACING.includes(path.relative(ROOT, file).split(path.sep).join('/')))
    .filter((file) => [...fs.readFileSync(file, 'utf8').replace(COMMENTS, '').matchAll(literal)].some((m) => /\s/.test(m[2]) && tuForm(m[2])));
  expect(offenders.map((f) => path.relative(ROOT, f))).toEqual([]);
});
