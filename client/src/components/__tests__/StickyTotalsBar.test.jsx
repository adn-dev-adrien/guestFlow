/**
 * StickyTotalsBar — specs/tourist-tax-report-v2.md §3 rules 20, 39, 45 and 47: the given figures, as given, in a sticky polite live
 * region; on a phone the `compact` ones and a toggle that unfolds the rest.
 */
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';
import StickyTotalsBar from '../StickyTotalsBar';

const ITEMS = [
  { key: 'stays', label: 'Séjours', value: '12', caption: '+ 2 reversés par plateforme', compact: true },
  { key: 'persons', label: 'Personnes', value: '38' },
  { key: 'amount', label: 'À reverser', value: '100,35 €', caption: 'reste 18,15 €', main: true, compact: true },
];
const setPhone = (phone) => {
  window.matchMedia = (query) => ({
    matches: phone && query.includes('max-width'), media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  });
};
const renderBar = () => render(<ThemeProvider theme={theme}><StickyTotalsBar items={ITEMS} label="Totaux de la sélection" /></ThemeProvider>);
afterAll(() => { delete window.matchMedia; });

test('rule 20: every figure, as given, in a named live region', () => {
  setPhone(false);
  renderBar();
  const bar = screen.getByRole('region', { name: 'Totaux de la sélection' });
  for (const text of ['Séjours', '12', '+ 2 reversés par plateforme', 'Personnes', '38', 'À reverser', '100,35 €', 'reste 18,15 €']) {
    expect(within(bar).getByText(text)).toBeInTheDocument();
  }
  expect(bar.querySelector('[aria-live="polite"]')).not.toBeNull();
  expect(screen.queryByRole('button')).toBeNull();
});

test('rule 20: on a phone, the compact figures and a toggle for the rest', () => {
  setPhone(true);
  renderBar();
  expect(screen.getByText('100,35 €')).toBeInTheDocument();
  expect(screen.getByText('12')).toBeInTheDocument();
  expect(screen.queryByText('Personnes')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Détail des totaux' }));
  expect(screen.getByText('Personnes')).toBeInTheDocument();
  const toggle = screen.getByRole('button', { name: 'Masquer le détail' });
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  fireEvent.click(toggle);
  expect(screen.queryByText('Personnes')).toBeNull();
});

test('rule 39 (D-HC17): every figure has the same size, the main one included, on desktop and on a phone', () => {
  for (const phone of [false, true]) {
    setPhone(phone);
    const { unmount } = renderBar();
    if (phone) fireEvent.click(screen.getByRole('button', { name: 'Détail des totaux' }));
    const figures = [...document.querySelectorAll('[data-figure]')];
    expect(figures.length).toBe(ITEMS.length);
    const sizes = new Set(figures.map((f) => getComputedStyle(f).fontSize));
    expect(sizes.size).toBe(1);
    expect(['1.05rem', '16.8px']).toContain([...sizes][0]);
    for (const f of figures) expect(getComputedStyle(f).fontVariantNumeric).toBe('tabular-nums');
    unmount();
  }
});

test('rules 39 and 47: each label sits in a block of one fixed height aligned to its bottom; the figures wrap into rows, each keeping its own width', () => {
  setPhone(false);
  renderBar();
  const blocks = ITEMS.map((i) => screen.getByTestId(`total-${i.key}`).firstChild);
  for (const block of blocks) {
    expect(block).toHaveStyle({ display: 'flex', alignItems: 'flex-end', overflow: 'hidden' });
    expect(getComputedStyle(block).height).toBe(getComputedStyle(blocks[0]).height);
  }
  expect(screen.getByTestId('sticky-totals-bar').querySelector('[aria-live]')).toHaveStyle({ flexWrap: 'wrap' });
  for (const i of ITEMS) expect(screen.getByTestId(`total-${i.key}`)).toHaveStyle({ minWidth: 'min-content' });
  // Off a phone every figure shows, nothing behind a toggle (D-HC19).
  expect(screen.queryByRole('button')).toBeNull();
  expect(document.querySelectorAll('[data-figure]').length).toBe(ITEMS.length);
});

test('rule 45: a long label is clamped to two lines, its full text kept in its title', () => {
  setPhone(false);
  const long = 'Séjours déclarés sur la période choisie, hors plateformes qui reversent elles-mêmes';
  render(<ThemeProvider theme={theme}><StickyTotalsBar items={[{ ...ITEMS[0], label: long }, ITEMS[2]]} label="Totaux" /></ThemeProvider>);
  const labelEl = screen.getByText(long);
  expect(labelEl).toHaveAttribute('title', long);
  expect(labelEl).toHaveStyle({ overflow: 'hidden' });
  expect(labelEl.style.webkitLineClamp || getComputedStyle(labelEl).webkitLineClamp || getComputedStyle(labelEl).getPropertyValue('-webkit-line-clamp')).toBe('2');
});
