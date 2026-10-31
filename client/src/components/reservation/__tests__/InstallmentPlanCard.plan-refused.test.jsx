// specs/payment-link-lifecycle.md rule 63 (review of #911) — a creation or a resize refused 409 may have withdrawn the
// stay's acompte / solde links first: the card says why and the fiche re-reads its money (ledger, links, card).
// Another failure only says so.
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { vi } from 'vitest';
import DialogProvider from '../../DialogProvider';
import InstallmentPlanCard from '../InstallmentPlanCard';

vi.mock('../../../api', () => ({ __esModule: true, default: { putInstallments: vi.fn() } }));
import api from '../../../api';

const PENDING = 'Ancien lien de paiement pas encore désactivé : échéancier non créé.';
const EMPTY = {
  eligible: true, canCreate: true, reason: null, countLocked: false, frozen: false,
  total: 0, paid: 0, remaining: 0, gap: 0, minCount: 2, maxCount: 12, count: 0, canRequest: true, arrivalDate: '2027-06-14',
  installments: [],
};
const installment = (number) => ({
  id: 40 + number, number, dueDate: `2027-0${number}-10`, amount: 334, status: 'upcoming', statusLabel: 'À venir',
  editable: true, amountEditable: true, amountEdited: false, dateEdited: false, added: 0,
  paidDate: null, method: null, requestedAt: null, linkUrl: null, clamped: false,
});
const PLAN = { ...EMPTY, canCreate: false, total: 668, remaining: 668, count: 2, installments: [installment(1), installment(2)] };

function renderCard(plan, onMoney) {
  render(
    <DialogProvider>
      <InstallmentPlanCard reservationId={7} plan={plan} today="2026-10-27" onPlanChange={() => {}} onMoneyChanged={onMoney} />
    </DialogProvider>,
  );
}

beforeEach(() => { vi.clearAllMocks(); });

test('rule 63: a creation refused 409 says why and re-reads the fiche', async () => {
  api.putInstallments.mockRejectedValue(Object.assign(new Error(PENDING), { error: 'LINK_DEACTIVATION_PENDING', status: 409 }));
  const onMoney = vi.fn();
  renderCard(EMPTY, onMoney);
  await userEvent.setup().click(screen.getByRole('button', { name: 'Créer un échéancier' }));
  expect(await screen.findByText(PENDING)).toBeInTheDocument();
  await waitFor(() => expect(onMoney).toHaveBeenCalledTimes(1));
});

test('rule 63: a resize refused 409 re-reads the fiche too', async () => {
  const message = 'Ancien lien de paiement pas encore désactivé : échéancier inchangé.';
  api.putInstallments.mockRejectedValue(Object.assign(new Error(message), { error: 'LINK_DEACTIVATION_PENDING', status: 409 }));
  const onMoney = vi.fn();
  renderCard(PLAN, onMoney);
  await userEvent.setup().click(screen.getByRole('button', { name: 'Une échéance de plus' }));
  expect(await screen.findByText(message)).toBeInTheDocument();
  await waitFor(() => expect(onMoney).toHaveBeenCalledTimes(1));
});

test('rule 63: a failure that is not a 409 re-reads nothing', async () => {
  api.putInstallments.mockRejectedValue(Object.assign(new Error('Entre 2 et 12 échéances.'), { error: 'INVALID_COUNT', status: 400 }));
  const onMoney = vi.fn();
  renderCard(EMPTY, onMoney);
  await userEvent.setup().click(screen.getByRole('button', { name: 'Créer un échéancier' }));
  expect(await screen.findByText('Entre 2 et 12 échéances.')).toBeInTheDocument();
  expect(onMoney).not.toHaveBeenCalled();
});
