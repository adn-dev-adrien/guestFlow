/**
 * specs/site-english-version.md rules 56 and 57 — the language reaches the browser's own calls, and
 * the site's price retouches speak the page's language.
 *
 * A REST request carries no page, so Polylang has nothing to read: the plugin resolved the site's own
 * locale and asked GuestFlow in French, then cached the answer under that key. The English drawer
 * therefore listed its options, its price units and its refusals in French while everything rendered
 * with the page was already translated. Measured on the published site on 2026-09-25.
 *
 * And the site's own drawer script retouched those price lines with French literals, triggered by the
 * option TITLE — which stays French whenever no English title is filled in, so the retouch fired on
 * English pages too: « 30,00 € · per participant · tarif dégressif ».
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..', '..', 'integrations', 'wordpress');
const runtime = fs.readFileSync(path.join(ROOT, 'guestflow-booking', 'assets', 'runtime.js'), 'utf8');
const proxy = fs.readFileSync(path.join(ROOT, 'guestflow-booking', 'includes', 'class-gf-rest-proxy.php'), 'utf8');
const language = fs.readFileSync(path.join(ROOT, 'guestflow-booking', 'includes', 'class-gf-language.php'), 'utf8');
const resa = fs.readFileSync(path.join(ROOT, 'solio-site', 'mu-plugins', 'gf-seo-reservation.php'), 'utf8');

/** Source with comments removed — an assertion about a call must not match the prose explaining it. */
function code(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

test('every browser call to the proxy carries the language (rule 56)', () => {
  const api = /GF\.api = function[\s\S]*?\n  };/.exec(runtime);
  assert.ok(api, 'GF.api not found — the runtime was restructured');
  assert.ok(
    /lang=/.test(api[0]) && /GF\.lang/.test(api[0]),
    'GF.api builds its URL without the language: a REST request has no page, so the plugin would guess French',
  );
});

test('the proxy adopts the language of the request, once, before any handler (rule 56)', () => {
  const c = code(proxy);
  assert.ok(
    /rest_pre_dispatch/.test(c),
    'nothing hooks before the handlers: a route added later would silently ask in the wrong language',
  );
  assert.ok(/GF_Language::set\s*\(/.test(c), 'the requested language is never applied');
  assert.ok(
    /get_param\s*\(\s*'lang'\s*\)/.test(c),
    "the proxy must read the 'lang' parameter the browser sends",
  );
});

test('an explicitly stated language outranks every guess (rule 56)', () => {
  assert.ok(
    /public static function set\s*\(/.test(language),
    'GF_Language has no way to be told the language, so the REST path can only guess',
  );
  const setter = /public static function set\([\s\S]*?\n    }/.exec(language);
  assert.ok(
    setter && /self::\$current\s*=\s*self::normalise\(/.test(setter[0]),
    'the stated language must be normalised and memoised like any other, so one request keeps one answer',
  );
});

test("the drawer's price retouches come from the dictionary, not from French literals (rule 57)", () => {
  const c = code(resa);
  // The three literals that shipped, and fired on English pages because the trigger is the option
  // title — which stays French until an English one is filled in.
  for (const [literal, key] of [
    ["' \\u00b7 la session'", 'resa_la_session'],
    ["' \\u00b7 tarif d\\u00e9gressif'", 'resa_tarif_degressif'],
  ]) {
    assert.ok(
      !c.includes(literal),
      `${literal} is still appended as a literal — it reaches English pages too`,
    );
    assert.ok(
      c.includes(key),
      `${key} must come from the site dictionary, which rule 36 keeps in both languages`,
    );
  }
  assert.ok(
    /per stay/.test(c),
    'the unit strip only knows « au séjour »: on an English page the API sends « per stay » and the line keeps it',
  );
  assert.ok(
    /per participant/.test(c),
    'the participant rewrite only matches French, so the English label is left as it is',
  );
});

// --- rule 58: the retouches must survive an option title being translated -----------------------
// Behavioural, not textual: the matchers are lifted out of the mu-plugin and replayed over the REAL
// option titles of both languages. A textual guard ("the file mentions an English word") passes when
// the wrong English word is there; this one does not.
const matchers = (() => {
  const src = code(resa);
  const pick = (name) => {
    const m = new RegExp(`function ${name}\\s*\\([\\s\\S]*?\\n\\t}`).exec(src);
    assert.ok(m, `${name}() not found in gf-seo-reservation.php`);
    return m[0];
  };
  // eslint-disable-next-line no-new-func
  return new Function(`${pick('normalise')}\n${pick('porte')}\n${pick('commence')}\nreturn { normalise, porte, commence };`)();
})();

/** The (fr, en) token pairs the source actually passes, so a deleted English token fails the test. */
function pairsOf(fn) {
  const c = code(resa);
  const re = new RegExp(`${fn}\\(\\s*t,\\s*'([^']*)',\\s*'([^']*)'\\s*\\)`, 'g');
  return [...c.matchAll(re)].map((m) => [m[1], m[2]]);
}

test('a translated option title still triggers its price retouch (rule 58)', () => {
  const pairs = pairsOf('porte');
  assert.ok(pairs.length >= 3, 'the three retouched animations must each declare their two languages');
  const hits = (title) => pairs.filter(([fr, en]) => matchers.porte(matchers.normalise(title), fr, en));
  // Titles as the drawer sees them, after the « Animation- » prefix is stripped. French from prod,
  // English as filled in on 2026-09-25.
  for (const [fr, en] of [
    ['animaux sauvage', 'Wild animal trail'],
    ['visite animaux', 'Animal visit'],
    ['Enfants + bain nordique', 'Kids activity + nordic bath'],
  ]) {
    assert.equal(hits(fr).length, 1, `« ${fr} » matches ${hits(fr).length} rules instead of exactly one`);
    assert.equal(
      hits(en).length, 1,
      `« ${en} » matches ${hits(en).length} rules: once an English title is filled in, the English drawer loses this line's suffix`,
    );
    assert.deepEqual(hits(en)[0], hits(fr)[0], `« ${en} » lands on a different rule than « ${fr} »`);
  }
  // The nordic bath is ALSO an hourly resource with a line of its own. Keying the kids' activity on
  // « nordic bath » would retouch that line too, appending a sliding scale it does not have.
  for (const resource of ['Bain nordique', 'Nordic bath']) {
    assert.equal(
      hits(resource).length, 0,
      `« ${resource} » — the hourly resource — is caught by an option's retouch rule`,
    );
  }
});

test('a translated option title still turns its counter into a yes/no switch (rule 58)', () => {
  const pairs = pairsOf('commence');
  assert.ok(pairs.length >= 2, 'towels and cleaning must each declare their two languages');
  const isSwitch = (title) => pairs.some(([fr, en]) => matchers.commence(matchers.normalise(title), fr, en));
  for (const title of ['Linge de toilette', 'Bathroom linen', 'Ménage', 'Cleaning']) {
    assert.ok(isSwitch(title), `« ${title} » keeps a quantity counter, where the guest can only answer yes or no`);
  }
  // Bed linen is sold by quantity: it must NOT be caught by the towel rule in either language.
  for (const title of ['Linge de lit', 'Bed linen']) {
    assert.ok(!isSwitch(title), `« ${title} » lost its quantity counter`);
  }
});
