/**
 * specs/site-english-version.md rules 48 and 49 — the plugin's own strings reach English, including
 * the ones nothing on screen ever shows.
 *
 * Three of them did not, and the translation pass could not have caught them: two `aria-label`s and
 * a honeypot label, written as literals instead of going through `GF.t()`. Nobody reads them, so
 * nobody saw them — only a screen reader did, in French, on an English page. The terms link was the
 * same class of miss with a heavier consequence: the checkbox records an acceptance, so it has to
 * point at the text the visitor could actually read.
 *
 * This is PHP and browser JavaScript, so there is nothing to execute here. What the suite can do is
 * refuse the shape that lets it happen again: a literal where a lookup belongs, a key with no
 * translation, a page URL that ignores the language.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const PLUGIN = path.join(__dirname, '..', '..', '..', 'integrations', 'wordpress', 'guestflow-booking');
const MU = path.join(__dirname, '..', '..', '..', 'integrations', 'wordpress', 'solio-site', 'mu-plugins');

const view = fs.readFileSync(path.join(PLUGIN, 'blocks', 'booking', 'view.js'), 'utf8');
const blocks = fs.readFileSync(path.join(PLUGIN, 'includes', 'class-gf-blocks.php'), 'utf8');
const settings = fs.readFileSync(path.join(PLUGIN, 'includes', 'class-gf-settings.php'), 'utf8');
const po = fs.readFileSync(path.join(PLUGIN, 'languages', 'guestflow-booking-en_GB.po'), 'utf8');
const siteStyle = fs.readFileSync(path.join(MU, 'gf-site-style.php'), 'utf8');

/** The catalogue as { msgid: msgstr }, continuation lines folded back together. */
function catalogue() {
  const entries = {};
  let key = null;
  let target = null;
  let buffer = '';
  const flush = () => {
    if (key !== null && target === 'msgstr') entries[key] = buffer;
  };
  for (const line of po.split('\n')) {
    const m = /^(msgid|msgstr)\s+"([\s\S]*)"$/.exec(line.trim());
    const cont = /^"([\s\S]*)"$/.exec(line.trim());
    if (m) {
      if (m[1] === 'msgid') {
        flush();
        key = m[2];
        target = 'msgid';
        buffer = '';
      } else {
        target = 'msgstr';
        buffer = m[2];
      }
    } else if (cont && target) {
      if (target === 'msgid') key += cont[1];
      else buffer += cont[1];
    } else if (line.trim() === '') {
      flush();
      key = null;
      target = null;
      buffer = '';
    }
  }
  flush();
  return entries;
}

test('every aria-label in the booking view is looked up, never written in place (rule 49)', () => {
  const labels = [...view.matchAll(/'aria-label'\s*:\s*([^,}]+)/g)].map((m) => m[1].trim());
  assert.ok(labels.length > 0, 'no aria-label found at all — the file was restructured');
  // A literal is allowed only when it carries no letter: the steppers announce « − » and « + »,
  // symbols that read the same in both languages and belong in no catalogue. Anything with a word
  // in it is a string a screen reader speaks, so it follows the page.
  const literals = labels.filter((value) => !value.startsWith('GF.t(') && /[A-Za-zÀ-ÿ]/.test(value));
  assert.deepStrictEqual(
    literals,
    [],
    `aria-label written in place instead of GF.t(): ${literals.join(' | ')}`,
  );
});

test('no French literal is left where a label is rendered (rule 49)', () => {
  // The three that shipped in 1.12.0. Scoped to exact strings on purpose: a broad accent hunt would
  // flag the French source strings in class-gf-blocks.php, which ARE the reference (rule 23).
  for (const French of ['Mois précédent', 'Mois suivant', 'Ne pas remplir']) {
    assert.ok(
      !view.includes(`'${French}'`),
      `« ${French} » is still a literal in view.js — it must come from GF.t()`,
    );
  }
});

test('every key the view looks up is declared, and translated (rules 23 and 49)', () => {
  const used = [...new Set([...view.matchAll(/GF\.t\(\s*'([A-Za-z0-9_]+)'/g)].map((m) => m[1]))];
  const declared = new Map(
    [...blocks.matchAll(/'([A-Za-z0-9_]+)'\s*=>\s*__\('((?:[^'\\]|\\.)*)'/g)].map((m) => [m[1], m[2]]),
  );
  assert.ok(used.length > 50, `only ${used.length} keys read from view.js — the extraction broke`);

  const undeclared = used.filter((key) => !declared.has(key));
  assert.deepStrictEqual(undeclared, [], `GF.t() key with no French source: ${undeclared.join(', ')}`);

  const english = catalogue();
  const untranslated = used.filter((key) => {
    const source = declared.get(key).replace(/\\'/g, "'");
    return !english[source];
  });
  assert.deepStrictEqual(
    untranslated,
    [],
    `key(s) with no English in guestflow-booking-en_GB.po: ${untranslated.join(', ')}`,
  );
});

test('the terms link follows the language of the page (rule 48)', () => {
  const start = settings.indexOf('public function get_cgv_page_url');
  assert.ok(start > 0, 'get_cgv_page_url() not found — the file was restructured');
  const body = settings.slice(start, settings.indexOf('}', settings.indexOf('return', start)));
  assert.ok(
    /in_current_language\s*\(/.test(body),
    'get_cgv_page_url() hands its URL back untranslated: an English visitor accepts French terms',
  );
  assert.ok(
    /pll_get_post\s*\(/.test(settings),
    'nothing asks Polylang for the translated page — url_to_postid alone does not translate',
  );
});

test("the burger's screen-reader label follows the page too (rule 49)", () => {
  assert.ok(
    !/aria-label="Ouvrir le menu"/.test(siteStyle),
    'the burger announces « Ouvrir le menu » on every page, English included',
  );
  assert.ok(
    /gf_t\(\s*'nav_ouvrir_menu'\s*\)/.test(siteStyle),
    'the burger label must come from the site dictionary, which rule 36 keeps in both languages',
  );
});
