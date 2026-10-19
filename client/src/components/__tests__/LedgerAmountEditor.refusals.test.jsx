// specs/reservation-payment-ledger.md rules 16-21 — the amount editor proposes, the server decides:
// the refusal is printed under the field (typed value kept, « Valider » disabled), the effects of an
// accepted amount are printed as they come, « Valider » hands back the server's formPatch verbatim.
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import LedgerAmountEditor from '../LedgerAmountEditor';

function renderEditor(onCheck, extra = {}) {
  const onApply = vi.fn();
  const onCancel = vi.fn();
  const onRefund = vi.fn();
  render(
    <LedgerAmountEditor
      label="Montant du solde (€)"
      initialValue="614,40"
      help="Entre 26,40 € et 866,40 € ; l'acompte prend le reste."
      onCheck={onCheck}
      onApply={onApply}
      onCancel={onCancel}
      onRefund={onRefund}
      debounceMs={0}
      {...extra}
    />,
  );
  return { onApply, onCancel, onRefund, field: screen.getByLabelText('Montant du solde (€)') };
}

test('the help line shows the bounds before anything is typed', () => {
  renderEditor(vi.fn());
  expect(screen.getByText("Entre 26,40 € et 866,40 € ; l'acompte prend le reste.")).toBeInTheDocument();
});

test('rule 17 — a refusal is shown under the field, the typed value stays, « Valider » is disabled', async () => {
  const user = userEvent.setup();
  const onCheck = vi.fn(async () => ({ ok: false, reason: 'Le solde porte la taxe de séjour (26,40 €) : pas en dessous.' }));
  const { field, onApply } = renderEditor(onCheck);
  await user.clear(field);
  await user.type(field, '10');
  expect(await screen.findByText(/./, { selector: '[data-ledger-refusal]' })).toHaveTextContent('Le solde porte la taxe de séjour (26,40 €) : pas en dessous.');
  expect(field).toHaveValue('10');
  expect(field).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByRole('button', { name: 'Valider' })).toBeDisabled();
  fireEvent.keyDown(field, { key: 'Enter' });
  expect(onApply).not.toHaveBeenCalled();
});

test('rule 21 — the raw text goes to the server: « 100+20 », « -5 » are not evaluated here', async () => {
  const user = userEvent.setup();
  const onCheck = vi.fn(async () => ({ ok: false, reason: 'Un montant ne peut pas être négatif.' }));
  const { field } = renderEditor(onCheck);
  await user.clear(field);
  await user.type(field, '-5');
  await waitFor(() => expect(onCheck).toHaveBeenLastCalledWith('-5'));
  await user.clear(field);
  await user.type(field, '100+20');
  await waitFor(() => expect(onCheck).toHaveBeenLastCalledWith('100+20'));
});

test('rule 18 — effects are printed, « reached » when it differs, and « Valider » applies the formPatch verbatim', async () => {
  const user = userEvent.setup();
  const answer = {
    ok: true, amount: 500, reached: 499.99,
    effects: ['Hébergement : 840,00 € → 790,00 € · taxe de séjour 26,40 € → 24,83 €', 'Solde obtenu : 499,99 € (au centime près, la taxe suit l\'hébergement)'],
    formPatch: { customPrice: 790, ledgerAmountEdit: 'balance' },
  };
  const { field, onApply } = renderEditor(vi.fn(async () => answer));
  await user.clear(field);
  await user.type(field, '500');
  expect(await screen.findByText(/Solde obtenu : 499,99 €/)).toBeInTheDocument();
  expect(screen.getByText(/Hébergement : 840,00 € → 790,00 €/)).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Valider' })).toBeEnabled());
  await user.click(screen.getByRole('button', { name: 'Valider' }));
  expect(onApply).toHaveBeenCalledWith(answer);
});

test('rule 19 — the refusal of a perceived row offers « Créer le remboursement »', async () => {
  const user = userEvent.setup();
  const refund = { amount: 66.4, label: 'Créer le remboursement' };
  const { field, onRefund } = renderEditor(vi.fn(async () => ({
    ok: false, reason: 'Déjà perçu : 866,40 €. Pour rendre 66,40 €, créer un remboursement.', refund,
  })));
  await user.clear(field);
  await user.type(field, '800');
  await user.click(await screen.findByRole('button', { name: 'Créer le remboursement' }));
  expect(onRefund).toHaveBeenCalledWith(refund);
});

test('« Annuler » and Escape close without applying anything', async () => {
  const user = userEvent.setup();
  const { field, onCancel, onApply } = renderEditor(vi.fn());
  fireEvent.keyDown(field, { key: 'Escape' });
  await user.click(screen.getByRole('button', { name: 'Annuler' }));
  expect(onCancel).toHaveBeenCalledTimes(2);
  expect(onApply).not.toHaveBeenCalled();
});
