import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import RefundDialog from '../RefundDialog';

// specs/reservation-refunds.md rule 51 (D15) — sur un séjour vivant, le dialogue bloque d'après le chiffre du serveur
// (`availableTtc`), sans calcul : ligne sans encaissement désactivée, plafond de la ligne, caisse interne non jugée.

const LINES = [
  { key: 'accommodation', label: 'Hébergement', bucket: 'accommodation', quantity: null, unitPrice: null, billedTtc: 600, refundedTtc: 0, requalifiedTtc: 0, refundableTtc: 600, availableTtc: 600, vatRate: 10 },
  { key: 'custom:ajout', label: 'Ajout', bucket: 'options', quantity: null, unitPrice: null, billedTtc: 16, refundedTtc: 0, requalifiedTtc: 0, refundableTtc: 16, availableTtc: 0, vatRate: 10 },
  { key: 'touristTax', label: 'Taxe de séjour', bucket: 'touristTax', quantity: null, unitPrice: null, billedTtc: 7.2, refundedTtc: 0, requalifiedTtc: 0, refundableTtc: 7.2, availableTtc: 4.8, vatRate: 0 },
];

function dialog(props = {}) {
  const onSubmit = vi.fn().mockResolvedValue();
  render(<RefundDialog open onClose={vi.fn()} refundableLines={LINES} collectedTtc={604.8} onSubmit={onSubmit} {...props} />);
  return onSubmit;
}
const box = (name) => screen.getByRole('checkbox', { name: new RegExp(name) });
const save = () => screen.getByRole('button', { name: /Rembourser|Enregistrer/ });

test('une ligne sans encaissement est désactivée et le dit', () => {
  dialog();
  expect(box('Ajout')).toBeDisabled();
  expect(screen.getByText(/Facturé 16,00 €.*Rien d’encaissé sur cette ligne\./)).toBeInTheDocument();
  expect(box('Hébergement')).toBeEnabled();
});

test('cocher une ligne propose ce qui est disponible, pas ce qui est facturé', () => {
  dialog();
  fireEvent.click(box('Taxe de séjour'));
  expect(screen.getByRole('textbox', { name: 'Montant' })).toHaveValue('4,80');
  expect(screen.getByText(/Max 4,80/)).toBeInTheDocument();
});

test('au-dessus du disponible, l’enregistrement est bloqué avec le montant en trop', () => {
  dialog();
  fireEvent.click(box('Taxe de séjour'));
  fireEvent.change(screen.getByRole('textbox', { name: 'Montant' }), { target: { value: '7,20' } });
  expect(screen.getByRole('alert')).toHaveTextContent('Taxe de séjour : dépasse le remboursable de 2,40 €.');
  expect(save()).toBeDisabled();
});

test('en caisse interne la ligne n’est pas jugée : elle se coche, et repasser au virement la bloque', () => {
  const onSubmit = dialog();
  fireEvent.click(screen.getByRole('radio', { name: /Caisse interne/ }));
  expect(box('Ajout')).toBeEnabled();
  fireEvent.click(box('Ajout'));
  expect(screen.getByRole('textbox', { name: 'Montant' })).toHaveValue('16,00');
  expect(save()).toBeEnabled();
  fireEvent.click(screen.getByRole('radio', { name: 'Virement' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Ajout : rien d’encaissé sur cette ligne.');
  expect(save()).toBeDisabled();
  expect(onSubmit).not.toHaveBeenCalled();
});

test('un montant dans la limite part au serveur', async () => {
  const onSubmit = dialog();
  fireEvent.click(box('Taxe de séjour'));
  fireEvent.click(save());
  await waitFor(() => expect(onSubmit).toHaveBeenCalled());
  expect(onSubmit.mock.calls[0][0].lines).toEqual([{ key: 'touristTax', amountTtc: 4.8 }]);
});

test('sans chiffre du serveur (séjour annulé, argent sans détail), le dialogue reste sur le remboursable', () => {
  dialog({ refundableLines: LINES.map(({ availableTtc, ...line }) => line) });
  expect(box('Ajout')).toBeEnabled();
  fireEvent.click(box('Taxe de séjour'));
  expect(screen.getByRole('textbox', { name: 'Montant' })).toHaveValue('7,20');
});
