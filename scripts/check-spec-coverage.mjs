#!/usr/bin/env node
/**
 * « Une règle de spec sans test est une règle non livrée » — specs/spec-rule-coverage.md
 *
 * Répond à la question que personne ne pouvait poser : quelles règles n'ont aucun test ?
 *
 * Le 2026-09-01, trois règles écrites en v2.9.0 n'avaient jamais été construites, et les 5 000 tests
 * du dépôt étaient verts pendant ce temps. Elles ont été trouvées à l'œil. Le lien règle → test
 * existait pourtant déjà — 584 citations « rule N » dans les commentaires — mais en texte libre,
 * donc invisible à toute machine. Ce script lit CETTE convention-là : rien de nouveau à écrire, les
 * citations en place deviennent de la couverture.
 *
 * Usage :
 *   node scripts/check-spec-coverage.mjs                    # rapport global
 *   node scripts/check-spec-coverage.mjs --spec <nom>       # détail d'une spec
 *   node scripts/check-spec-coverage.mjs --changed --base <ref>   # la barrière (CI sur les PR)
 *
 * La logique est pure et exportée ; la CLI ne fait que des entrées-sorties.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// ── Lecture des specs ────────────────────────────────────────────────────────

// Un numéro de règle : 10, 2bis, 20c. Gardé en chaîne, minuscule — c'est un identifiant, pas un
// nombre : « 2 » et « 2bis » sont deux règles distinctes.
const RULE_ID = String.raw`\d+(?:bis|ter|[a-z])?`;
const RULE_LINE = new RegExp(String.raw`^(${RULE_ID})\.\s`, 'i');
// Une règle déclarée non testable le dit DANS la spec, sous elle. Jamais en silence (règle 5).
const EXEMPT_LINE = /^\s*>?\s*\*\*Sans test\*\*\s*[—-]?\s*(.*)$/i;

/**
 * Les règles de la section « Functional rules » d'une spec, et elles seules : les listes numérotées
 * de l'architecture, du plan de test ou des questions ouvertes ne sont pas des règles (règle 2).
 *
 * @returns {Array<{id: string, exempt: boolean, reason: string}>}
 */
export function parseSpecRules(markdown) {
  const lines = String(markdown || '').split('\n');
  const start = lines.findIndex((l) => /^##\s+3\./.test(l));
  if (start === -1) return [];
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^##\s/.test(lines[i])) { end = i; break; }
  }

  const rules = [];
  let current = null;
  for (const line of lines.slice(start + 1, end)) {
    const m = line.match(RULE_LINE);
    if (m) {
      current = { id: m[1].toLowerCase(), exempt: false, reason: '' };
      rules.push(current);
      continue;
    }
    if (!current) continue;
    const ex = line.match(EXEMPT_LINE);
    if (ex) { current.exempt = true; current.reason = ex[1].trim(); }
  }
  // Une spec peut citer deux fois le même numéro (une règle et son rappel) : une seule règle.
  const seen = new Set();
  return rules.filter((r) => (seen.has(r.id) ? false : seen.add(r.id)));
}

// ── Lecture des citations dans les tests ─────────────────────────────────────

const SPEC_MENTION = /specs\/([a-z0-9-]+)\.md/gi;
// « rule 10 », « rules 4-5 », « règle 11bis », « rules 28 + 30b ».
const CITATION = new RegExp(
  String.raw`(?:rules?|règles?)\s+(${RULE_ID}(?:\s*(?:[-–+,]|et|and)\s*${RULE_ID})*)`,
  'gi',
);

// « 4-5 » désigne les règles 4 ET 5 ; « 28 + 30b » en désigne deux. Une plage entre deux identifiants
// suffixés (« 2bis-4 ») n'a pas de sens : on ne garde alors que les bornes.
function expandGroup(group) {
  const out = [];
  const parts = String(group).split(/\s*(?:[+,]|et|and)\s*/i).filter(Boolean);
  for (const part of parts) {
    const range = part.match(new RegExp(String.raw`^(${RULE_ID})\s*[-–]\s*(${RULE_ID})$`, 'i'));
    if (range) {
      const a = Number.parseInt(range[1], 10);
      const b = Number.parseInt(range[2], 10);
      const plain = /^\d+$/.test(range[1]) && /^\d+$/.test(range[2]);
      if (plain && Number.isFinite(a) && Number.isFinite(b) && b >= a && b - a <= 50) {
        for (let n = a; n <= b; n += 1) out.push(String(n));
        continue;
      }
      out.push(range[1].toLowerCase(), range[2].toLowerCase());
      continue;
    }
    out.push(part.toLowerCase());
  }
  return out;
}

// Une date (« 2026-08-31 ») ressemble à une plage de règles. Et aucune spec n'a 200 règles : au-delà,
// c'est un numéro de version, une année ou un montant. Les deux filtres évitent des couvertures
// fantômes, qui seraient pires que pas de couverture du tout.
const PLAUSIBLE_RULE = /^\d{1,3}(?:bis|ter|[a-z])?$/i;
const isPlausible = (id) => PLAUSIBLE_RULE.test(id) && Number.parseInt(id, 10) <= 200;

// Une citation est rattachée à la spec nommée juste au-dessus d'elle — mais « juste » veut dire dans
// le même commentaire, pas n'importe où avant. Sans cette borne, un fichier qui mentionne une spec
// secondaire en passant (« colonnes ajoutées par une migration, cf. specs/migrations-baseline.md »)
// voyait toutes ses citations suivantes lui être attribuées, ce qui produisait à la fois une fausse
// couverture là-bas et des citations orphelines ici. Au-delà, on retombe sur la spec que le fichier
// annonce en tête — la convention veut qu'un fichier de test ouvre en nommant son sujet.
const NEAR_LINES = 3;

/**
 * Les couples (spec, règle) cités par un fichier de test (règle 3).
 *
 * @returns {Array<{spec: string, rule: string}>}
 */
export function parseCitations(source) {
  const text = String(source || '');
  const lineOf = (index) => text.slice(0, index).split('\n').length;
  const specs = [...text.matchAll(SPEC_MENTION)]
    .map((m) => ({ at: m.index, line: lineOf(m.index), name: m[1].toLowerCase() }));
  if (specs.length === 0) return [];
  const primary = specs[0].name;
  const out = [];
  for (const m of text.matchAll(CITATION)) {
    const line = lineOf(m.index);
    let near = null;
    for (const s of specs) {
      if (s.at > m.index) break;
      if (line - s.line <= NEAR_LINES) near = s;
    }
    const spec = near ? near.name : primary;
    for (const rule of expandGroup(m[1])) {
      if (isPlausible(rule)) out.push({ spec, rule });
    }
  }
  return out;
}

// ── Couverture ───────────────────────────────────────────────────────────────

/**
 * @param {Map<string, Array>} specRules  nom de spec → règles
 * @param {Array<{spec, rule, file}>} citations
 */
export function buildCoverage(specRules, citations) {
  const cited = new Map(); // spec → Map(rule → [fichiers])
  for (const c of citations) {
    if (!cited.has(c.spec)) cited.set(c.spec, new Map());
    const byRule = cited.get(c.spec);
    if (!byRule.has(c.rule)) byRule.set(c.rule, []);
    if (c.file && !byRule.get(c.rule).includes(c.file)) byRule.get(c.rule).push(c.file);
  }

  const specs = [];
  for (const [name, rules] of specRules) {
    if (rules.length === 0) continue;
    const byRule = cited.get(name) || new Map();
    const missing = rules.filter((r) => !r.exempt && !byRule.has(r.id)).map((r) => r.id);
    specs.push({
      name,
      total: rules.length,
      exempt: rules.filter((r) => r.exempt).length,
      covered: rules.filter((r) => r.exempt || byRule.has(r.id)).length,
      missing,
      files: byRule,
    });
  }

  // Une citation qui ne retombe sur rien : spec renommée, ou numéro périmé après renumérotation.
  // C'est un signal — sans lui, un renommage dégraderait la couverture en silence.
  const orphans = [];
  for (const c of citations) {
    const rules = specRules.get(c.spec);
    if (!rules) { orphans.push({ ...c, why: 'spec inconnue' }); continue; }
    if (rules.length > 0 && !rules.some((r) => r.id === c.rule)) {
      orphans.push({ ...c, why: 'règle inexistante' });
    }
  }
  specs.sort((a, b) => b.missing.length - a.missing.length || a.name.localeCompare(b.name));
  return { specs, orphans };
}

// ── La barrière ──────────────────────────────────────────────────────────────

/**
 * Verdict sur un diff : une règle AJOUTÉE doit être citée par un test (règle 8) ; une règle MODIFIÉE
 * avertit sans bloquer (règle 9) — sinon corriger une faute de frappe exigerait de toucher un test,
 * et une barrière qu'on apprend à contourner ne protège rien.
 *
 * @param {Array<{spec, rule, exempt}>} addedRules
 * @param {Array<{spec, rule}>} modifiedRules
 * @param {Set<string>} citedAfter  « spec:règle » cités PARTOUT après le changement (règle 11 : un
 *                                  test déjà écrit qui nomme la règle compte).
 */
export function gateVerdict({ addedRules = [], modifiedRules = [], citedAfter = new Set() } = {}) {
  const failures = addedRules
    .filter((r) => !r.exempt && !citedAfter.has(`${r.spec}:${r.rule}`))
    .map((r) => ({ spec: r.spec, rule: r.rule }));
  const warnings = modifiedRules
    .filter((r) => !citedAfter.has(`${r.spec}:${r.rule}`))
    .map((r) => ({ spec: r.spec, rule: r.rule }));
  return { ok: failures.length === 0, failures, warnings };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function listFiles(dir, match, acc = []) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') listFiles(full, match, acc); continue; }
    if (match(full)) acc.push(full);
  }
  return acc;
}

const isTestFile = (f) => /\.(test|unit\.test|spec)\.[jt]sx?$/.test(f) || /\/tests\/.*\.js$/.test(f);

function readSpecs() {
  const dir = path.join(ROOT, 'specs');
  const out = new Map();
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.md') || /^(TEMPLATE|README|ROADMAP)/.test(f)) continue;
    out.set(f.replace(/\.md$/, '').toLowerCase(), parseSpecRules(fs.readFileSync(path.join(dir, f), 'utf8')));
  }
  return out;
}

function readCitations() {
  const files = [
    ...listFiles(path.join(ROOT, 'server', 'src', 'tests'), isTestFile),
    ...listFiles(path.join(ROOT, 'client', 'src'), isTestFile),
    ...listFiles(path.join(ROOT, 'e2e'), isTestFile),
  ];
  const out = [];
  for (const f of files) {
    const rel = path.relative(ROOT, f);
    for (const c of parseCitations(fs.readFileSync(f, 'utf8'))) out.push({ ...c, file: rel });
  }
  return out;
}

const git = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

// Les règles ajoutées / modifiées par le diff, par spec. On relit la spec APRÈS changement pour
// connaître l'exemption éventuelle : une règle peut naître déjà déclarée non testable.
function changedRules(base) {
  const diff = git(['diff', '--unified=0', `${base}...HEAD`, '--', 'specs/']);
  const added = [];
  const modified = [];
  let spec = null;
  for (const line of diff.split('\n')) {
    const head = line.match(/^\+\+\+ b\/specs\/([a-z0-9-]+)\.md/i);
    if (head) { spec = head[1].toLowerCase(); continue; }
    if (!spec) continue;
    const plus = line.startsWith('+') && !line.startsWith('+++') ? line.slice(1) : null;
    const minus = line.startsWith('-') && !line.startsWith('---') ? line.slice(1) : null;
    const m = (plus ?? '').match(RULE_LINE);
    if (m) added.push({ spec, rule: m[1].toLowerCase() });
    const mm = (minus ?? '').match(RULE_LINE);
    if (mm) modified.push({ spec, rule: mm[1].toLowerCase() });
  }
  // Une règle présente des deux côtés du diff a été reformulée, pas ajoutée.
  const removedKeys = new Set(modified.map((r) => `${r.spec}:${r.rule}`));
  const specsNow = readSpecs();
  const exemptOf = (r) => Boolean((specsNow.get(r.spec) || []).find((x) => x.id === r.rule)?.exempt);
  return {
    addedRules: added.filter((r) => !removedKeys.has(`${r.spec}:${r.rule}`)).map((r) => ({ ...r, exempt: exemptOf(r) })),
    modifiedRules: modified.filter((r) => added.some((a) => a.spec === r.spec && a.rule === r.rule)),
  };
}

function report({ specName }) {
  const { specs, orphans } = buildCoverage(readSpecs(), readCitations());
  if (specName) {
    const one = specs.find((s) => s.name === specName.replace(/\.md$/, '').toLowerCase());
    if (!one) { console.error(`Spec inconnue ou sans règles : ${specName}`); process.exit(2); }
    console.log(`\nspecs/${one.name}.md — ${one.covered}/${one.total} règles couvertes` +
      (one.exempt ? ` (${one.exempt} sans test, déclarées)` : ''));
    const real = new Set((readSpecs().get(one.name) || []).map((r) => r.id));
    for (const [rule, files] of [...one.files.entries()].sort()) {
      // Une citation vers un numéro que la spec n'a pas ne prouve rien : elle est listée à part,
      // sinon elle se lirait comme une couverture.
      if (real.has(rule)) console.log(`  règle ${rule.padEnd(6)} ← ${files.join(', ')}`);
    }
    if (one.missing.length) console.log(`  MANQUANTES : ${one.missing.join(', ')}`);
    const stale = [...one.files.keys()].filter((r) => !real.has(r));
    if (stale.length) console.log(`  citations orphelines (numéro absent de la spec) : ${stale.sort().join(', ')}`);
    return 0;
  }
  let total = 0; let covered = 0; let exempt = 0;
  for (const s of specs) { total += s.total; covered += s.covered; exempt += s.exempt; }
  console.log('');
  for (const s of specs.filter((x) => x.missing.length > 0)) {
    console.log(`${('specs/' + s.name + '.md').padEnd(62)} ${String(s.covered).padStart(3)}/${String(s.total).padEnd(3)}  manquantes : ${s.missing.join(', ')}`);
  }
  const pct = total ? Math.round((covered / total) * 100) : 0;
  console.log(`\nTotal : ${total} règles, ${covered} couvertes (${pct} %), ${exempt} déclarées sans test.`);
  if (orphans.length) {
    console.log(`\nCitations orphelines (spec ou règle inexistante) : ${orphans.length}`);
    for (const o of orphans.slice(0, 15)) console.log(`  ${o.file} → specs/${o.spec}.md règle ${o.rule} (${o.why})`);
    if (orphans.length > 15) console.log(`  … et ${orphans.length - 15} autres`);
  }
  return 0;
}

function gate(base) {
  const { addedRules, modifiedRules } = changedRules(base);
  const citedAfter = new Set(readCitations().map((c) => `${c.spec}:${c.rule}`));
  const verdict = gateVerdict({ addedRules, modifiedRules, citedAfter });
  for (const w of verdict.warnings) {
    console.log(`⚠ specs/${w.spec}.md règle ${w.rule} : reformulée, et toujours citée par aucun test.`);
  }
  if (verdict.ok) {
    const declared = addedRules.filter((r) => r.exempt).length;
    // Ne pas surestimer : une règle déclarée « sans test » n'est pas une règle prouvée, et le dire
    // autrement rendrait le contrôle rassurant à tort.
    console.log(addedRules.length
      ? `✓ ${addedRules.length} règle(s) ajoutée(s) : ${addedRules.length - declared} citée(s) par un test`
        + `${declared ? `, ${declared} déclarée(s) sans test` : ''}.`
      : '✓ Aucune règle ajoutée par cette PR.');
    return 0;
  }
  for (const f of verdict.failures) {
    console.error(`✗ specs/${f.spec}.md règle ${f.rule} : ajoutée par cette PR, citée par aucun test.`);
  }
  console.error('\n  Ajoutez un test qui la nomme (« specs/<spec>.md rule <n> »), ou déclarez-la non');
  console.error('  testable avec une ligne « > **Sans test** — <raison> » sous la règle dans la spec.');
  return 1;
}

function main() {
  const argv = process.argv.slice(2);
  const at = (flag) => { const i = argv.indexOf(flag); return i === -1 ? null : argv[i + 1]; };
  if (argv.includes('--changed')) process.exit(gate(at('--base') || 'origin/master'));
  process.exit(report({ specName: at('--spec') }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
