import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

import { ReservationFormProvider } from '../ReservationFormContext';
import DialogProvider from '../../DialogProvider';
import FinanceSection from '../FinanceSection';
import { makeMockContext } from './mockReservationForm';

// specs/platforms/platform-statement-after-payout.md — the « Relevé plateforme » of a received payout or a locked fiche:
// it opens without unlocking, shows the transfer, reads the server's net, and writes through its own PATCH.
// The numbers are reservation 202605014 (Abracadaroom): transfer 171,14, brut 215, commission 43,86.

vi.mock('../../../api', () => ({
  __esModule: true,
  default: {
    markPayment: vi.fn(), computePlatformCommission: vi.fn(),
    previewPlatformStatement: vi.fn(), updatePlatformStatement: vi.fn(),
  },
}));
import api from '../../../api';

const RECEIVED = {
  key: 'balance', label: 'Versement Abracadaroom', amount: 171.14, state: 'paid', tone: 'done', stateLabel: 'Reçu le 05/06 · Abracadaroom',
  action: null,
  amountEdit: {
    editable: true, mode: 'statement', min: null, max: null, reason: null, correctable: true,
    // date-literal-ok: a mocked ledger row; the panel only prints the server's label, nothing compares the date with today
    received: { date: '2026-06-05', net: 171.14, label: 'Virement reçu le 05/06 (€)' },
  },
  detail: null,
};
const UNRECEIVED = { ...RECEIVED, state: 'due', tone: 'due', amountEdit: { editable: true, mode: 'statement', min: null, max: null, reason: null, correctable: true } };

function renderFinance({ row = RECEIVED, ...overrides } = {}) {
  const ctx = makeMockContext({
    ledger: { rows: [row], closing: null },
    editingReservationId: 22211,
    isReservationLocked: true,
    form: { platform: 'Abracadaroom', platformPayoutAmount: '' },
    pricingQuote: { touristTaxOfferedByPlatform: false, touristTaxReversedByPlatform: false },
    ...overrides,
  });
  render(
    <DialogProvider>
      <ReservationFormProvider value={ctx}>
        <FinanceSection />
      </ReservationFormProvider>
    </DialogProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: /Modifier le montant/ }));
  return ctx;
}

const typeGross = (value) => {
  const field = screen.getByLabelText('Location (relevé)');
  field.focus();
  fireEvent.change(field, { target: { value } });
  fireEvent.blur(field);
};

beforeEach(() => {
  vi.clearAllMocks();
  api.previewPlatformStatement.mockResolvedValue({ netGap: 0, netLabel: { tone: 'done', label: 'Net : 171,14 € — identique au virement ✓' } });
});

test('rules 1, 2, 3, 8 — a received payout on a locked fiche opens the statement: same fields, its transfer prefilled and editable', async () => {
  renderFinance();
  // Rule 2 — the fields and the button of the existing statement, unchanged.
  expect(screen.getByLabelText('Commission solde (€)')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Calculer la commission/i })).toBeInTheDocument();
  expect(screen.getByLabelText('Virement reçu le 05/06 (€)')).toHaveValue('171,14');
  expect(screen.getByLabelText('Virement reçu le 05/06 (€)')).not.toBeDisabled();
  expect(screen.getByLabelText('Location (relevé)')).not.toBeDisabled();
  expect(screen.queryByText(/déverrouiller la fiche/)).not.toBeInTheDocument();
});

test('rule 3 — « Calculer la commission » reads the transfer received when none was typed', async () => {
  renderFinance();
  typeGross('215');
  api.computePlatformCommission.mockResolvedValueOnce({ commission: 43.86 });
  fireEvent.click(screen.getByRole('button', { name: /Calculer la commission/i }));
  await waitFor(() => expect(api.computePlatformCommission).toHaveBeenCalledWith(expect.objectContaining({ gross: 215, payout: 171.14 })));
});

test('rule 4 (Q1) — the server\'s gap is shown as a warning and « Valider » stays enabled', async () => {
  api.previewPlatformStatement.mockResolvedValue({ netGap: 3.86, netLabel: { tone: 'warning', label: 'Net : 175,00 € — le virement reçu est de 171,14 € (écart 3,86 €). Le relevé sera enregistré avec cet écart.' } });
  renderFinance();
  typeGross('215');
  expect(await screen.findByText(/écart 3,86 €/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Valider' })).not.toBeDisabled();
});

test('rule 7 — a statement the server refuses disables « Valider » and says why', async () => {
  api.previewPlatformStatement.mockRejectedValue(new Error('Ce relevé modifierait aussi la taxe de séjour : déverrouiller la fiche pour corriger le séjour.'));
  renderFinance();
  typeGross('400');
  expect(await screen.findByText(/modifierait aussi la taxe de séjour/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Valider' })).toBeDisabled();
});

test('rule 5 — « Valider » writes through the PATCH and reloads the fiche, never the form', async () => {
  api.updatePlatformStatement.mockResolvedValueOnce({ netGap: 0, netLabel: { tone: 'done', label: '' }, changed: ['platformGrossAmount'] });
  const ctx = renderFinance();
  typeGross('215');
  await screen.findByText(/identique au virement/);
  fireEvent.click(screen.getByRole('button', { name: 'Valider' }));
  await waitFor(() => expect(api.updatePlatformStatement).toHaveBeenCalledWith(22211, expect.objectContaining({ platformGrossAmount: 215 })));
  await waitFor(() => expect(ctx.reloadReservationFinance).toHaveBeenCalled());
  expect(ctx.updateForm).not.toHaveBeenCalledWith(expect.objectContaining({ platformGrossAmount: 215 }));
});

test('rule 11 — an unreceived payout on a locked fiche writes at once too, without the transfer line', async () => {
  api.updatePlatformStatement.mockResolvedValueOnce({ netGap: 0, netLabel: null, changed: ['platformGrossAmount'] });
  api.previewPlatformStatement.mockResolvedValue({ netGap: 0, netLabel: null });
  renderFinance({ row: UNRECEIVED });
  expect(screen.queryByLabelText(/Virement reçu le/)).not.toBeInTheDocument();
  typeGross('215');
  fireEvent.click(screen.getByRole('button', { name: 'Valider' }));
  await waitFor(() => expect(api.updatePlatformStatement).toHaveBeenCalled());
});

test('rule 11 — an unreceived payout on an unlocked fiche keeps the draft saved with the fiche', () => {
  const ctx = renderFinance({ row: UNRECEIVED, isReservationLocked: false });
  typeGross('215');
  fireEvent.click(screen.getByRole('button', { name: 'Valider' }));
  expect(api.updatePlatformStatement).not.toHaveBeenCalled();
  expect(ctx.updateForm).toHaveBeenCalledWith(expect.objectContaining({ platformGrossAmount: 215 }));
});

test('a modified locked fiche must be saved or reverted before the statement is written', () => {
  renderFinance({ fichePristine: false });
  expect(screen.getByLabelText('Location (relevé)')).toBeDisabled();
  expect(screen.getByText(/Fiche modifiée : enregistrer ou annuler/)).toBeInTheDocument();
});

test('review H1 — a received solde of a direct-sale channel (not correctable) keeps the lock on a locked fiche', () => {
  const frozen = { ...RECEIVED, amountEdit: { editable: false, mode: 'locked', min: null, max: null, reason: 'Versement reçu le 05/06 : annuler la réception pour corriger les montants.' } };
  const ctx = makeMockContext({
    ledger: { rows: [frozen], closing: null }, editingReservationId: 22211, isReservationLocked: true,
    form: { platform: 'Lodgify', platformPayoutAmount: '' }, pricingQuote: {},
  });
  render(
    <DialogProvider>
      <ReservationFormProvider value={ctx}>
        <FinanceSection />
      </ReservationFormProvider>
    </DialogProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: /Montant figé/ }));
  expect(screen.queryByLabelText('Location (relevé)')).not.toBeInTheDocument();
  expect(api.previewPlatformStatement).not.toHaveBeenCalled();
});

test('review M1 — « Calculer la commission » reads the transfer typed in the panel', async () => {
  renderFinance();
  typeGross('215');
  const transfer = screen.getByLabelText('Virement reçu le 05/06 (€)');
  transfer.focus();
  fireEvent.change(transfer, { target: { value: '170' } });
  fireEvent.blur(transfer);
  api.computePlatformCommission.mockResolvedValueOnce({ commission: 45 });
  fireEvent.click(screen.getByRole('button', { name: /Calculer la commission/i }));
  await waitFor(() => expect(api.computePlatformCommission).toHaveBeenCalledWith(expect.objectContaining({ gross: 215, payout: 170 })));
});
