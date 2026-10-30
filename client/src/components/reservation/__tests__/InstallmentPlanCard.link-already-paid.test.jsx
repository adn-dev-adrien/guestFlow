// specs/payment-link-lifecycle.md rule 50 (audit R8 client N1) — « Envoyer la demande » of an installment
// refused 409 LINK_ALREADY_PAID has booked that payment on the server: the card says so and the fiche
// re-reads its money; any other refusal only says so.
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { vi } from 'vitest';
import DialogProvider from '../../DialogProvider';
import InstallmentPlanCard from '../InstallmentPlanCard';

vi.mock('../../../api', () => ({ __esModule: true, default: { sendInstallmentRequest: vi.fn() } }));
import api from '../../../api';

const PAID_BOOKED = 'Le lien en cours vient d’être payé : paiement enregistré, aucun nouveau lien créé.';
const installment = (number, extra = {}) => ({
  id: 40 + number, number, dueDate: `2027-0${number}-10`, amount: 334, status: 'upcoming', statusLabel: 'À venir',
  editable: true, amountEditable: true, amountEdited: false, dateEdited: false, added: 0,
  paidDate: null, method: null, requestedAt: null, linkUrl: null, clamped: false, ...extra,
});
const PLAN = {
  eligible: true, canCreate: false, reason: null, countLocked: false, frozen: false,
  total: 668, paid: 0, remaining: 668, gap: 0, minCount: 2, maxCount: 12, count: 2, canRequest: true, arrivalDate: '2027-06-14',
  installments: [installment(1, { status: 'toRequest', statusLabel: 'À demander' }), installment(2, { amountEditable: false })],
};

function renderCard(onMoney) {
  render(
    <DialogProvider>
      <InstallmentPlanCard reservationId={7} plan={PLAN} today="2026-10-27" onPlanChange={() => {}} onMoneyChanged={onMoney} />
    </DialogProvider>,
  );
}

beforeEach(() => { vi.clearAllMocks(); });

test('rule 50 — refused as already paid: the message shows and the fiche money is re-read', async () => {
  api.sendInstallmentRequest.mockRejectedValue(Object.assign(new Error(PAID_BOOKED), { code: 'LINK_ALREADY_PAID', status: 409 }));
  const onMoney = vi.fn();
  renderCard(onMoney);
  await userEvent.setup().click(within(screen.getByTestId('installment-1')).getByRole('button', { name: 'Envoyer la demande' }));
  expect(await screen.findByText(PAID_BOOKED)).toBeInTheDocument();
  await waitFor(() => expect(onMoney).toHaveBeenCalledTimes(1));
});

test('rule 50 — another refusal re-reads nothing', async () => {
  api.sendInstallmentRequest.mockRejectedValue(Object.assign(new Error('Prestataire de paiement injoignable : réessayer.'), { code: 'PROVIDER_UNREACHABLE', status: 502 }));
  const onMoney = vi.fn();
  renderCard(onMoney);
  await userEvent.setup().click(within(screen.getByTestId('installment-1')).getByRole('button', { name: 'Envoyer la demande' }));
  expect(await screen.findByText('Prestataire de paiement injoignable : réessayer.')).toBeInTheDocument();
  expect(onMoney).not.toHaveBeenCalled();
});
