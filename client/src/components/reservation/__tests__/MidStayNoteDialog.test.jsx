import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReservationFormProvider } from '../ReservationFormContext';
import MidStayNoteDialog from '../MidStayNoteDialog';
import { makeMockContext } from './mockReservationForm';
import { vi } from 'vitest';
import api from '../../../api';

// specs/mid-stay-notes.md §3.2 + rule 22 — la note se compose de ce qui reste à percevoir (cochable) et du
// catalogue, et se clôt par UN choix de règlement. Les montants et le total viennent du serveur : la
// fenêtre n'envoie que les clés cochées et le reste à l'ouverture.

vi.mock('../../../api', () => ({ __esModule: true, default: { previewMidStayNote: vi.fn() } }));

const PENDING = [
  { label: 'Petit-déjeuner', amount: 24, key: 'opt:9', source: 'midStayExtra' },
  { label: 'Location vélo', amount: 18, key: 'res:3', source: 'midStayExtra' },
];

function renderDialog({ quote, ...rest } = {}) {
  const onSettle = vi.fn();
  const onSellOnly = vi.fn();
  const onClose = vi.fn();
  const ctx = makeMockContext({
    editingReservationId: 7,
    // Le reste à percevoir vu par le moteur (identique à `PENDING` tant que rien n'est ajouté).
    pricingQuote: quote || { midStayExtrasLines: PENDING },
    ...rest,
  });
  render(
    <ReservationFormProvider value={ctx}>
      <MidStayNoteDialog open onClose={onClose} pendingLines={PENDING} onSettle={onSettle} onSellOnly={onSellOnly} />
    </ReservationFormProvider>,
  );
  return { ctx, onSettle, onSellOnly, onClose };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Le serveur dérive la note ; ici il répond « 24 € par clé cochée » pour suivre la sélection.
  api.previewMidStayNote.mockImplementation(async ({ checkedKeys }) => ({
    items: checkedKeys.map((key) => ({ key, amount: 24 })), total: 24 * checkedKeys.length,
  }));
});

test('les prestations à percevoir sont listées et cochables ; le total est celui du serveur', async () => {
  const user = userEvent.setup();
  renderDialog();
  expect(screen.getByText('Petit-déjeuner : 24,00 €')).toBeInTheDocument();
  expect(screen.getByText('0,00 €')).toBeInTheDocument(); // rien de coché → note vide

  await user.click(screen.getAllByRole('checkbox')[0]);
  await waitFor(() => expect(screen.getByText('24,00 €')).toBeInTheDocument());
  expect(api.previewMidStayNote).toHaveBeenLastCalledWith({
    opening: [{ key: 'opt:9', label: 'Petit-déjeuner', amount: 24 }, { key: 'res:3', label: 'Location vélo', amount: 18 }],
    current: PENDING,
    checkedKeys: ['opt:9'],
  });
});

test('« CB / Chèque » envoie les clés cochées et le reste à l\'ouverture, aucun montant', async () => {
  const user = userEvent.setup();
  const { onSettle } = renderDialog();
  await user.click(screen.getAllByRole('checkbox')[1]); // Location vélo
  await waitFor(() => expect(screen.getByRole('button', { name: 'CB / Chèque' })).toBeEnabled());
  await user.click(screen.getByRole('button', { name: 'CB / Chèque' }));

  await waitFor(() => expect(onSettle).toHaveBeenCalled());
  const [instruction, cash] = onSettle.mock.calls[0];
  expect(cash).toBe(false);
  expect(instruction.checkedKeys).toEqual(['res:3']);
  expect(instruction.opening.map((l) => [l.key, l.amount])).toEqual([['opt:9', 24], ['res:3', 18]]);
  expect(instruction).not.toHaveProperty('items');
});

test('« Caisse interne » passe le drapeau cash', async () => {
  const user = userEvent.setup();
  const { onSettle } = renderDialog();
  await user.click(screen.getAllByRole('checkbox')[0]);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Caisse interne' })).toBeEnabled());
  await user.click(screen.getByRole('button', { name: 'Caisse interne' }));
  await waitFor(() => expect(onSettle).toHaveBeenCalledWith(expect.any(Object), true));
});

test('une prestation ajoutée au catalogue : le reste vivant part au serveur, qui renvoie le total', async () => {
  api.previewMidStayNote.mockResolvedValue({ items: [{ key: 'opt:9', label: 'Petit-déjeuner', amount: 10 }], total: 10 });
  const live = [{ label: 'Petit-déjeuner', amount: 34, key: 'opt:9' }, PENDING[1]];
  renderDialog({ quote: { midStayExtrasLines: live } });
  await waitFor(() => expect(screen.getByText('10,00 €')).toBeInTheDocument());
  expect(api.previewMidStayNote).toHaveBeenCalledWith(expect.objectContaining({ current: live, checkedKeys: [] }));
});

test('les boutons de règlement sont inertes tant que la note est vide', async () => {
  renderDialog();
  await waitFor(() => expect(api.previewMidStayNote).toHaveBeenCalled());
  expect(screen.getByRole('button', { name: 'CB / Chèque' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Caisse interne' })).toBeDisabled();
});

test('« Annuler » restaure la sélection d\'options telle qu\'à l\'ouverture', async () => {
  const user = userEvent.setup();
  const { ctx, onClose } = renderDialog({
    form: { selectedOptions: [] },
    // Une option a été ajoutée pendant que la fenêtre était ouverte.
    quote: { midStayExtrasLines: PENDING },
  });
  await user.click(screen.getByRole('button', { name: 'Annuler' }));
  expect(onClose).toHaveBeenCalled();
  expect(ctx.setOptionEnabled).not.toHaveBeenCalled(); // rien n'avait bougé → rien à défaire
});
