/**
 * specs/site-english-version.md rule 54 — the hero slides under the transparent header, on every
 * page.
 *
 * `.gf-hero` carries `margin-top:-86px` so the header floats over the image instead of sitting on
 * top of it. WordPress's own block layout then posts
 * `:root :where(.is-layout-constrained) > :first-child{ margin-block-start:0 }`, which cancels that
 * pull whenever the hero OPENS the content — the home page. On the lodging pages it survived only by
 * accident: the breadcrumb precedes the hero, so the hero is not the first child. The home page's
 * image was therefore pushed below the bar and cropped by the same amount.
 *
 * The fix is a matter of specificity, not of stylesheet order, and that is what this guards.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const style = fs.readFileSync(
  path.join(__dirname, '..', '..', '..', 'integrations', 'wordpress', 'solio-site', 'mu-plugins', 'gf-site-style.php'),
  'utf8',
);

test('the hero keeps its pull even when it opens the content (rule 54)', () => {
  assert.ok(
    /\.gf-hero:first-child/.test(style),
    'nothing targets the hero as a first child: WordPress zeroes its margin and the image drops below the header',
  );
  const rule = /:root :where\(\.is-layout-constrained\) > \.gf-hero:first-child[^{]*\{([^}]*)\}/.exec(style);
  assert.ok(rule, 'the override must outrank :root :where(.is-layout-constrained) > :first-child');
  assert.ok(
    /margin-block-start\s*:\s*-86px/.test(rule[1]),
    'WordPress writes margin-block-start, so restating margin-top alone loses the cascade',
  );
});
