import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import PricingSummary from '../PricingSummary';

// specs/tourist-tax-matches-the-office-calculation.md rules 12, 15 and 16 — what the fiche says about
// a tourist tax it did not just compute.
//
// The bug this covers: a frozen stay showed its pinned AMOUNT above a caption recomputed under
// today's rule, so the fiche read « 3,14 €/adulte/nuit » next to 11,96 € — figures that contradict
// each other and cannot be retyped into the commune's form. The caption now comes from the frozen
// base, and the fiche says when the amount was pinned.

const FORM = {
  startDate: '2026-08-03',
  endDate: '2026-08-05',
  finalPrice: 315,
  customPrice: '',
  platform: 'Abracadaroom',
  touristTaxTotal: 11.96,
  depositAmount: 0,
  balanceAmount: 294.74,
  cautionAmount: 400,
  depositPaid: 0,
  balancePaid: 1,
  depositDisabled: true,
};

// The Esteve stay, frozen: 217,45 € HT ÷ 2 nuits ÷ 2 occupants → 2,99 €/adulte/nuit → 11,96 €.
const FROZEN_QUOTE = {
  touristTaxTotal: 11.96,
  touristTaxOriginalTotal: 11.96,
  touristTaxUnitAmount: 2.99,
  touristTaxAdultsCount: 2,
  touristTaxNights: 2,
  touristTaxOccupantsCount: 2,
  touristTaxBaseHt: 217.45,
  touristTaxLabel: '(217.45EUR HT ÷ 2 nuits ÷ 2 occupants = 108.73EUR HT/nuit) x 5.00% + 10.00% dep = 2.99EUR/adulte/nuit',
  touristTaxFrozen: true,
  touristTaxFrozenAt: '2026-09-01 12:00:00',
  touristTaxOfferedByPlatform: false,
  touristTaxCollectedOnArrival: true,
  finalPrice: 315,
  totalStayPrice: 326.96,
  nights: 2,
  optionLines: [],
  resourceLines: [],
};

// The breakdown is collapsed by default behind « Afficher détail » — open it, since that is where the
// figures the operator retypes into the commune's form live.
async function openDetail() {
  await userEvent.setup().click(screen.getByText('Afficher détail'));
}

function renderSummary(quote, props = {}) {
  return render(
    <PricingSummary
      quote={quote}
      form={FORM}
      selectedProperty={{ name: 'Aventura lodge' }}
      isTouristTaxFrozen={Boolean(quote.touristTaxFrozen)}
      onRefreshTouristTax={() => {}}
      {...props}
    />,
  );
}

describe('PricingSummary — a frozen tourist tax explains itself', () => {
  test('the caption opens on the stay base HT the commune form asks for', async () => {
    renderSummary(FROZEN_QUOTE);
    await openDetail();
    // Rendered verbatim from the quote — the client re-derives nothing (CLAUDE.md §6.0).
    expect(screen.getByText(/217\.45EUR HT ÷ 2 nuits ÷ 2 occupants/)).toBeInTheDocument();
  });

  test('the amount shown is the frozen one, and the caption reproduces it', async () => {
    renderSummary(FROZEN_QUOTE);
    expect(screen.getByText('11,96 €')).toBeInTheDocument();
    await openDetail();
    // 2,99 € × 2 adultes × 2 nuits = 11,96 € — the two lines answer each other.
    expect(screen.getByText(/2,99 € x 2 adultes x 2 nuits/)).toBeInTheDocument();
  });

  test('it says when the amount was pinned', async () => {
    renderSummary(FROZEN_QUOTE);
    await openDetail();
    expect(screen.getByText('Figée le 01/09/2026')).toBeInTheDocument();
  });

  test('a live tax carries no freeze mention', async () => {
    renderSummary({ ...FROZEN_QUOTE, touristTaxFrozen: false, touristTaxFrozenAt: null });
    await openDetail();
    expect(screen.queryByText(/Figée le/)).toBeNull();
  });
});

describe('PricingSummary — an inconsistent platform brut is surfaced', () => {
  test('rule 16 — the warning shows when the brut cannot cover the extras', () => {
    renderSummary({ ...FROZEN_QUOTE, touristTaxFrozen: false, touristTaxBrutInconsistent: true });
    expect(screen.getByText(/Le brut plateforme ne couvre pas les extras facturés/)).toBeInTheDocument();
  });

  test('no warning on a consistent brut', () => {
    renderSummary(FROZEN_QUOTE);
    expect(screen.queryByText(/ne couvre pas les extras facturés/)).toBeNull();
  });
});
