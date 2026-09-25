/**
 * specs/site-english-version.md rules 50 and 51 — what the visitor chose outranks what their
 * browser says, and the address that records the choice is never cached.
 *
 * Both defects shipped together and hid each other. The switcher's URL answered a 301 with no cache
 * header, so the browser kept it for good and the second click never reached the server: the cookie
 * was written once and never again. And the cookie only ever made the auto-switch return early — it
 * suppressed the guess instead of enforcing the choice — so as soon as no cookie was seen, a French
 * browser was sent back to French. Read together: « I pick English, I change page, I am French
 * again ».
 *
 * This is a PHP mu-plugin with no runner here. What the suite can do is refuse the shape: a cookie
 * that only short-circuits, a permanent redirect on an address whose whole purpose is a side effect.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const MU = path.join(__dirname, '..', '..', '..', 'integrations', 'wordpress', 'solio-site', 'mu-plugins');
const i18n = fs.readFileSync(path.join(MU, 'gf-i18n.php'), 'utf8');

/** One function's body, so a match elsewhere in the file cannot stand in for it. */
function body(name) {
  const start = i18n.indexOf(`function ${name}(`);
  assert.ok(start > 0, `${name}() not found — the file was restructured`);
  const open = i18n.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < i18n.length; i += 1) {
    if (i18n[i] === '{') depth += 1;
    else if (i18n[i] === '}') {
      depth -= 1;
      if (depth === 0) return i18n.slice(open, i + 1);
    }
  }
  throw new Error(`${name}() is not balanced`);
}

test('the stored choice decides the language, the browser only guesses (rule 50)', () => {
  const auto = body('gf_bascule_automatique');

  assert.ok(
    /gf_langue_choisie\s*\(/.test(auto),
    'the auto-switch never asks what the visitor chose',
  );
  assert.ok(
    auto.indexOf('gf_langue_choisie') < auto.indexOf('gf_langue_du_navigateur'),
    'the browser header is consulted before the stored choice — the guess would win',
  );
  assert.ok(
    /\$choisie\s*\?\s*\$choisie\s*:\s*gf_langue_du_navigateur/.test(auto.replace(/null\s*!==\s*/g, '')),
    'the browser header must be the fallback, not an equal signal',
  );
});

test('a cookie is never a reason to stop, only a reason to redirect (rule 50)', () => {
  const auto = body('gf_bascule_automatique');
  // The defect in one line: `if (isset($_COOKIE[...])) { return; }` suppressed the guess without
  // enforcing the choice, so a French browser reclaimed the visitor on the next French URL.
  assert.ok(
    !/isset\s*\(\s*\$_COOKIE\s*\[\s*GF_COOKIE_LANGUE\s*\]\s*\)\s*\)\s*\{\s*return\s*;/.test(auto),
    'the auto-switch still returns early when a cookie exists: the choice is ignored, not applied',
  );
});

test('an unreadable cookie decides nothing (rule 50)', () => {
  const reader = body('gf_langue_choisie');
  assert.ok(
    /in_array\s*\(\s*\$brut\s*,\s*array\s*\(\s*'fr'\s*,\s*'en'\s*\)/.test(reader),
    'the cookie value is not checked against the two languages the site speaks',
  );
  assert.ok(
    !/gf_langue_normalisee/.test(reader),
    'normalising the cookie turns junk into « fr » and forces French on a visitor who asked nothing',
  );
});

test('the address that records the choice is never cached (rule 51)', () => {
  const clean = body('gf_nettoie_jeton_langue');
  assert.ok(
    /wp_redirect\s*\([^)]*,\s*302\s*\)/.test(clean),
    'the token cleanup must answer 302: a cached 301 means the cookie is written once and never again',
  );
  assert.ok(
    !/wp_redirect\s*\([^)]*,\s*301\s*\)/.test(clean),
    'the token cleanup still answers 301 — the browser will keep it and skip the server',
  );
  assert.ok(
    /nocache_headers\s*\(\s*\)/.test(clean),
    'a 302 with no cache header is still cacheable by a heuristic; say no-store explicitly',
  );
});

test('the switcher emits a token no cached redirect can match (rule 55)', () => {
  // The cleanup answered a cacheable 301 for a few hours, and a browser keeps a 301 for good: for
  // those visitors « ?gf_set_lang= » never reaches the server again, so the cookie is never written
  // and the next page hands them back to their browser's language. No header can purge what is
  // already cached — only an address the browser has never seen escapes it.
  const emitted = /add_query_arg\(\s*([A-Z_]+)\s*,\s*\$code/.exec(i18n);
  assert.ok(emitted, 'the switcher no longer builds its link with add_query_arg — check this guard');
  assert.strictEqual(
    emitted[1],
    'GF_JETON_LANGUE',
    'the switcher must emit the current token constant, not a literal',
  );

  const current = /const GF_JETON_LANGUE\s*=\s*'([a-z_]+)'/.exec(i18n);
  const legacy = /const GF_JETON_LANGUE_ANCIEN\s*=\s*'([a-z_]+)'/.exec(i18n);
  assert.ok(current && legacy, 'both token names must be declared');
  assert.notStrictEqual(
    current[1],
    legacy[1],
    'the emitted token is the one browsers cached: it has to differ from the legacy one',
  );

  // The old one keeps working, for links already shared.
  const reader = body('gf_jeton_langue_demande');
  assert.ok(
    /GF_JETON_LANGUE\b/.test(reader) && /GF_JETON_LANGUE_ANCIEN/.test(reader),
    'both tokens must still be accepted, or an already-shared link stops switching the language',
  );
});
