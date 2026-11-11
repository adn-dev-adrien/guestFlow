/**
 * specs/site-english-version.md rule 56 — the language reaches the browser's own calls.
 *
 * A REST request carries no page, so Polylang has nothing to read: the plugin resolved the site's own
 * locale and asked GuestFlow in French, then cached the answer under that key. The English drawer
 * therefore listed its options, its price units and its refusals in French while everything rendered
 * with the page was already translated. Measured on the published site on 2026-09-25.
 *
 * The site's own price retouches are guarded next to the site's mu-plugins, which left this
 * repository (phase P, §3.G).
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..', '..', 'integrations', 'wordpress');
const runtime = fs.readFileSync(path.join(ROOT, 'guestflow-booking', 'assets', 'runtime.js'), 'utf8');
const proxy = fs.readFileSync(path.join(ROOT, 'guestflow-booking', 'includes', 'class-gf-rest-proxy.php'), 'utf8');
const language = fs.readFileSync(path.join(ROOT, 'guestflow-booking', 'includes', 'class-gf-language.php'), 'utf8');

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
