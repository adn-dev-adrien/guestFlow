import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { vi } from 'vitest';

import { ReservationFormProvider } from '../ReservationFormContext';
import DialogProvider from '../../DialogProvider';
import FinanceSection from '../FinanceSection';
import { makeMockContext } from './mockReservationForm';

// specs/platform-tourist-tax-out-of-the-commission.md — the « Taxe de séjour retenue » box in the
// « Paiement plateforme » block: when it shows up, what it says, and what it does to the commission
// the « Calculer » button writes.
//
// The numbers are the Gîtes de France statement for Grimaud #22225 (26-28 June 2026):
// client 747,40 · taxe 14,40 · virement 668,00 → commission 65,00, not 79,40.

vi.mock('../../../api', () => ({ __esModule: true, default: { markPayment: vi.fn(), computePlatformCommission: vi.fn() } }));
import api from '../../../api';

const OFFERED = { touristTaxOfferedByPlatform: true, touristTaxOriginalTotal: 14.40 };
const REVERSED = { touristTaxOfferedByPlatform: false, touristTaxReversedByPlatform: true, touristTaxOriginalTotal: 14.40 };
const OWNER = { touristTaxOfferedByPlatform: false, touristTaxReversedByPlatform: false, touristTaxOriginalTotal: 14.40 };

const PAYOUT = {
  key: 'balance', label: 'Versement', amount: 747.4, state: 'due', tone: 'due', stateLabel: 'Attendu le 22/10',
  action: { kind: 'mark', label: 'Marquer reçu', payout: { expected: 668 } },
  amountEdit: { editable: true, mode: 'statement', min: null, max: null, reason: null }, detail: null,
};

// Since specs/reservation-payment-ledger.md rule 25 the statement fields open from the payout row's
// amount: a platform fiche is rendered with that editor open; a direct one has no payout row.
function renderFinance(overrides) {
  const platform = overrides && overrides.form && overrides.form.platform;
  const direct = !platform || String(platform).toLowerCase() === 'direct';
  const ctx = makeMockContext({ ledger: { rows: direct ? [] : [PAYOUT], closing: null }, ...overrides });
  render(
    <DialogProvider>
      <ReservationFormProvider value={ctx}>
        <FinanceSection />
      </ReservationFormProvider>
    </DialogProvider>,
  );
  if (!direct) fireEvent.click(screen.getByRole('button', { name: /Modifier le montant/ }));
  return ctx;
}

// specs/booking-extranet-intake.md §4.1 — the commission is computed by the server
// (`POST /api/reservations/platform-commission`, rules in platform-commission.unit.test.js); the button
// only sends the figures of the statement and writes back what it answers, applied on « Valider ».
async function calculate(ctx) {
  api.computePlatformCommission.mockResolvedValueOnce({ commission: 123.45 });
  fireEvent.click(screen.getByRole('button', { name: /Calculer la commission/i }));
  await waitFor(() => expect(api.computePlatformCommission).toHaveBeenCalledWith({
    gross: ctx.form.platformGrossAmount,
    payout: ctx.form.platformPayoutAmount,
    touristTax: ctx.form.platformTouristTaxAmount ?? '',
    acompteCommission: ctx.form.acompteCommissionAmount ?? '',
  }));
  await waitFor(() => expect(screen.getByLabelText('Commission solde (€)')).toHaveValue('123,45'));
  fireEvent.click(screen.getByRole('button', { name: 'Valider' }));
  expect(ctx.updateForm).toHaveBeenCalledWith(expect.objectContaining({ platformCommissionAmount: 123.45 }));
}

const boxLabel = /Taxe de séjour retenue/i;

// ---------------------------------------------------------------------------
// rule 1 — where the box shows up
// ---------------------------------------------------------------------------

test('rule 1 — the box is shown when the platform collects AND remits the tax to the commune', () => {
  renderFinance({ form: { platform: 'Gîtes de France' }, pricingQuote: OFFERED });
  expect(screen.getByLabelText(boxLabel)).toBeInTheDocument();
});

test('rule 1 — no box on a platform that reverses the tax to us', () => {
  renderFinance({ form: { platform: 'Lodgify' }, pricingQuote: REVERSED });
  expect(screen.queryByLabelText(boxLabel)).not.toBeInTheDocument();
});

test('rule 1 — no box on a platform whose tax we collect at arrival', () => {
  renderFinance({ form: { platform: 'Abracadaroom' }, pricingQuote: OWNER });
  expect(screen.queryByLabelText(boxLabel)).not.toBeInTheDocument();
});

test('rule 1 — no box (and no platform block) on a direct booking', () => {
  renderFinance({ form: { platform: 'direct' }, pricingQuote: OFFERED });
  expect(screen.queryByLabelText(boxLabel)).not.toBeInTheDocument();
});

// ---------------------------------------------------------------------------
// rules 5 + 14 — the button, and the label that states the convention
// ---------------------------------------------------------------------------

test('rule 5 — « Reprendre le calcul » writes the engine’s figure into the box', () => {
  const ctx = renderFinance({
    form: { platform: 'Gîtes de France', platformTouristTaxAmount: '' },
    pricingQuote: OFFERED,
  });

  fireEvent.click(screen.getByRole('button', { name: /Reprendre le calcul/i }));
  expect(screen.getByLabelText(boxLabel)).toHaveValue('14,40');
  fireEvent.click(screen.getByRole('button', { name: 'Valider' }));
  expect(ctx.updateForm).toHaveBeenCalledWith(expect.objectContaining({ platformTouristTaxAmount: 14.40 }));
});

test('rule 14 — an empty box keeps the tax-excluded label; a filled one says « payé par le client »', () => {
  renderFinance({
    form: { platform: 'Gîtes de France', platformTouristTaxAmount: '' },
    pricingQuote: OFFERED,
  });
  expect(screen.getByLabelText(/Total séjour facturé par la plateforme/i)).toBeInTheDocument();
  cleanup();

  renderFinance({
    form: { platform: 'Gîtes de France', platformTouristTaxAmount: 14.40 },
    pricingQuote: OFFERED,
  });
  expect(screen.getByLabelText(/Montant total payé par le client/i)).toBeInTheDocument();
  expect(screen.getByText(/taxe de séjour comprise/i)).toBeInTheDocument();
});

// ---------------------------------------------------------------------------
// rule 12 — the amount that carries the VAT
// ---------------------------------------------------------------------------

test('rule 12 — the block prints the tax-excluded amount, which is no longer the number typed above', () => {
  renderFinance({
    form: { platform: 'Gîtes de France', platformGrossAmount: 747.40, platformTouristTaxAmount: 14.40 },
    pricingQuote: OFFERED,
  });

  expect(screen.getByText(/Montant hors taxe de séjour/i)).toBeInTheDocument();
  expect(screen.getByText('733,00 €')).toBeInTheDocument();
});

test('rule 12 — nothing is printed while the box is empty (the amount is the brut itself)', () => {
  renderFinance({
    form: { platform: 'Gîtes de France', platformGrossAmount: 733, platformTouristTaxAmount: '' },
    pricingQuote: OFFERED,
  });

  expect(screen.queryByText(/Montant hors taxe de séjour/i)).not.toBeInTheDocument();
});

// ---------------------------------------------------------------------------
// rule 10 — the commission
// ---------------------------------------------------------------------------

test(`rule 10 — « Calculer la commission » sends the withheld tax to the server`, async () => {
  const ctx = renderFinance({
    form: {
      platform: 'Gîtes de France',
      platformGrossAmount: 747.40,
      platformPayoutAmount: 668,
      platformTouristTaxAmount: 14.40,
    },
    pricingQuote: OFFERED,
  });

  await calculate(ctx);
});

test(`rule 10 — an empty box is sent as is: the server reproduces the August formula`, async () => {
  const ctx = renderFinance({
    form: {
      platform: 'Gîtes de France',
      platformGrossAmount: 733,
      platformPayoutAmount: 668,
      platformTouristTaxAmount: '',
    },
    pricingQuote: OFFERED,
  });

  await calculate(ctx);
});

test(`rule 10 — the acompte commission is sent too`, async () => {
  const ctx = renderFinance({
    form: {
      platform: 'Gîtes de France',
      platformGrossAmount: 747.40,
      platformPayoutAmount: 668,
      platformTouristTaxAmount: 14.40,
      acompteCommissionAmount: 10,
    },
    pricingQuote: OFFERED,
  });

  await calculate(ctx);
});

test(`rule 10 — the figure the server answers is written, even 0`, async () => {
  const ctx = renderFinance({
    form: {
      platform: 'Gîtes de France',
      platformGrossAmount: 700,
      platformPayoutAmount: 700,
      platformTouristTaxAmount: 14.40,
    },
    pricingQuote: OFFERED,
  });

  await calculate(ctx);
});

// ---------------------------------------------------------------------------
// rule 24 — what the operator copies off a Booking statement
// ---------------------------------------------------------------------------
// Réservation 22219 (Booking, 17-19 July 2026, 8 guests), measured 2026-09-25: Montant Total
// 1 283,34 · virement 1 075,27. Booking withheld 208,07, of which 19,20 is the commune's tax
// (8 × 2 × 1,20) and 188,87 is commission and payment fees — which the fiche models as one
// commission (specs/accounting-platform-commission-and-no-deposit.md).

const BOOKING_22219 = { touristTaxOfferedByPlatform: true, touristTaxOriginalTotal: 19.20 };

test(`rule 24 — a Booking statement: Montant Total and withheld tax go to the server`, async () => {
  const ctx = renderFinance({
    form: {
      platform: 'Booking',
      platformGrossAmount: 1283.34,
      platformPayoutAmount: 1075.27,
      platformTouristTaxAmount: 19.20,
    },
    pricingQuote: BOOKING_22219,
  });

  await calculate(ctx);
});

test(`rule 24 — the same entry with an empty box is sent without a tax`, async () => {
  const ctx = renderFinance({
    form: {
      platform: 'Booking',
      platformGrossAmount: 1283.34,
      platformPayoutAmount: 1075.27,
      platformTouristTaxAmount: '',
    },
    pricingQuote: BOOKING_22219,
  });

  await calculate(ctx);
});
