import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';

import { ReservationFormProvider } from '../ReservationFormContext';
import DialogProvider from '../../DialogProvider';
import FinanceSection from '../FinanceSection';
import { makeMockContext } from '../mockReservationForm';

// specs/platform-tourist-tax-out-of-the-commission.md — the « Taxe de séjour retenue » box in the
// « Paiement plateforme » block: when it shows up, what it says, and what it does to the commission
// the « Calculer » button writes.
//
// The numbers are the Gîtes de France statement for Grimaud #22225 (26-28 June 2026):
// client 747,40 · taxe 14,40 · virement 668,00 → commission 65,00, not 79,40.

vi.mock('../../../api', () => ({ __esModule: true, default: { markPayment: vi.fn() } }));

const OFFERED = { touristTaxOfferedByPlatform: true, touristTaxOriginalTotal: 14.40 };
const REVERSED = { touristTaxOfferedByPlatform: false, touristTaxReversedByPlatform: true, touristTaxOriginalTotal: 14.40 };
const OWNER = { touristTaxOfferedByPlatform: false, touristTaxReversedByPlatform: false, touristTaxOriginalTotal: 14.40 };

function renderFinance(overrides) {
  const ctx = makeMockContext(overrides);
  render(
    <DialogProvider>
      <ReservationFormProvider value={ctx}>
        <FinanceSection />
      </ReservationFormProvider>
    </DialogProvider>,
  );
  return ctx;
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
  expect(ctx.updateForm).toHaveBeenCalledWith({ platformTouristTaxAmount: 14.40 });
});

test('rule 14 — an empty box keeps the tax-excluded label; a filled one says « payé par le client »', () => {
  const { unmount } = render(
    <DialogProvider>
      <ReservationFormProvider value={makeMockContext({
        form: { platform: 'Gîtes de France', platformTouristTaxAmount: '' },
        pricingQuote: OFFERED,
      })}>
        <FinanceSection />
      </ReservationFormProvider>
    </DialogProvider>,
  );
  expect(screen.getByLabelText(/Total séjour facturé par la plateforme/i)).toBeInTheDocument();
  unmount();

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

test('rule 10 — « Calculer la commission » subtracts the withheld tax: 65,00 and not 79,40', () => {
  const ctx = renderFinance({
    form: {
      platform: 'Gîtes de France',
      platformGrossAmount: 747.40,
      platformPayoutAmount: 668,
      platformTouristTaxAmount: 14.40,
    },
    pricingQuote: OFFERED,
  });

  fireEvent.click(screen.getByRole('button', { name: /Calculer la commission/i }));
  expect(ctx.updateForm).toHaveBeenCalledWith({ platformCommissionAmount: 65 });
});

test('rule 10 — an empty box reproduces the August formula exactly', () => {
  const ctx = renderFinance({
    form: {
      platform: 'Gîtes de France',
      platformGrossAmount: 733,
      platformPayoutAmount: 668,
      platformTouristTaxAmount: '',
    },
    pricingQuote: OFFERED,
  });

  fireEvent.click(screen.getByRole('button', { name: /Calculer la commission/i }));
  expect(ctx.updateForm).toHaveBeenCalledWith({ platformCommissionAmount: 65 });
});

test('rule 10 — an acompte commission is still taken out first', () => {
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

  fireEvent.click(screen.getByRole('button', { name: /Calculer la commission/i }));
  expect(ctx.updateForm).toHaveBeenCalledWith({ platformCommissionAmount: 55 });
});

test('rule 10 — the commission is clamped at 0, never negative', () => {
  const ctx = renderFinance({
    form: {
      platform: 'Gîtes de France',
      platformGrossAmount: 700,
      platformPayoutAmount: 700,
      platformTouristTaxAmount: 14.40,
    },
    pricingQuote: OFFERED,
  });

  fireEvent.click(screen.getByRole('button', { name: /Calculer la commission/i }));
  expect(ctx.updateForm).toHaveBeenCalledWith({ platformCommissionAmount: 0 });
});
