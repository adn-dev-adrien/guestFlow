/**
 * specs/site-english-version.md rules 52 and 53 — an English page keeps the structure of its French
 * twin, and the pictograms keep their icons.
 *
 * `gf_seo_pages()` is indexed on FRENCH slugs. An English page carries its own — `la-granja-gite`,
 * `the-estate` — so `gf_seo_current_config()` returned null and everything hanging off it vanished
 * without a word. Measured on the published site on 2026-09-25: the two English lodging pages lost
 * the drawer's stylesheet AND its script (the floating button fell out of `position: fixed` and back
 * into the page flow, the drawer spilled into the content), the seven icons under the hero, the
 * breadcrumb on all five inner pages, and the `VacationRental` / `Campground` node — the one that
 * describes the lodging as rentable.
 *
 * The trap in fixing it: the `<head>` reads `title` and `description` from that same config, so a
 * blanket fallback would publish the FRENCH title on an English page. Hence two resolvers and a
 * whitelist — and hence the guard below that the head still uses the text-bearing one.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const MU = path.join(__dirname, '..', '..', '..', 'integrations', 'wordpress', 'solio-site', 'mu-plugins');
const read = (f) => fs.readFileSync(path.join(MU, f), 'utf8');
const head = read('gf-seo-head.php');
const schema = read('gf-seo-schema.php');
const resa = read('gf-seo-reservation.php');
const caps = read('gf-caps.php');
const i18n = read('gf-i18n.php');

/**
 * The same source with its comments removed.
 *
 * Every assertion about « does this call X? » runs on this, never on the raw file: the comments
 * explaining why a call was REPLACED name the old call, and a guard that reads them reports a defect
 * that is not there. Paid for twice already.
 */
function code(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** One PHP function's body, brace-balanced. */
function body(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start > 0, `${name}() not found — the file was restructured`);
  const open = src.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  throw new Error(`${name}() is not balanced`);
}

test('the drawer decides to load its styles from the structural config (rule 52)', () => {
  const guard = code(body(resa, 'gf_resa_page_concernee'));
  assert.ok(
    /gf_seo_config_structure/.test(guard),
    'the enqueue guard resolves by French slug: the English lodging pages get no drawer CSS or JS',
  );
  assert.ok(
    !/gf_seo_current_config/.test(guard),
    'gf_seo_current_config() cannot see an English slug — this guard must not use it',
  );
});

test('the accommodation node and the breadcrumb use the structural config (rule 52)', () => {
  const fil = body(schema, 'gf_seo_schema_fil');
  assert.ok(/gf_seo_config_structure/.test(fil), 'the breadcrumb resolves by French slug, so English loses it');
  // The graph builder is not a named function this helper can isolate; the file-level check is that
  // no `gf_seo_current_config()` call is left in the schema at all.
  assert.ok(
    !/gf_seo_current_config\s*\(/.test(code(schema)),
    'a gf_seo_current_config() call is left in the schema: that branch is blind to English pages',
  );
});

test('the head keeps reading the config that carries the page\'s own text (rule 52)', () => {
  // The whole point of two resolvers. If the head ever switched to the structural one it would be
  // handed the FRENCH twin's config — and publish a French <title> on an English page.
  for (const fn of ['gf_seo_document_title', 'gf_seo_description', 'gf_seo_render_head']) {
    const b = code(body(head, fn));
    assert.ok(
      !/gf_seo_config_structure/.test(b),
      `${fn}() reads the structural config: the French title and description would leak into the English head`,
    );
  }
});

test('the structural config hands back structure, never prose (rule 52)', () => {
  const b = body(head, 'gf_seo_config_structure');
  const whitelist = /\$permis\s*=\s*array\(([^)]*)\)/.exec(b);
  assert.ok(whitelist, 'no whitelist found — the function must not return the whole entry');
  const keys = [...whitelist[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  assert.ok(keys.includes('lodging'), 'the lodging is what the drawer and the schema need');
  for (const forbidden of ['title', 'description']) {
    assert.ok(
      !keys.includes(forbidden),
      `'${forbidden}' is whitelisted: the French ${forbidden} would reach the English page`,
    );
  }
});

test('every breadcrumb label has its English twin (rule 52)', () => {
  const table = body(head, 'gf_seo_pages');
  const fr = (table.match(/'fil'\s*=>/g) || []).length;
  const en = (table.match(/'fil_en'\s*=>/g) || []).length;
  assert.ok(fr > 0, 'no breadcrumb label found at all');
  assert.strictEqual(en, fr, `${fr - en} breadcrumb label(s) with no English`);
});

test('a breadcrumb link is never built from the French slug on an English page (rule 52)', () => {
  const b = body(schema, 'gf_seo_fil_lien');
  assert.ok(/gf_chemins_traduits/.test(b), 'the translated-path table is what knows the English slugs');
  assert.ok(
    !/get_option\s*\(\s*'home'\s*\)/.test(code(schema)),
    "get_option('home') holds the internal IP — the site URL comes from WP_HOME at each request",
  );
});

test('the pictogram under the hero is found in both languages (rule 53)', () => {
  // The PHP walks its rules in order and takes the first word that appears in the lowercased label.
  // Mirrored here so the guard tests the BEHAVIOUR: « does this badge get an icon? ». Checking that a
  // rule merely holds an ASCII word proved worthless — « chambre » is ASCII too.
  const rules = [...code(body(caps, 'gf_caps_icone_pour'))
    .matchAll(/'(badge-[a-z-]+)'\s*=>\s*array\(([^)]*)\)/g)]
    .map(([, icon, words]) => [icon, [...words.matchAll(/'([^']+)'/g)].map((m) => m[1])]);
  assert.ok(rules.length >= 8, `only ${rules.length} icon rules read — the extraction broke`);

  const iconFor = (label) => {
    const t = label.toLowerCase();
    for (const [icon, words] of rules) {
      for (const word of words) if (t.includes(word.toLowerCase())) return icon;
    }
    return '';
  };

  // The badges as the published pages actually write them, both languages.
  const expected = [
    ['10 personnes — plus sur demande', 'badge-people'],
    ['10 guests — more on request', 'badge-people'],
    ['4 chambres', 'badge-door'],
    ['4 bedrooms', 'badge-door'],
    ['4 lits doubles', 'badge-bed-double'],
    ['4 double beds', 'badge-bed-double'],
    ['5 lits simples', 'badge-bed-single'],
    ['5 single beds', 'badge-bed-single'],
    ['2 salles d’eau', 'badge-shower'],
    ['2 shower rooms', 'badge-shower'],
    ['2 WC', 'badge-wc'],
    ['2 toilets', 'badge-wc'],
    ['3 étoiles', 'badge-stars'],
    ['3 stars', 'badge-stars'],
    ['tente safari', 'badge-tent'],
    ['safari tent', 'badge-tent'],
  ];
  const wrong = expected
    .map(([label, icon]) => [label, icon, iconFor(label)])
    .filter(([, icon, got]) => got !== icon);
  assert.deepStrictEqual(
    wrong.map(([label, icon, got]) => `${label} → ${got || 'NO ICON'} (expected ${icon})`),
    [],
  );
});

test('both language redirects refuse to be cached (rule 51)', () => {
  // The token cleanup was fixed first and this one was missed, which is how a browser kept serving
  // « /en/la-granja-gite/ -> /la-granja/ » from its cache after the choice had become English.
  for (const fn of ['gf_bascule_automatique', 'gf_nettoie_jeton_langue']) {
    assert.ok(
      /nocache_headers\s*\(\s*\)/.test(body(i18n, fn)),
      `${fn}() redirects per visitor without no-store: a browser will cache one visitor's language`,
    );
  }
});
