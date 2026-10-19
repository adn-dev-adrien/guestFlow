/**
 * specs/wordpress-plugin.md rule 29 and specs/wp-booking-widget-redesign.md rule 29 (UI/UX review
 * 2026-10-18, decisions 16 and 2) — the booking engine's stylesheet, read as text: one accent
 * drives every colour, Maison fir green by default, and no hover style reaches a touch screen.
 *
 * The plugin's CSS is not executed by any suite; what this one can do is refuse the shapes that
 * brought back the stale MUI blue and the washed-out departure day.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const CSS = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'integrations', 'wordpress', 'guestflow-booking', 'assets', 'style.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

/** Top-level blocks as [prelude, body], at-rules kept whole. */
function blocks(css) {
  const out = [];
  let depth = 0;
  let start = 0;
  let prelude = '';
  for (let i = 0; i < css.length; i++) {
    if (css[i] === '{') {
      if (depth === 0) { prelude = css.slice(start, i).trim(); start = i + 1; }
      depth++;
    } else if (css[i] === '}') {
      depth--;
      if (depth === 0) { out.push([prelude, css.slice(start, i)]); start = i + 1; }
    }
  }
  return out;
}

test('wordpress-plugin rule 29: the accent is the site\'s, then the theme\'s, then Maison fir green', () => {
  assert.match(CSS, /--gfb-accent:\s*var\(--gf-accent,\s*var\(--wp--preset--color--primary,\s*#2F5D46\)\)/);
  assert.ok(!/#1976d2/i.test(CSS), 'the stale MUI blue is back');
});

test('wordpress-plugin rule 29: no colour outside the token declarations', () => {
  const offenders = [];
  for (const [prelude, body] of blocks(CSS)) {
    if (/^:where\(\.gf-block/.test(prelude) || /^@supports/.test(prelude)) continue;
    // Literal colours are allowed only as white/transparent surfaces and the translucent bar.
    const colours = body.match(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/gi) || [];
    for (const c of colours) {
      if (/^#fff(fff)?$/i.test(c) || /^#FFFBFA$/i.test(c) || /^rgba\(255,\s*255,\s*255/.test(c)) continue;
      offenders.push(`${prelude} → ${c}`);
    }
  }
  assert.deepStrictEqual(offenders, []);
});

test('wordpress-plugin rule 29: the tokens are declared on every engine element, not only on the block', () => {
  // The Solio drawer moves the engine's children out of `.gf-block` (site-booking-drawer rule 12).
  assert.match(CSS, /:where\(\.gf-block,\s*\[class\*="gf-"\]\)\s*\{[^}]*--gfb-accent/);
  assert.ok(!/\.gf-block\s*\{[^}]*--gf-accent\s*:/.test(CSS), 'a default on .gf-block would override the drawer panel');
});

test('wp-booking-widget-redesign rule 29: every :hover lives inside @media (hover: hover) and (pointer: fine)', () => {
  const stray = [];
  for (const [prelude, body] of blocks(CSS)) {
    if (/^@media\s*\(hover:\s*hover\)\s*and\s*\(pointer:\s*fine\)/.test(prelude)) continue;
    if (/:hover/.test(prelude) || /:hover/.test(body)) stray.push(prelude);
  }
  assert.deepStrictEqual(stray, []);
});

test('wp-booking-widget-redesign rule 29: the chosen edge outranks the hover tint', () => {
  assert.match(CSS, /button\.gf-cal-day:not\(:disabled\):not\(\.gf-edge\):hover/);
});
