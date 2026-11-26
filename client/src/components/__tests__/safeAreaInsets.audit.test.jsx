// specs/planning/mobile-dashboard-exercise-cash.md rules 1, 3-4 — with `viewport-fit=cover` the app bar, the page bar, the main
// area, the support bar and full-screen dialogs pad with the safe-area insets, and every inset falls back to 0 so a
// device without one (desktop, Android) lays out exactly as before.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import theme from '../../theme';

const source = (relative) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
const INSET = /env\(safe-area-inset-(top|right|bottom|left)([^)]*)\)/g;

test('rule 1: the page declares viewport-fit=cover', () => {
  expect(source('../../../index.html')).toMatch(/<meta name="viewport" content="[^"]*viewport-fit=cover/);
});

test('rule 3: a full-screen dialog keeps its content clear of the four insets, from the theme alone', () => {
  const paper = theme.components.MuiDialog.styleOverrides.paper['&.MuiDialog-paperFullScreen'];
  expect(paper.paddingTop).toBe('env(safe-area-inset-top, 0px)');
  expect(paper.paddingRight).toBe('env(safe-area-inset-right, 0px)');
  expect(paper.paddingBottom).toBe('env(safe-area-inset-bottom, 0px)');
  expect(paper.paddingLeft).toBe('env(safe-area-inset-left, 0px)');
});

test.each([
  ['App.jsx', '../../App.jsx', ['top', 'left']],
  ['PageActionBar.jsx', '../PageActionBar.jsx', ['top']],
  ['SupportSessionBar.jsx', '../SupportSessionBar.jsx', ['bottom', 'left', 'right']],
  // Its side insets are built per edge and checked by StickyTotalBar.safe-area.test.jsx (rule 2).
  ['StickyTotalBar.jsx', '../StickyTotalBar.jsx', ['bottom']],
])('rule 3: %s pads with the insets it sits against', (_name, path, sides) => {
  const used = new Set([...source(path).matchAll(INSET)].map((m) => m[1]));
  sides.forEach((side) => expect(used).toContain(side));
});

test.each([
  ['App.jsx', '../../App.jsx'],
  ['PageActionBar.jsx', '../PageActionBar.jsx'],
  ['SupportSessionBar.jsx', '../SupportSessionBar.jsx'],
  ['StickyTotalBar.jsx', '../StickyTotalBar.jsx'],
  ['theme.js', '../../theme.js'],
])('rule 4: every inset in %s falls back to 0, so a device without one is unchanged', (_name, path) => {
  const insets = [...source(path).matchAll(INSET)];
  expect(insets.length).toBeGreaterThan(0);
  insets.forEach((m) => expect(m[2].trim()).toBe(', 0px'));
});
