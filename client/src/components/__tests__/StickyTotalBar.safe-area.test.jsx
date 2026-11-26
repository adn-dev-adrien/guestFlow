// specs/planning/mobile-dashboard-exercise-cash.md rules 1-2 — the sticky total keeps its figures clear of the rounded corners and the home
// indicator: padding from `env(safe-area-inset-*)`, never under 16 px on the sides, unchanged where the device has no inset.
import React from 'react';
import { render } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';
import StickyTotalBar from '../StickyTotalBar';
import { setViewport, resetViewport } from './viewportFixture';

afterEach(resetViewport);

// jsdom drops `env()` values from computed styles, so the rules emotion injected are read as text.
const rulesOf = () => Array.from(document.querySelectorAll('style')).map((s) => s.textContent).join('\n');
const bar = (props) => render(
  <ThemeProvider theme={theme}>
    <StickyTotalBar label="Vous percevez" amount={829.42} sheetTitle="Résumé tarifaire" {...props}><p>Détail</p></StickyTotalBar>
  </ThemeProvider>,
);

test('the bottom padding adds the home indicator\'s inset to the usual 10 px', () => {
  setViewport(390);
  bar();
  expect(rulesOf()).toMatch(/padding-bottom:\s*calc\(10px \+ env\(safe-area-inset-bottom,\s*0px\)\)/);
});

test('the sides keep 16 px at least and grow with the notch\'s inset', () => {
  setViewport(390);
  bar();
  const css = rulesOf();
  expect(css).toMatch(/padding-left:\s*max\(16px,\s*env\(safe-area-inset-left,\s*0px\)\)/);
  expect(css).toMatch(/padding-right:\s*max\(16px,\s*env\(safe-area-inset-right,\s*0px\)\)/);
});

test('a bar that bleeds past the page padding follows the page\'s own padding, insets included', () => {
  setViewport(390);
  bar({ bleed: { x: { xs: 1.5, sm: 2, md: 3 }, bottom: { xs: 2, md: 3 } } });
  const css = rulesOf();
  expect(css).toMatch(/--gf-bleed-l:\s*max\(12px,\s*env\(safe-area-inset-left,\s*0px\)\)/);
  expect(css).toMatch(/margin-left:\s*calc\(-1 \* var\(--gf-bleed-l\)\)/);
  expect(css).toMatch(/width:\s*calc\(100% \+ var\(--gf-bleed-l\) \+ var\(--gf-bleed-r\)\)/);
  // The page's own padding, 24 px from md, stays the bar's side padding there (desktop unchanged).
  expect(css).toMatch(/padding-left:\s*max\(24px,\s*env\(safe-area-inset-left,\s*0px\)\)/);
});
