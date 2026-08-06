import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReservationFormProvider } from '../ReservationFormContext';
import MidStayNoteDialog from '../MidStayNoteDialog';
import { makeMockContext } from '../mockReservationForm';
import { vi } from 'vitest';

// specs/mid-stay-notes.md §3.2 — la note se compose de ce qui reste à percevoir (cochable) et du
// catalogue, et se clôt par UN choix de règlement. Les montants viennent du moteur : la fenêtre
// n'envoie que des instructions `{ key, amount }`.

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

beforeEach(() => { vi.clearAllMocks(); });

test('les prestations à percevoir sont listées et cochables ; le total suit la sélection', async () => {
  const user = userEvent.setup();
  renderDialog();
  expect(screen.getByText('Petit-déjeuner : 24,00 €')).toBeInTheDocument();
  expect(screen.getByText('0,00 €')).toBeInTheDocument(); // rien de coché → note vide

  await user.click(screen.getAllByRole('checkbox')[0]);
  expect(screen.getByText('24,00 €')).toBeInTheDocument();
});

test('« CB / Chèque » envoie les instructions par clé, jamais un prix calculé côté client', async () => {
  const user = userEvent.setup();
  const { onSettle } = renderDialog();
  await user.click(screen.getAllByRole('checkbox')[1]); // Location vélo
  await user.click(screen.getByRole('button', { name: 'CB / Chèque' }));

  await waitFor(() => expect(onSettle).toHaveBeenCalled());
  const [items, cash] = onSettle.mock.calls[0];
  expect(cash).toBe(false);
  expect(items).toEqual([expect.objectContaining({ key: 'res:3', amount: 18 })]);
});

test('« Caisse interne » passe le drapeau cash', async () => {
  const user = userEvent.setup();
  const { onSettle } = renderDialog();
  await user.click(screen.getAllByRole('checkbox')[0]);
  await user.click(screen.getByRole('button', { name: 'Caisse interne' }));
  await waitFor(() => expect(onSettle).toHaveBeenCalledWith(expect.any(Array), true));
});

test('une prestation ajoutée au catalogue est facturée pour son SEUL delta', async () => {
  const user = userEvent.setup();
  // Le moteur voit maintenant 34 € sur opt:9 (24 déjà dus + 10 ajoutés dans la fenêtre).
  const { onSettle } = renderDialog({
    quote: { midStayExtrasLines: [{ label: 'Petit-déjeuner', amount: 34, key: 'opt:9' }, PENDING[1]] },
  });
  await user.click(screen.getByRole('button', { name: 'CB / Chèque' }));

  await waitFor(() => expect(onSettle).toHaveBeenCalled());
  expect(onSettle.mock.calls[0][0]).toEqual([expect.objectContaining({ key: 'opt:9', amount: 10 })]);
});

test('les boutons de règlement sont inertes tant que la note est vide', () => {
  renderDialog();
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
