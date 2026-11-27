// specs/gift-vouchers/gift-voucher-week-weekend-and-print.md rules 23-24 (K5, K6) — « Imprimer… »: the sentence the server writes under the fields, Recto / Verso captions, the crop
// marks, the backs turned for a sheet flipped like a calendar page, the count following the sheet after a change of mode, a fetch that does not repeat when the parent re-renders.
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';
import PrintSheetsDialog from '../PrintSheetsDialog';

const layoutFor = ({ mode, perSheet, count, flip }) => {
  const rectoVerso = mode === 'recto-verso';
  const pages = Array.from({ length: rectoVerso ? 2 : 1 }, (_, index) => ({
    number: index + 1,
    caption: rectoVerso ? `Feuille 1 · ${index ? 'Verso' : 'Recto'}` : 'Feuille 1',
    sheet: { orientation: 'landscape', widthMm: 297, heightMm: 210 },
    cells: Array.from({ length: Math.min(perSheet, count) }, (_, i) => ({
      card: i + 1, face: rectoVerso && index ? 'back' : 'front', xMm: 10 + i * 20, yMm: 10, widthMm: 18, heightMm: 30, ...(rectoVerso && index && flip === 'top-bottom' ? { rotateDeg: 180 } : {}),
    })),
    folds: [],
    marks: [{ x1: 10, y1: 3, x2: 10, y2: 8 }, { x1: 3, y1: 10, x2: 8, y2: 10 }],
  }));
  return { pages, pageCount: pages.length, description: 'Feuille A4 paysage, 4 × 2, cartes à 66 % (≈ 69 × 98 mm)' };
};

const wrap = (props) => (
  <ThemeProvider theme={theme}><PrintSheetsDialog open onClose={() => {}} title="Imprimer" onPrint={async () => {}} {...props} /></ThemeProvider>
);

test('the preview says what the sheet is, captions Recto / Verso and draws the crop marks', async () => {
  render(wrap({ fetchLayout: async (options) => layoutFor(options) }));
  expect(await screen.findByText(/Feuille A4 paysage, 4 × 2, cartes à 66 % \(≈ 69 × 98 mm\)/)).toBeInTheDocument();
  expect(screen.getByText('Feuille 1 · Recto')).toBeInTheDocument();
  expect(screen.getByText('Feuille 1 · Verso')).toBeInTheDocument();
  expect(document.querySelectorAll('[data-mark]').length).toBe(4);
});

test('K6 — flipped like a calendar page the backs of the preview are turned half a turn', async () => {
  render(wrap({ fetchLayout: async (options) => layoutFor(options) }));
  await screen.findByText('Feuille 1 · Verso');
  expect(window.getComputedStyle(document.querySelector('[data-face="back"]')).transform).not.toBe('rotate(180deg)');
  await userEvent.click(screen.getByLabelText('Retournement de la feuille'));
  await userEvent.click(screen.getByRole('option', { name: 'De haut en bas' }));
  await waitFor(() => expect(window.getComputedStyle(document.querySelector('[data-face="back"]')).transform).toBe('rotate(180deg)'));
});

test('the count follows the cards per sheet after a change of mode, until a number is typed', async () => {
  render(wrap({ fetchLayout: async (options) => layoutFor(options) }));
  await userEvent.click(screen.getByLabelText('Cartes par feuille'));
  await userEvent.click(screen.getByRole('option', { name: '8' }));
  expect(screen.getByLabelText('Nombre de cartes')).toHaveValue('8');
  await userEvent.click(screen.getByRole('radio', { name: 'Côte à côte, à plier' }));
  expect(screen.getByLabelText('Nombre de cartes')).toHaveValue('4');
  await userEvent.clear(screen.getByLabelText('Nombre de cartes'));
  await userEvent.type(screen.getByLabelText('Nombre de cartes'), '3');
  await userEvent.click(screen.getByRole('radio', { name: 'Recto-verso' }));
  expect(screen.getByLabelText('Nombre de cartes')).toHaveValue('3');
});

test('K5 — a document that is a single-use code opens with one copy and keeps it when the sheet changes', async () => {
  render(wrap({ fetchLayout: async (options) => layoutFor(options), initialCount: 1 }));
  expect(screen.getByLabelText('Nombre de cartes')).toHaveValue('1');
  await userEvent.click(screen.getByLabelText('Cartes par feuille'));
  await userEvent.click(screen.getByRole('option', { name: '8' }));
  expect(screen.getByLabelText('Nombre de cartes')).toHaveValue('1');
});

test('a parent that re-renders with a new fetchLayout neither fetches again nor clears the error', async () => {
  const calls = [];
  const failing = async (options) => { calls.push(options); const error = new Error('Nombre de cartes : de 1 à 200.'); error.field = 'count'; throw error; };
  const { rerender } = render(wrap({ fetchLayout: failing }));
  await screen.findByText('Nombre de cartes : de 1 à 200.');
  rerender(wrap({ fetchLayout: async (options) => { calls.push(options); return layoutFor(options); } }));
  rerender(wrap({ fetchLayout: async (options) => { calls.push(options); return layoutFor(options); } }));
  expect(calls).toHaveLength(1);
  expect(screen.getByText('Nombre de cartes : de 1 à 200.')).toBeInTheDocument();
});

test('G26, G20 — no « Feuille A4. » helper under « Cartes par feuille » (the server sentence says it), and the fold line draws one dashed left border only', async () => {
  const withFold = (options) => {
    const layout = layoutFor({ ...options, mode: 'side-by-side' });
    return { ...layout, pages: [{ ...layout.pages[0], folds: [{ x1: 20, y1: 10, x2: 20, y2: 40 }] }] };
  };
  render(wrap({ fetchLayout: async (options) => withFold(options) }));
  await screen.findByText(/Feuille A4 paysage/);
  expect(screen.queryByText('Feuille A4.')).toBeNull();
  const fold = [...document.querySelectorAll('div')].find((node) => window.getComputedStyle(node).borderLeftStyle === 'dashed');
  expect(fold).toBeTruthy();
  expect(window.getComputedStyle(fold).borderTopStyle).not.toBe('dashed');
});
