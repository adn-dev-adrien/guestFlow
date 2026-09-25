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
