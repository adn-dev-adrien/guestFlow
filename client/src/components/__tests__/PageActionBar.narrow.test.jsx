// specs/ds-components.md rules 19-20 — review #8, m-7: on a narrow bar the title read « P. » or
// « Syst… », the subtitle took its room and Save/Cancel stacked in a column. The bar now keeps a
// readable title, lets the subtitle wrap, keeps the actions in a row and sizes every button 44 × 44.
// jsdom does no layout: these tests pin the styles that make it so; the e2e spec
// `ds/page-action-bar-narrow.spec.js` measures them in a real browser.
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';
import PageActionBar from '../PageActionBar';

function renderBar(props = {}) {
  return render(
    <MemoryRouter>
      <ThemeProvider theme={theme}>
        <PageActionBar title="Système et mises à jour" onSave={() => {}} onCancel={() => {}} {...props} />
      </ThemeProvider>
    </MemoryRouter>,
  );
}

test('rule 19 — the title ends in an ellipsis on every width and keeps its full text in a tooltip', () => {
  renderBar({ titleOnXs: true });
  const title = screen.getByRole('heading', { name: 'Système et mises à jour' });
  const style = getComputedStyle(title);
  expect(style.textOverflow).toBe('ellipsis');
  expect(style.whiteSpace).toBe('nowrap');
  expect(title).toHaveAttribute('title', 'Système et mises à jour');
});

test('rule 19 — the subtitle sits in its own wrapping slot, not squeezed beside the title', () => {
  renderBar({ subtitle: <span>Dernière mise à jour : 22/09/2026 à 15:17</span> });
  const subtitle = screen.getByText(/Dernière mise à jour/);
  const title = screen.getByRole('heading', { name: 'Système et mises à jour' });
  expect(title.parentElement.contains(subtitle)).toBe(false);
  expect(getComputedStyle(title.parentElement.parentElement).flexWrap).toBe('wrap');
});

test('rule 19 — the actions never shrink below their own width: they wrap as a row', () => {
  renderBar();
  const actions = screen.getByTestId('page-action-bar-actions');
  expect(getComputedStyle(actions).minWidth).toBe('fit-content');
  expect(getComputedStyle(screen.getByTestId('page-action-bar-row')).flexWrap).toBe('wrap');
});

test('rule 19 — the centre node moves to a second row on a narrow bar', () => {
  renderBar({ center: <span>Semaine</span> });
  const css = [...document.querySelectorAll('style')].map((s) => s.textContent).join('\n');
  expect(css).toMatch(/@container \(max-width: ?719\.98px\)\s*\{[^}]*order:\s*3/);
});

test('rule 20 — Save, Cancel, Back and the page actions are all 44 × 44', () => {
  renderBar({ backTo: '/', actionsBefore: [{ icon: <span>i</span>, tooltip: 'Exporter', onClick: () => {} }] });
  for (const name of ['Enregistrer', 'Annuler', 'Retour', 'Exporter']) {
    const style = getComputedStyle(screen.getByRole('button', { name }));
    expect([name, style.width, style.height]).toEqual([name, '44px', '44px']);
  }
});
