// specs/ds-components.md rule 19 (amended 2026-10-18) — with a `center`, the actions mirror the title's
// share only while the centre sits beside the title. On a phone the centre is hidden and under 720 px
// it takes its own row: the actions kept half the bar and « Planning ressources » read « Planning
// ressou… » with 120 px free (review of PR #700, finding 2). jsdom does no layout: these tests pin
// the emitted styles; the e2e spec `mobile/narrow-bar-and-touch-targets.spec.js` measures the title.
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';
import PageActionBar from '../PageActionBar';

function renderBar(props = {}) {
  render(
    <MemoryRouter>
      <ThemeProvider theme={theme}>
        <PageActionBar title="Planning ressources" titleOnXs actionsBefore={[{ icon: <span>+</span>, tooltip: 'Nouvelle réservation', onClick: () => {} }]} {...props} />
      </ThemeProvider>
    </MemoryRouter>,
  );
  const actions = screen.getByTestId('page-action-bar-actions');
  const own = [...actions.classList].filter((c) => c.startsWith('css-')).pop();
  const css = [...document.querySelectorAll('style')].map((s) => s.textContent).join('\n');
  return { actions, own, css };
}

test('rule 19 — on a phone the actions take only their own width beside the title, centre or not', () => {
  const { own, css } = renderBar({ center: <span>Semaine</span> });
  expect(css).toMatch(new RegExp(`@media \\(min-width:0px\\)\\{\\.${own}\\{[^}]*;flex:0 1 auto;`));
});

test('rule 19 — from sm the actions balance the centre, except on a bar under 720 px', () => {
  const { own, css } = renderBar({ center: <span>Semaine</span> });
  const sm = css.search(new RegExp(`@media \\(min-width:600px\\)\\{\\.${own}\\{[^}]*;flex:1 1 0;`));
  const narrow = css.search(new RegExp(`@container \\(max-width: ?719\\.98px\\)\\{\\.${own}\\{[^}]*;flex:0 1 auto;`));
  expect(sm).toBeGreaterThan(-1);
  // Same specificity: the container rule wins because it comes later.
  expect(narrow).toBeGreaterThan(sm);
});

test('rule 19 — without a centre the actions never claim more than their width', () => {
  const { own, css } = renderBar();
  expect(css).not.toMatch(new RegExp(`\\.${own}\\{[^}]*;flex:1 1 0;`));
});
