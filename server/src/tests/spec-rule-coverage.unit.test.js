// specs/spec-rule-coverage.md §3 — « une règle de spec sans test est une règle non livrée ».
//
// Ce fichier épingle l'outil qui répond à « quelles règles n'ont aucun test ? ». Il compte double :
// si le parseur se trompe, il produit une couverture FANTÔME — une règle comptée prouvée alors
// qu'elle ne l'est pas — et c'est pire que pas de mesure du tout, parce qu'on cesse de regarder.
//
// Les fonctions testées sont pures et exportées par le script ; la CLI ne fait que des
// entrées-sorties (même forme que build-changelog.mjs).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const SCRIPT = path.join(__dirname, '..', '..', '..', 'scripts', 'check-spec-coverage.mjs');
const load = () => import(SCRIPT);

const SPEC = [
  '# Une spec',
  '',
  '## 1. Context',
  '1. Ceci est une énumération de contexte, pas une règle.',
  '',
  '## 3. Functional rules',
  '',
  '### 3.1 Un groupe',
  '1. **La première règle.** Elle fait quelque chose.',
  '2. **La deuxième.**',
  '2bis. **Ajoutée après coup.**',
  '',
  '### 3.2 Un autre groupe',
  '3. **La troisième.**',
  '4. **Une règle de cadrage**, qui ne prouve rien.',
  '   > **Sans test** — c\'est une décision, pas un comportement.',
  '',
  '**Edge cases :**',
  '- un cas → un comportement',
  '',
  '## 4. Architecture',
  '1. Une ligne numérotée qui n\'est pas une règle.',
  '2. Une autre.',
].join('\n');

// specs/spec-rule-coverage.md §3.1 rule 2 — les listes numérotées des autres sections ne sont pas
// des règles.
test('parseSpecRules ne retient que les règles du §3, sous-sections comprises', async () => {
  const { parseSpecRules } = await load();
  const rules = parseSpecRules(SPEC);
  // Ni le §1 ni le §4 : leurs listes numérotées ne sont pas des règles (règle 2).
  assert.deepEqual(rules.map((r) => r.id), ['1', '2', '2bis', '3', '4']);
});

// specs/spec-rule-coverage.md §3.1 rule 5 — une règle peut être déclarée non testable, mais jamais
// en silence : la déclaration vit dans la spec, sous la règle.
test('parseSpecRules lit l’exemption déclarée sous la règle, et sa raison', async () => {
  const { parseSpecRules } = await load();
  const four = parseSpecRules(SPEC).find((r) => r.id === '4');
  assert.equal(four.exempt, true);
  assert.match(four.reason, /décision/);
  assert.equal(parseSpecRules(SPEC).find((r) => r.id === '1').exempt, false);
});

test('parseSpecRules rend une liste vide quand la spec n’a pas de §3', async () => {
  const { parseSpecRules } = await load();
  assert.deepEqual(parseSpecRules('# Titre\n\n## 1. Context\n1. Rien.\n'), []);
});

// ── Citations ────────────────────────────────────────────────────────────────

// specs/spec-rule-coverage.md §3.1 rules 1 + 4 — la convention existante EST la convention, et ses
// formes réelles (plages, listes, suffixes, français) sont comprises telles quelles.
test('parseCitations comprend les formes réellement écrites dans le dépôt', async () => {
  const { parseCitations } = await load();
  const src = [
    '// specs/ma-spec.md §3.2 rule 10 — ce que fait la règle',
    '// specs/autre.md §4 rules 4-5 — une plage',
    '// specs/troisieme.md §3.E rules 28 + 30b — une liste',
    '// specs/quatrieme.md règle 11bis — en français',
  ].join('\n');
  const got = parseCitations(src).map((c) => `${c.spec}:${c.rule}`);
  assert.deepEqual(got, [
    'ma-spec:10',
    'autre:4', 'autre:5',
    'troisieme:28', 'troisieme:30b',
    'quatrieme:11bis',
  ]);
});

// specs/spec-rule-coverage.md §3.1 rule 3 — une citation est rattachée à la spec nommée près d'elle,
// sinon à celle que le fichier annonce en tête.
test('une citation loin de sa spec retombe sur celle que le fichier annonce en tête', async () => {
  const { parseCitations } = await load();
  // Le cas réel qui a fait échouer la première version : un fichier annonce son sujet en tête, cite
  // une spec secondaire en passant, puis continue de nommer les règles de son sujet.
  const src = [
    '// specs/reservation-refunds.md §3.3 — l’argent rendu sort du total de séjour.',
    'const x = 1;',
    '',
    '// Colonnes ajoutées par une migration (specs/migrations-baseline.md).',
    'const y = 2;',
    '',
    '',
    '',
    "test('rule 18 — un remboursement par virement sort du total', () => {});",
  ].join('\n');
  assert.deepEqual(parseCitations(src), [{ spec: 'reservation-refunds', rule: '18' }]);
});

test('une date n’est pas une règle', async () => {
  const { parseCitations } = await load();
  // « règle 2026-08-31 » ressemble à une plage. Une couverture fantôme est pire que pas de mesure.
  assert.deepEqual(parseCitations('// specs/x.md — règle ajoutée le 2026-08-31'), []);
  assert.deepEqual(parseCitations('// specs/x.md rule 999'), []);
});

test('sans spec nommée, un fichier ne couvre rien', async () => {
  const { parseCitations } = await load();
  assert.deepEqual(parseCitations("test('rule 4 — quelque chose', () => {});"), []);
});

// ── Couverture ───────────────────────────────────────────────────────────────

async function coverage(citations) {
  const { parseSpecRules, buildCoverage } = await load();
  return buildCoverage(new Map([['ma-spec', parseSpecRules(SPEC)]]), citations);
}

test('buildCoverage compte les règles couvertes, et l’exemptée avec elles', async () => {
  const { specs } = await coverage([
    { spec: 'ma-spec', rule: '1', file: 'a.test.js' },
    { spec: 'ma-spec', rule: '2bis', file: 'b.test.js' },
  ]);
  const one = specs[0];
  assert.equal(one.total, 5);
  assert.equal(one.exempt, 1);
  assert.equal(one.covered, 3, '1, 2bis et la règle 4 exemptée');
  assert.deepEqual(one.missing, ['2', '3']);
});

// specs/spec-rule-coverage.md §3.1 rule 6 — le rapport se lit sans contexte : trié par nombre de
// règles non couvertes, le pire d'abord.
test('buildCoverage trie les specs, la moins couverte en tête', async () => {
  const { parseSpecRules, buildCoverage } = await load();
  const rules = parseSpecRules(SPEC);
  const { specs } = buildCoverage(
    new Map([['bien-couverte', rules], ['pas-couverte', rules]]),
    rules.map((r) => ({ spec: 'bien-couverte', rule: r.id, file: 'a.test.js' })),
  );
  assert.deepEqual(specs.map((s2) => s2.name), ['pas-couverte', 'bien-couverte']);
});

test('buildCoverage remonte les citations qui ne retombent sur rien', async () => {
  const { orphans } = await coverage([
    { spec: 'ma-spec', rule: '99', file: 'a.test.js' },
    { spec: 'spec-renommee', rule: '1', file: 'b.test.js' },
  ]);
  assert.deepEqual(orphans.map((o) => o.why), ['règle inexistante', 'spec inconnue']);
});

// ── La barrière ──────────────────────────────────────────────────────────────

// specs/spec-rule-coverage.md §3.2 rule 8 — une règle AJOUTÉE doit être citée par un test.
test('une règle ajoutée sans test fait échouer le contrôle', async () => {
  const { gateVerdict } = await load();
  const v = gateVerdict({ addedRules: [{ spec: 'ma-spec', rule: '7' }], citedAfter: new Set() });
  assert.equal(v.ok, false);
  assert.deepEqual(v.failures, [{ spec: 'ma-spec', rule: '7' }]);
});

// specs/spec-rule-coverage.md §3.2 rule 11 — un test déjà écrit qui nomme la règle compte.
test('…et passe dès qu’un test la nomme, même un test déjà écrit', async () => {
  // Règle 11 : ce qui compte est que la règle soit prouvée, pas qu'un fichier ait changé.
  const { gateVerdict } = await load();
  const v = gateVerdict({
    addedRules: [{ spec: 'ma-spec', rule: '7' }],
    citedAfter: new Set(['ma-spec:7']),
  });
  assert.equal(v.ok, true);
});

test('une règle ajoutée déjà déclarée sans test passe', async () => {
  const { gateVerdict } = await load();
  const v = gateVerdict({ addedRules: [{ spec: 'ma-spec', rule: '7', exempt: true }], citedAfter: new Set() });
  assert.equal(v.ok, true);
});

// specs/spec-rule-coverage.md §3.2 rule 9 — une règle modifiée avertit, elle ne bloque pas.
test('une règle REFORMULÉE avertit mais ne bloque pas', async () => {
  // Règle 9 : sinon corriger une faute de frappe exigerait de toucher un test, et une barrière qu'on
  // apprend à contourner ne protège rien.
  const { gateVerdict } = await load();
  const v = gateVerdict({ modifiedRules: [{ spec: 'ma-spec', rule: '3' }], citedAfter: new Set() });
  assert.equal(v.ok, true);
  assert.deepEqual(v.warnings, [{ spec: 'ma-spec', rule: '3' }]);
});

test('aucune règle ajoutée : le contrôle passe sans rien dire', async () => {
  const { gateVerdict } = await load();
  assert.deepEqual(gateVerdict({}), { ok: true, failures: [], warnings: [] });
});
