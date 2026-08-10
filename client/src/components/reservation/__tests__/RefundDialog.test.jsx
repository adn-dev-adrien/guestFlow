import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RefundDialog from '../RefundDialog';
import { vi } from 'vitest';

// specs/reservation-refunds.md §6 — la fenêtre « Nouveau remboursement » : sélection des lignes
// facturées, ligne libre, date + moyen, et remontée inline de l'erreur serveur.

const LINES = [
  { key: 'accommodation', label: 'Hébergement', bucket: 'accommodation', quantity: null, unitPrice: null, billedTtc: 380, refundedTtc: 0, refundableTtc: 380, vatRate: 10 },
  { key: 'opt:7', label: 'Petit-déjeuner', bucket: 'options', quantity: 6, unitPrice: 12, billedTtc: 72, refundedTtc: 12, refundableTtc: 60, vatRate: 10 },
  // specs/reservation-refunds.md §3.5 — la taxe de séjour se rembourse à la nuit.
  { key: 'touristTax', label: 'Taxe de séjour', bucket: 'touristTax', quantity: 3, unitPrice: 4.4, unitLabel: 'nuit', billedTtc: 13.2, refundedTtc: 0, refundableTtc: 13.2, vatRate: 0 },
];

const todayIso = () => new Date().toISOString().slice(0, 10);

function renderDialog(props = {}) {
  const onSubmit = props.onSubmit || vi.fn();
  render(
    <RefundDialog
      open
      onClose={props.onClose || vi.fn()}
      refundableLines={props.refundableLines || LINES}
      collectedTtc={props.collectedTtc ?? 480}
      onSubmit={onSubmit}
    />,
  );
  return onSubmit;
}

test('les lignes facturées listent le montant facturé et ce qui a déjà été remboursé', () => {
  renderDialog();
  expect(screen.getByText('Petit-déjeuner')).toBeInTheDocument();
  expect(screen.getByText(/Facturé 72,00 € · déjà remboursé 12,00 €/)).toBeInTheDocument();
  expect(screen.getByText('Facturé 380,00 €')).toBeInTheDocument();
});

test('cocher une ligne pré-remplit tout le remboursable et alimente le total', async () => {
  const user = userEvent.setup();
  renderDialog();
  await user.click(screen.getAllByRole('checkbox')[1]); // Petit-déjeuner
  expect(screen.getByLabelText('Montant')).toHaveValue(60);
  expect(screen.getByText('− 60,00 €')).toBeInTheDocument();
});

test('le cas déclencheur : 2 petits-déjeuners rendus par virement', async () => {
  const user = userEvent.setup();
  const onSubmit = renderDialog();

  await user.click(screen.getAllByRole('checkbox')[1]);
  const amount = screen.getByLabelText('Montant');
  await user.clear(amount);
  await user.type(amount, '24');
  await user.type(screen.getByLabelText('Motif (optionnel)'), 'Départ anticipé');
  await user.click(screen.getByRole('button', { name: 'Enregistrer le remboursement' }));

  await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  const payload = onSubmit.mock.calls[0][0];
  expect(payload.method).toBe('transfer');
  expect(payload.refundDate).toBe(todayIso());
  expect(payload.reason).toBe('Départ anticipé');
  expect(payload.lines).toEqual([expect.objectContaining({ key: 'opt:7', amountTtc: 24 })]);
});

test('une ligne libre part avec son libellé, sa catégorie et son montant', async () => {
  const user = userEvent.setup();
  const onSubmit = renderDialog();

  await user.click(screen.getByRole('button', { name: '+ Ajouter une ligne libre' }));
  await user.type(screen.getByLabelText('Libellé'), 'Geste commercial');
  await user.type(screen.getByLabelText('Montant'), '15');
  await user.click(screen.getByRole('button', { name: 'Enregistrer le remboursement' }));

  await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  expect(onSubmit.mock.calls[0][0].lines).toEqual([
    { label: 'Geste commercial', bucket: 'options', amountTtc: 15 },
  ]);
});

test('un montant au-dessus du plafond de la ligne bloque l’enregistrement', async () => {
  const user = userEvent.setup();
  renderDialog();
  await user.click(screen.getAllByRole('checkbox')[1]);
  const amount = screen.getByLabelText('Montant');
  await user.clear(amount);
  await user.type(amount, '90');

  expect(screen.getByText('Max 60,00 €')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Enregistrer le remboursement' })).toBeDisabled();
});

test('rien de coché → le bouton reste désactivé', () => {
  renderDialog();
  expect(screen.getByRole('button', { name: 'Enregistrer le remboursement' })).toBeDisabled();
});

test('un dépassement de l’encaissé affiche un avertissement sans bloquer', async () => {
  const user = userEvent.setup();
  renderDialog({ collectedTtc: 50 });
  await user.click(screen.getAllByRole('checkbox')[1]); // 60 € > 50 € encaissés

  expect(screen.getByText('Ce remboursement dépasse le montant encaissé à ce jour.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Enregistrer le remboursement' })).toBeEnabled();
});

test('une erreur serveur s’affiche dans la fenêtre, qui reste ouverte', async () => {
  const user = userEvent.setup();
  const onClose = vi.fn();
  const onSubmit = vi.fn().mockRejectedValue(new Error('Le total remboursé dépasserait le montant du séjour (480,00 €)'));
  renderDialog({ onSubmit, onClose });

  await user.click(screen.getAllByRole('checkbox')[1]);
  await user.click(screen.getByRole('button', { name: 'Enregistrer le remboursement' }));

  expect(await screen.findByText('Le total remboursé dépasserait le montant du séjour (480,00 €)')).toBeInTheDocument();
  expect(onClose).not.toHaveBeenCalled();
});

test('la date ne peut pas être choisie dans le futur', () => {
  renderDialog();
  expect(screen.getByLabelText('Date du remboursement')).toHaveAttribute('max', todayIso());
});

test('la taxe de séjour annonce son unité et se rembourse par nuit', async () => {
  const user = userEvent.setup();
  const onSubmit = renderDialog();

  expect(screen.getByText(/Facturé 13,20 € · 3 nuits à 4,40 €/)).toBeInTheDocument();

  await user.click(screen.getAllByRole('checkbox')[2]); // Taxe de séjour → 3 nuits pré-remplies
  const stepper = screen.getByRole('button', { name: /Diminuer/ });
  await user.click(stepper); // 3 → 2 nuits
  await user.click(stepper); // 2 → 1 nuit
  await user.click(screen.getByRole('button', { name: 'Enregistrer le remboursement' }));

  await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  const [line] = onSubmit.mock.calls[0][0].lines;
  expect(line.key).toBe('touristTax');
  expect(line.amountTtc).toBe(4.4);
});
