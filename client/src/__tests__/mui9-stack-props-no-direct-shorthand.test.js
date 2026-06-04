import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test, expect } from 'vitest';

// 2026-06-05 regression net for the silent MUI v9 layout breakage.
//
// In MUI v6+ the `<Stack>` component stopped honouring the CSS shorthand props
// (`justifyContent`, `alignItems`, `flexWrap`) as direct JSX attributes. Pass
// them as a prop and they're silently dropped at runtime — the rendered
// element gets `justify-content: normal`, `align-items: normal`, etc.
// `direction` and `spacing` still work as props (they're explicit Stack API
// fields).
//
// The migration from MUI 5 → 9 (PR #114) did NOT codemod these. The breakage
// stayed invisible for weeks because most layouts had a `<Box flex={1}>` as
// the first child, which spreads space naturally regardless of justifyContent
// — so the activation Switch was still on the right edge of every option
// card even with the prop dropped. The polish in PR #121 (small Switch + no
// label + no flexGrow on Total chip) shrank the right-side cluster enough
// that the missing space-between became visually obvious on the bottom row
// of the Extras section.
//
// This test walks `client/src/**/*.{js,jsx,ts,tsx}` (skipping every
// `__tests__/` folder) and fails on any `<Stack … justifyContent="…">`,
// `<Stack … alignItems="…">` or `<Stack … flexWrap="…">` direct-prop usage.
// All three MUST be passed via `sx={{ … }}` instead.

describe('No <Stack> JSX with direct CSS-shorthand props (justifyContent / alignItems / flexWrap)', () => {
  test('every Stack passes layout shorthand via sx, not as a direct prop', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const srcRoot = path.resolve(here, '..');

    function* walk(dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
          yield* walk(full);
        } else if (entry.isFile() && /\.(jsx?|tsx?)$/.test(entry.name) && !/\.test\.[jt]sx?$/.test(entry.name)) {
          yield full;
        }
      }
    }

    // Multi-line tolerant: a `<Stack` opening followed by any chars (incl.
    // newlines via the `s` flag), up to the first `>` that isn't part of an
    // attribute value, with one of the three shorthand prop names appearing
    // before the closing `>`.
    const RE_STACK_OPENING = /<Stack\b([^>]|\n)*?>/g;
    const SHORTHAND_NAMES = ['justifyContent', 'alignItems', 'flexWrap'];

    const offenders = [];
    for (const file of walk(srcRoot)) {
      const content = fs.readFileSync(file, 'utf8');
      const matches = content.match(RE_STACK_OPENING) || [];
      for (const opening of matches) {
        for (const propName of SHORTHAND_NAMES) {
          // Look for `propName="…"` as a top-level attribute (not embedded
          // inside an `sx={{ … }}` block, which uses `:` not `=`).
          const propRe = new RegExp(`\\b${propName}\\s*=\\s*"`);
          if (propRe.test(opening)) {
            offenders.push({ file: path.relative(srcRoot, file), opening: opening.slice(0, 120), prop: propName });
            break;
          }
        }
      }
    }

    if (offenders.length > 0) {
      // Surface every offender in the diff so the failing test points the
      // fixer straight to each spot.
      // eslint-disable-next-line no-console
      console.error('Stack shorthand-prop offenders:', JSON.stringify(offenders, null, 2));
    }
    expect(offenders).toEqual([]);
  });
});
