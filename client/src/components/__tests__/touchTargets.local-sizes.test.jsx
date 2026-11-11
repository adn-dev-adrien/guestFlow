// specs/ds-components.md rule 21 (amended 2026-10-18) — a page's own dense size must not undo the
// theme's 44 px on touch. « Suivi financier » at 390 px showed six 39 px toggles (Exercice, Mois,
// Personnalisée, Réservations, Nuits, CA des nuits): a local `minHeight: 36` beat the theme rule
// (review of PR #700, finding 1).
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { render } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';
import PeriodSelector from '../PeriodSelector';

const SRC = path.resolve(__dirname, '../..');

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === '__tests__' ? [] : sourceFiles(full);
    return /\.(jsx?|tsx?)$/.test(e.name) ? [full] : [];
  });
}

test('rule 21 — the period toggles keep 44 px on touch despite their dense desktop height', () => {
  render(
    <ThemeProvider theme={theme}>
      <PeriodSelector kind="fy" months={[]} onChange={() => {}} />
    </ThemeProvider>,
  );
  const group = document.querySelector('.MuiToggleButtonGroup-root');
  const own = [...group.classList].filter((c) => c.startsWith('css-')).pop();
  const css = [...document.querySelectorAll('style')].map((s) => s.textContent).join('\n');
  expect(css).toMatch(new RegExp(`@media \\(pointer: coarse\\)\\{\\.${own} \\.MuiToggleButton-root\\{min-height:\\s*44px`));
});

test('rule 21 — no control in the client sets a height under 44 px without restoring 44 px on touch', () => {
  const offenders = [];
  for (const file of sourceFiles(SRC)) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (!/<(ToggleButtonGroup|ToggleButton|Button|IconButton)\b|'& \.Mui(ToggleButton|Button|IconButton)-root'/.test(line)) return;
      const dense = [...line.matchAll(/minHeight:\s*(\d+)/g)].some((m) => Number(m[1]) < 44);
      if (dense && !/pointer: coarse/.test(line)) offenders.push(`${path.relative(SRC, file)}:${i + 1}`);
    });
  }
  expect(offenders).toEqual([]);
});
