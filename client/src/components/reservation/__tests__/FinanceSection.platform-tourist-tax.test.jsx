import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { vi } from 'vitest';

import { ReservationFormProvider } from '../ReservationFormContext';
import DialogProvider from '../../DialogProvider';
import FinanceSection from '../FinanceSection';
import { makeMockContext } from './mockReservationForm';

// Amended 2026-11-26 (specs/platforms/platform-host-statement-and-commission-vat.md rules 1, 5, 8): the block takes the HOST side of the statement
// (« Location (relevé) » + « Options (relevé) »), the box is named by the platform's mode (the server's `platformStatement.box`), and the
// commission formula adds the tax paid with the transfer — resolved by the server from the platform sent with the figures.
//
// specs/tourist-tax/platform-tourist-tax-out-of-the-commission.md — the « Taxe de séjour retenue » box in the
// « Paiement plateforme » block: when it shows up, what it says, and what it does to the commission
// the « Calculer » button writes.
//
// The numbers are the Gîtes de France statement for Victor #22225 (26-28 June 2026):
// client 747,40 · taxe 14,40 · virement 668,00 → commission 65,00, not 79,40.

vi.mock('../../../api', () => ({ __esModule: true, default: { markPayment: vi.fn(), computePlatformCommission: vi.fn() } }));
import api from '../../../api';

const KEPT_BOX = { mode: 'platform', label: 'Taxe de séjour retenue par la plateforme', helper: 'Informatif : la plateforme la reverse à la commune, elle n’entre dans aucun prix.' };
const PAID_BOX = { mode: 'platform_reversed', label: 'Taxe de séjour versée avec le virement', helper: 'Celle de GuestFlow reste la taxe déclarée.' };
const OFFERED = { touristTaxOfferedByPlatform: true, touristTaxOriginalTotal: 14.40, platformStatement: { mode: 'platform', box: KEPT_BOX } };
const REVERSED = { touristTaxOfferedByPlatform: false, touristTaxReversedByPlatform: true, touristTaxOriginalTotal: 14.40, platformStatement: { mode: 'platform_reversed', box: PAID_BOX } };
const OWNER = { touristTaxOfferedByPlatform: false, touristTaxReversedByPlatform: false, touristTaxOriginalTotal: 14.40, platformStatement: { mode: 'owner', box: null } };

const PAYOUT = {
  key: 'balance', label: 'Versement', amount: 747.4, state: 'due', tone: 'due', stateLabel: 'Attendu le 22/10',
  action: { kind: 'mark', label: 'Marquer reçu', payout: { expected: 668 } },
  amountEdit: { editable: true, mode: 'statement', min: null, max: null, reason: null }, detail: null,
};

// Since specs/payments/reservation-payment-ledger.md rule 25 the statement fields open from the payout row's
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

// specs/platforms/booking-extranet-intake.md §4.1 — the commission is computed by the server
// (`POST /api/reservations/platform-commission`, rules in platform-commission.unit.test.js); the button
// only sends the figures of the statement and writes back what it answers, applied on « Valider ».
async function calculate(ctx) {
  api.computePlatformCommission.mockResolvedValueOnce({ commission: 123.45 });
  fireEvent.click(screen.getByRole('button', { name: /Calculer la commission/i }));
  await waitFor(() => expect(api.computePlatformCommission).toHaveBeenCalledWith({
    platform: ctx.form.platform,
    gross: ctx.form.platformGrossAmount,
    payout: ctx.form.platformPayoutAmount,
    touristTax: ctx.form.platformTouristTaxAmount ?? '',
    acompteCommission: ctx.form.acompteCommissionAmount ?? '',
  }));
  await waitFor(() => expect(screen.getByLabelText('Commission solde (€)')).toHaveValue('123,45'));
  fireEvent.click(screen.getByRole('button', { name: 'Valider' }));
  expect(ctx.updateForm).toHaveBeenCalledWith(expect.objectContaining({ platformCommissionAmount: 123.45 }));
}

const boxLabel = /Taxe de séjour (retenue par la plateforme|versée avec le virement)/i;

// ---------------------------------------------------------------------------
// rule 1 — where the box shows up
// ---------------------------------------------------------------------------

test('rule 1 — the box is shown when the platform collects AND remits the tax to the commune', () => {
  renderFinance({ form: { platform: 'Gîtes de France' }, pricingQuote: OFFERED });
  expect(screen.getByLabelText(boxLabel)).toBeInTheDocument();
});

test('rule 5 — a platform that reverses the tax to us has its box too: « versée avec le virement », with no « Reprendre le calcul »', () => {
  renderFinance({ form: { platform: 'Lodgify' }, pricingQuote: REVERSED });
  expect(screen.getByLabelText('Taxe de séjour versée avec le virement')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Reprendre le calcul/i })).not.toBeInTheDocument();
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

test('rule 1 — the block takes the host side: Location and Options, never the guest total', () => {
  renderFinance({ form: { platform: 'Gîtes de France', platformGrossAmount: 784, platformOptionsAmount: 0 }, pricingQuote: OFFERED });
  expect(screen.getByLabelText('Location (relevé)')).toHaveValue('784,00');
  expect(screen.getByLabelText('Options (relevé)')).toBeInTheDocument();
  expect(screen.queryByLabelText(/Montant total payé par le client/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/Montant hors taxe de séjour/i)).not.toBeInTheDocument();
});

test('rule 1 — the stored host amount splits into its location and its options; « Valider » writes the sum and the options', () => {
  const ctx = renderFinance({ form: { platform: 'Gîtes de France', platformGrossAmount: 864, platformOptionsAmount: 80 }, pricingQuote: OFFERED });
  expect(screen.getByLabelText('Location (relevé)')).toHaveValue('784,00');
  expect(screen.getByLabelText('Options (relevé)')).toHaveValue('80,00');
  fireEvent.click(screen.getByRole('button', { name: 'Valider' }));
  expect(ctx.updateForm).toHaveBeenCalledWith(expect.objectContaining({ platformGrossAmount: 864, platformOptionsAmount: 80 }));
});

// ---------------------------------------------------------------------------
// rule 10 — the commission
// ---------------------------------------------------------------------------

test(`rule 10 — « Calculer la commission » sends the withheld tax to the server`, async () => {
  const ctx = renderFinance({
    form: {
      platform: 'Gîtes de France',
      platformGrossAmount: 733,
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
      platformGrossAmount: 733,
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
// commission (specs/accounting/accounting-platform-commission-and-no-deposit.md).

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
