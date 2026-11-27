// specs/gift-vouchers/gift-voucher-week-weekend-and-print.md rules 22-23, 27 — « Imprimer… »: the mode, the cards per sheet (1/2/4/8 two-sided, 1/2/4 folded), the number of cards, the flip named
// by its gesture, a live preview of the server's layout (numbered cards, fold lines), the server's refusal under the field it names, the PDF requested with the options.
import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';
import PrintSheetsDialog from '../PrintSheetsDialog';

const sheet = (orientation) => ({ orientation, widthMm: orientation === 'portrait' ? 210 : 297, heightMm: orientation === 'portrait' ? 297 : 210 });
const layoutFor = ({ mode, perSheet, count }) => {
  const pages = Array.from({ length: mode === 'recto-verso' ? 2 : 1 }, (_, index) => ({
    number: index + 1,
    sheet: sheet('landscape'),
    cells: Array.from({ length: Math.min(perSheet, count) }, (__, i) => ({ card: i + 1, face: mode === 'recto-verso' && index === 1 ? 'back' : 'front', xMm: 10 + i * 20, yMm: 10, widthMm: 18, heightMm: 30 })),
    folds: mode === 'side-by-side' ? [{ x1: 105, y1: 10, x2: 105, y2: 140 }] : [],
    marks: mode === 'side-by-side',
  }));
  return { pages, pageCount: pages.length };
};

function open(props = {}) {
  const fetchLayout = vi.fn(async (options) => layoutFor(options));
  const onPrint = vi.fn(async () => {});
  const onClose = vi.fn();
  render(
    <ThemeProvider theme={theme}>
      <PrintSheetsDialog open onClose={onClose} title="Imprimer le bon" fetchLayout={fetchLayout} onPrint={onPrint} {...props} />
    </ThemeProvider>,
  );
  return { fetchLayout, onPrint, onClose };
}

test('rule 23 — the dialog opens two-sided with 4 cards per sheet, the flip « De gauche à droite », and a preview of the server\'s layout', async () => {
  const { fetchLayout } = open();
  expect(screen.getByRole('radio', { name: 'Recto-verso' })).toBeChecked();
  expect(screen.getByLabelText('Nombre de cartes')).toHaveValue('4');
  expect(screen.getByLabelText('Retournement de la feuille')).toHaveTextContent('De gauche à droite');
  await waitFor(() => expect(screen.getAllByTestId('sheet-preview')).toHaveLength(2));
  expect(fetchLayout).toHaveBeenLastCalledWith({ mode: 'recto-verso', perSheet: 4, count: 4, flip: 'left-right' });
  expect(within(screen.getAllByTestId('sheet-preview')[0]).getByText('1')).toBeInTheDocument();
  expect(screen.getAllByTestId('sheet-preview')[1].querySelector('[data-face="back"]')).not.toBeNull();
});

test('rule 23 — the cards per sheet are 1, 2, 4 or 8 two-sided and 1, 2 or 4 side by side; the count follows the sheet until it is typed', async () => {
  open();
  await userEvent.click(screen.getByLabelText('Cartes par feuille'));
  expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['1', '2', '4', '8']);
  await userEvent.click(screen.getByRole('option', { name: '8' }));
  expect(screen.getByLabelText('Nombre de cartes')).toHaveValue('8');
  await userEvent.click(screen.getByRole('radio', { name: 'Côte à côte, à plier' }));
  await userEvent.click(screen.getByLabelText('Cartes par feuille'));
  expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['1', '2', '4']);
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByLabelText('Retournement de la feuille')).not.toBeInTheDocument();
});

test('rule 25 — folded, the preview shows the fold line of each pair', async () => {
  open();
  await userEvent.click(screen.getByRole('radio', { name: 'Côte à côte, à plier' }));
  await waitFor(() => expect(screen.getAllByTestId('sheet-preview')).toHaveLength(1));
  expect(screen.getByTestId('sheet-preview').querySelectorAll('div[class*="MuiBox"]').length).toBeGreaterThan(1);
});

test('rule 27 — a refusal of the server is drawn under the field it names, and nothing is previewed', async () => {
  const fetchLayout = vi.fn(async (options) => {
    if (options.count === 250) throw Object.assign(new Error('Nombre de cartes : un nombre entier de 1 à 200.'), { field: 'count' });
    return layoutFor(options);
  });
  open({ fetchLayout });
  const count = screen.getByLabelText('Nombre de cartes');
  await userEvent.clear(count);
  await userEvent.type(count, '250');
  expect(await screen.findByText('Nombre de cartes : un nombre entier de 1 à 200.')).toBeInTheDocument();
  expect(screen.queryAllByTestId('sheet-preview')).toHaveLength(0);
});

test('rule 22 — « Télécharger le PDF » asks for the PDF with the options chosen, then closes', async () => {
  const { onPrint, onClose } = open();
  await userEvent.click(screen.getByLabelText('Retournement de la feuille'));
  await userEvent.click(screen.getByRole('option', { name: 'De haut en bas' }));
  const count = screen.getByLabelText('Nombre de cartes');
  await userEvent.clear(count);
  await userEvent.type(count, '9');
  await userEvent.click(screen.getByRole('button', { name: 'Télécharger le PDF' }));
  await waitFor(() => expect(onPrint).toHaveBeenCalledWith({ mode: 'recto-verso', perSheet: 4, count: 9, flip: 'top-bottom' }));
  await waitFor(() => expect(onClose).toHaveBeenCalled());
});

test('rule 22 — a refusal of the PDF stays in the dialog under its field', async () => {
  const onPrint = vi.fn(async () => { throw Object.assign(new Error('Cette campagne n’a pas de visuel pour la carte du commerçant : en choisir un d’abord.'), {}); });
  const { onClose } = open({ onPrint });
  await userEvent.click(screen.getByRole('button', { name: 'Télécharger le PDF' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Cette campagne n’a pas de visuel');
  expect(onClose).not.toHaveBeenCalled();
});
