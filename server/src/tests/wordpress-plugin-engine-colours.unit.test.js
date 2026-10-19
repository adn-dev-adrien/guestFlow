/**
 * specs/wordpress-plugin.md rule 29 and specs/wp-booking-widget-redesign.md rules 29 and 32 (UI/UX
 * review 2026-10-18, decisions 16, 2 and 4) — the booking engine's stylesheet, read as text: one
 * accent drives every colour, Maison fir green by default, contrast holds, nothing styles the
 * site's own `gf-*` elements, no hover style reaches a touch screen, and the bar is for phones.
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

test('wordpress-plugin rule 29: the tokens are declared on the block and on each engine child, never site-wide', () => {
  // The Solio drawer moves the engine's children out of `.gf-block` (site-booking-drawer rule 12).
  assert.match(CSS, /:where\(\.gf-block,\s*\.gf-engine\)\s*\{[^}]*--gfb-accent/);
  assert.ok(!/\.gf-block\s*\{[^}]*--gf-accent\s*:/.test(CSS), 'a default on .gf-block would override the drawer panel');
  // `[class*="gf-"]` matched the Solio site's own gf-hero, gf-tile… and killed its tap feedback.
  assert.ok(!/\[class\*=/.test(CSS), 'an attribute selector on gf- reaches the whole site');
});

/** Every selector of every rule, at-rules opened. */
function selectors(css) {
  const out = [];
  for (const [prelude, body] of blocks(css)) {
    if (prelude.startsWith('@')) { out.push(...selectors(body)); continue; }
    prelude.split(',').forEach((sel) => out.push(sel.trim()));
  }
  return out;
}

test('wordpress-plugin rule 29: no selector styles a bare .gf-btn, .gf-section or .gf-cta — the Solio site has its own', () => {
  const bare = selectors(CSS).filter((sel) => {
    const compounds = sel.split(/\s*[ >+~]\s*/).filter(Boolean);
    const last = compounds[compounds.length - 1] || '';
    if (!/\.gf-(btn|section|cta)(?![\w-])/.test(last)) return false;
    // Scoped by an engine ancestor, or the element is itself an engine child.
    const scoped = compounds.length > 1 && /\.gf-(block|engine|booking|prop-card)(?![\w-])/.test(compounds.slice(0, -1).join(' '));
    return !scoped && !/\.gf-engine(?![\w-])/.test(last);
  });
  assert.deepStrictEqual(bare, []);
});

const hexRgb = (hex) => {
  const h = hex.replace('#', '');
  const f = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16));
};
const lum = (rgb) => {
  const [r, g, b] = rgb.map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const token = (name) => {
  const m = CSS.match(new RegExp(`--gfb-${name}:\\s*(#[0-9a-fA-F]{3,6})`));
  assert.ok(m, `no hex default for --gfb-${name}`);
  return hexRgb(m[1]);
};
const WHITE = [255, 255, 255];

test('wordpress-plugin rule 29: the default tokens reach WCAG AA (4.5 : 1)', () => {
  const fir = hexRgb('#2F5D46');
  assert.ok(contrast(fir, WHITE) >= 4.5, 'white on the default fill');
  assert.ok(contrast(token('warn'), token('warn-soft')) >= 4.5, 'warning note');
  assert.ok(contrast(token('ok'), token('ok-soft')) >= 4.5, 'offer note');
  assert.ok(contrast(token('error'), WHITE) >= 4.5, 'error text');
  assert.ok(contrast(token('error'), token('error-soft')) >= 4.5, 'error on its tint');
  assert.ok(contrast(hexRgb('#6E6A5E'), WHITE) >= 4.5, 'muted text');
});

test('wordpress-plugin rule 29: a light accent is darkened under white text — Solio ocre included', () => {
  const mix = CSS.match(/--gfb-fill:\s*color-mix\(in srgb, var\(--gfb-accent\) (\d+)%, #000\)/);
  assert.ok(mix, 'the fill is the accent mixed with black');
  const share = Number(mix[1]) / 100;
  const ocre = hexRgb('#B87B2A');
  assert.ok(contrast(ocre, WHITE) < 4.5, 'the raw ocre fails, which is the point');
  const filled = ocre.map((v) => Math.round(v * share));
  assert.ok(contrast(filled, WHITE) >= 4.5, `ocre at ${mix[1]} % reaches ${contrast(filled, WHITE).toFixed(2)}`);
  assert.match(CSS, /--gfb-fill:\s*oklch\(from var\(--gfb-accent\) min\(l, 0\.5\d\) c h\)/);
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

/** [ids, classes + pseudo-classes + attributes, types] of one selector, :not() counted by its argument. */
function specificity(sel) {
  let s = sel.replace(/:not\(([^)]*)\)/g, ' $1');
  const ids = (s.match(/#[\w-]+/g) || []).length;
  const classes = (s.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) || []).length;
  s = s.replace(/\.[\w-]+|\[[^\]]+\]|::?[\w-]+|#[\w-]+/g, ' ');
  const types = (s.match(/[a-z][\w-]*/gi) || []).length;
  return [ids, classes, types];
}
const beats = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

test('wp-booking-widget-redesign rule 29: the stay beats the legacy gf-booking.php hover still printed on the Solio Pi', () => {
  const legacyHover = specificity('.gf-cal-day:hover:not(:disabled)');
  assert.deepStrictEqual(legacyHover, [0, 3, 0]);
  for (const cls of ['gf-edge', 'gf-range']) {
    const own = selectors(CSS).filter((sel) => new RegExp(`button\\.gf-cal-day[^ ]*\\.${cls}(?![\\w-])`).test(sel) && !/:hover|:active|:focus/.test(sel));
    assert.ok(own.length > 0, `no rule paints .${cls}`);
    own.forEach((sel) => assert.ok(beats(specificity(sel), legacyHover) > 0, `${sel} loses to the legacy hover`));
  }
});

test('wp-booking-widget-redesign rule 32: the bottom bar is for phones — coarse pointer or narrow viewport', () => {
  const phone = blocks(CSS).find(([prelude]) => /^@media\s*\(pointer:\s*coarse\),\s*\(max-width:\s*600px\)/.test(prelude));
  assert.ok(phone, 'no phone media block');
  assert.match(phone[1], /\.gf-booking > \.gf-bar\s*\{[^}]*display:\s*flex/);
  const elsewhere = blocks(CSS).filter(([prelude]) => prelude !== phone[0]).map(([p, b]) => p + '{' + b + '}').join('\n');
  assert.ok(!/\.gf-bar\s*\{[^}]*display:\s*flex/.test(elsewhere), 'the bar shows outside the phone block');
});
