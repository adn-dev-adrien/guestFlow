/**
 * specs/site-english-version.md rules 34 and 36 — the Solio site's facts are bilingual by
 * construction, not by good intentions.
 *
 * These are PHP mu-plugins, so there is no PHP runner here to exercise them. What this suite can
 * still do — and what actually protects the English site — is read the files and refuse the shape
 * that breaks it: a fact written in French only, or a label added to one half of the dictionary.
 * That is the failure this spec expects, because it happens while correcting something else in a
 * hurry: a new FAQ entry, a new piece of equipment, a season that changes.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const MU = path.join(__dirname, '..', '..', '..', 'integrations', 'wordpress', 'solio-site', 'mu-plugins');
const facts = fs.readFileSync(path.join(MU, 'gf-seo-facts.php'), 'utf8');
const i18n = fs.readFileSync(path.join(MU, 'gf-i18n.php'), 'utf8');

/** The FAQ function's body, so a stray `'q' =>` elsewhere cannot fool the count. */
function faqBody() {
  const start = facts.indexOf('function gf_seo_faq(');
  const end = facts.indexOf('return $faq[ $cle ] ?? array();');
  assert.ok(start > 0 && end > start, 'gf_seo_faq() not found — the file was restructured');
  return facts.slice(start, end);
}

test('every FAQ entry carries its English question and answer (rule 34)', () => {
  const body = faqBody();
  const questions = body.match(/'q'\s*=>/g) || [];
  const questionsEn = body.match(/'q_en'\s*=>/g) || [];
  const answers = body.match(/'r'\s*=>/g) || [];
  const answersEn = body.match(/'r_en'\s*=>/g) || [];

  assert.ok(questions.length > 0, 'no FAQ entry found at all');
  assert.strictEqual(questionsEn.length, questions.length, `${questions.length - questionsEn.length} question(s) with no English`);
  assert.strictEqual(answersEn.length, answers.length, `${answers.length - answersEn.length} answer(s) with no English`);
});

test('every piece of equipment carries its English name (rule 34)', () => {
  // Only equipment lines — the ones opening with an icon slot. The three bare `nom` keys left in
  // the file are proper names ("Domaine Solio", "La Granja", "L'Estiva"), which rule 9 keeps
  // untranslated on purpose.
  const entries = [...facts.matchAll(/array\(\s*'ic'\s*=>[\s\S]*?\),\n/g)].map((m) => m[0]);
  assert.ok(entries.length > 10, `only ${entries.length} equipment lines found — the parser lost its footing`);

  const missing = entries.filter((e) => /'nom'\s*=>/.test(e) && !/'nom_en'\s*=>/.test(e));
  assert.deepStrictEqual(
    missing.map((e) => (e.match(/'nom'\s*=>\s*'([^']*)'/) || [])[1]),
    [],
    'equipment line(s) with no English name',
  );
});

test('a translated fact never loses its French twin (rule 35)', () => {
  // `_en` only ever exists beside the French key it translates: that adjacency IS the single
  // source of truth. An orphan `saison_en` means the French one was renamed or deleted, and the
  // fallback would then silently serve nothing.
  const enKeys = [...facts.matchAll(/'([a-z_]+)_en'\s*=>/g)].map((m) => m[1]);
  const orphans = [...new Set(enKeys)].filter((key) => !new RegExp(`'${key}'\\s*=>`).test(facts));
  assert.deepStrictEqual(orphans, [], `English key(s) with no French twin: ${orphans.join(', ')}`);
});

test('the estate facilities list has as many lines in English as in French (rule 34)', () => {
  // A flat list pairs by POSITION, so a line added to one side alone does not go missing — it
  // shifts every line below it, and the pool starts describing the parking. Length is the only
  // thing that can be checked from here, and it is exactly what catches that.
  const body = facts.slice(facts.indexOf('function gf_seo_equipements_domaine('));
  const fr = body.slice(body.indexOf('$fr = array('), body.indexOf('$en = array('));
  const en = body.slice(body.indexOf('$en = array('), body.indexOf('$l = $langue'));
  const count = (block) => (block.match(/\n\t\t'/g) || []).length;
  assert.ok(count(fr) > 3, 'the French list could not be read');
  assert.strictEqual(count(en), count(fr), 'the two estate-facility lists have drifted apart in length');
});

test('the site dictionary declares the same keys in both languages (rule 36)', () => {
  const block = (lang) => {
    const start = i18n.indexOf(`'${lang}' => array(`);
    assert.ok(start > 0, `the ${lang} half of the dictionary is missing`);
    const end = i18n.indexOf('\n        ),', start);
    return i18n.slice(start, end);
  };
  const keys = (lang) => [...block(lang).matchAll(/^\s+'([a-z0-9_]+)'\s*=>/gm)].map((m) => m[1]).sort();

  const fr = keys('fr');
  const en = keys('en');
  assert.ok(fr.length > 10, 'the French dictionary looks empty — the parser lost its footing');
  assert.deepStrictEqual(en, fr, 'the two halves of the dictionary have drifted apart');
});

test('no English path repeats its French twin (rule 41)', () => {
  // Polylang runs here in directory mode with the default language unprefixed, and in that
  // arrangement two pages sharing a slug cannot be told apart: `/en/contact/` answered with a 301
  // to the FRENCH page. Restoring a "nicer" identical slug would silently send English readers
  // back to French, which is the one failure nobody would think to check for.
  const start = i18n.indexOf('function gf_chemins_traduits()');
  assert.ok(start > 0, 'gf_chemins_traduits() not found');
  const body = i18n.slice(start, i18n.indexOf('}', i18n.indexOf('return array(', start)));
  const pairs = [...body.matchAll(/'([^']+)'\s*=>\s*'([^']+)'/g)].map((m) => [m[1], m[2]]);
  assert.ok(pairs.length >= 7, `only ${pairs.length} paths mapped`);

  const clashes = pairs
    // The root is not a slug: `/` maps to `/en/`, the language root itself, and that pair is the
    // one case where "identical" is correct.
    .filter(([fr]) => fr !== '/')
    .filter(([fr, en]) => en.replace(/^\/en/, '') === fr)
    .map(([fr, en]) => `${fr} -> ${en}`);
  assert.deepStrictEqual(clashes, [], 'English path(s) identical to the French one');
});

test('the bilingual guard asks Polylang for English explicitly (rule 42)', () => {
  // `suppress_filters` does NOT disarm Polylang — it filters through `pre_get_posts`. With it, the
  // query run from a French page saw only French pages, decided English did not exist, and hid the
  // switcher across the whole French site.
  const start = i18n.indexOf('function gf_pages_anglaises_existent()');
  assert.ok(start > 0, 'gf_pages_anglaises_existent() not found');
  const body = i18n.slice(start, i18n.indexOf('\n}', start));
  assert.match(body, /'lang'\s*=>\s*'en'/, "the query no longer asks Polylang for 'en'");
  // As an argument, not as the word in the comment that explains why it is gone.
  assert.doesNotMatch(body, /'suppress_filters'\s*=>/, 'suppress_filters is back, and it does not filter by language');
});

test('the booking calendar has no frozen French month names (rule 43)', () => {
  const view = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'integrations', 'wordpress', 'guestflow-booking', 'blocks', 'booking', 'view.js'),
    'utf8',
  );
  assert.match(view, /Intl\.DateTimeFormat\(GF\.locale/, 'the calendar no longer reads the page locale');
  const frozen = ['janvier', 'février', 'décembre'].filter((m) => new RegExp(`'${m}'\\s*,`).test(view.replace(/fallback = \[[^\]]*\]/g, '')));
  assert.deepStrictEqual(frozen, [], 'French month names are frozen in the calendar again');
});
