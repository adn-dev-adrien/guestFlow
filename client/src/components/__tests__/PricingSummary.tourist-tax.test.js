import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import PricingSummary from '../PricingSummary';

// Client-side regression coverage for the devis PDF bug fixes shipped in PR #112
// (`specs/devis-pdf-and-tourist-tax-fixes.md`). The PDF is server-rendered, but the
// fix's principle — "the calculation is owned by the backend and only displayed by
// the UI" — applies symmetrically here: PricingSummary MUST consume the engine quote
// fields (`touristTaxTotal`, `touristTaxUnitAmount`, `touristTaxAdultsCount`,
// `touristTaxNights`, `touristTaxLabel`) verbatim, never re-derive them client-side.
// A future refactor that silently introduces a JS re-computation (e.g. from
// `form.touristTaxTotal` or from `form.touristTaxRate × ...`) would re-open the gap
// between the PDF and the summary the user reported on 2026-06-04 — these tests pin
// against that.

const MIN_FORM = {
  startDate: '2099-09-15',
  endDate: '2099-09-17',
  finalPrice: 1000,
  customPrice: '',
  platform: 'direct',
  // The form keeps a `touristTaxTotal` for legacy plumbing; the bug-equivalent on
  // the client would be the summary preferring it over `quote.touristTaxTotal`.
  touristTaxTotal: 15.36,
  // PricingSummary renders deposit / balance / caution lines straight off the form
  // via `.toFixed(2)` — supply distinctive values so a "0,00 €" assertion on the tax
  // row stays unambiguous (the deposit/balance/caution amounts would collide).
  depositAmount: 300,
  balanceAmount: 700,
  cautionAmount: 500,
  depositPaid: 0,
  balancePaid: 0,
  depositDisabled: false,
};

const QUOTE_USER_BUG_SCENARIO = {
  // User's exact 2026-06-04 report: percentage-based tax (5 %) + 10 % department
  // surcharge → unit = 1,05 € / adult / night, 8 adults × 2 nights = 16,80 €.
  touristTaxTotal: 16.80,
  touristTaxOriginalTotal: 16.80,
  touristTaxUnitAmount: 1.05,
  touristTaxAdultsCount: 8,
  touristTaxNights: 2,
  touristTaxLabel: '(227.27EUR HT/nuit ÷ 12 occupants) x 5.00% + 10.00% dep = 1.05EUR/adulte/nuit',
  touristTaxOfferedByPlatform: false,
  touristTaxCollectedOnArrival: false,
  finalPrice: 1000,
  totalStayPrice: 1016.80,
  nights: 2,
  optionLines: [],
  resourceLines: [],
};

function renderSummary({ quote, form = MIN_FORM, selectedProperty = { name: 'Villa A' }, isPastReservation = false, onRefreshTouristTax } = {}) {
  return render(
    <PricingSummary
      quote={quote}
      form={form}
      selectedProperty={selectedProperty}
      offeredOptionIds={new Set()}
      propertyOptions={[]}
      availableResources={[]}
      parsedTotalPrice={1000}
      accommodationDiscountedPriceDisplay={'1000.00'}
      isPastReservation={isPastReservation}
      onRefreshTouristTax={onRefreshTouristTax}
    />
  );
}

describe('PricingSummary — tourist tax mirrors the engine quote (devis PDF parity)', () => {
  test('displayed total reads quote.touristTaxTotal, NOT form.touristTaxTotal (user-reported drift)', () => {
    // Bug-scenario drift: form carries the stale 15,36 € that used to leak into the PDF,
    // engine quote carries the authoritative 16,80 €. PricingSummary MUST show 16,80 €.
    renderSummary({ quote: QUOTE_USER_BUG_SCENARIO });
    expect(screen.getByText('16,80 €')).toBeInTheDocument();
    // The stale form value must NOT appear anywhere as the tax total.
    expect(screen.queryByText('15,36 €')).not.toBeInTheDocument();
  });

  test('tax detail breakdown is engine-authoritative: unitAmount × adults × nights', async () => {
    const user = userEvent.setup();
    renderSummary({ quote: QUOTE_USER_BUG_SCENARIO });
    // The detail panel is collapsed by default — open it.
    await user.click(screen.getByRole('button', { name: /Afficher détail/i }));
    // The engine label is rendered as-is (no client-side reformatting).
    expect(screen.getByText(/1\.05EUR\/adulte\/nuit/)).toBeInTheDocument();
    // The "Base:" line breakdown mirrors PDF's "8 pers. × 2 nuits × 1.05 € / pers./nuit"
    // — the engine fields, not a JS re-derivation from `form.touristTaxRate × people × nights`.
    expect(screen.getByText(/Base: 1,05 € x 8 adultes x 2 nuits/)).toBeInTheDocument();
  });

  test('tax of zero (engine reports no tax) → row shows 0, NEVER falls back to form.touristTaxTotal', () => {
    // Tax exists conceptually on every reservation; the row stays for VAT alignment.
    // The bug would resurface if the summary re-derived a non-zero amount from the
    // form when the engine returned 0 — pin against that. We rely on the negative
    // assertion (15,36 € MUST NOT appear) since the "0,00 €" displayed value collides
    // with other zero-amount rows in the panel.
    renderSummary({
      quote: { ...QUOTE_USER_BUG_SCENARIO, touristTaxTotal: 0, touristTaxOriginalTotal: 0 },
      form: { ...MIN_FORM, touristTaxTotal: 15.36 },
    });
    expect(screen.queryByText('15,36 €')).not.toBeInTheDocument();
    expect(screen.queryByText('16,80 €')).not.toBeInTheDocument();
  });

  test('quote omitted (initial load) → falls back to form.touristTaxTotal (no engine yet)', () => {
    // Before the first `/calculate-price` round-trip, the summary renders with no quote.
    // The legacy fallback to `form.touristTaxTotal` is intentional (prevents a flicker
    // when reopening a persisted devis) — pin it so it survives future refactors.
    renderSummary({ quote: null, form: { ...MIN_FORM, touristTaxTotal: 5.50 } });
    expect(screen.getByText('5,50 €')).toBeInTheDocument();
  });

  test('engine label is rendered verbatim — no client-side reformatting', async () => {
    // Pinning the "render, don't compute" contract: the engine ships
    // `touristTaxLabel` ready to display; the UI must never rebuild it from the
    // base rate (which is what the PDF was incorrectly doing pre-fix).
    const user = userEvent.setup();
    renderSummary({ quote: QUOTE_USER_BUG_SCENARIO });
    await user.click(screen.getByRole('button', { name: /Afficher détail/i }));
    expect(
      screen.getByText('(227.27EUR HT/nuit ÷ 12 occupants) x 5.00% + 10.00% dep = 1.05EUR/adulte/nuit')
    ).toBeInTheDocument();
  });
});

// specs/tourist-tax-freeze-past-with-refresh.md — a past reservation's tax is frozen; a refresh
// button next to the « Taxe de séjour » label forces a live recompute.
describe('PricingSummary — refresh button for a frozen (past) reservation', () => {
  test('no refresh button when the reservation is not past', () => {
    renderSummary({ quote: QUOTE_USER_BUG_SCENARIO, isPastReservation: false, onRefreshTouristTax: () => {} });
    expect(screen.queryByRole('button', { name: /Recalculer la taxe de séjour/i })).toBeNull();
  });

  test('past reservation → the refresh button shows and calls onRefreshTouristTax', async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn();
    renderSummary({ quote: QUOTE_USER_BUG_SCENARIO, isPastReservation: true, onRefreshTouristTax: onRefresh });
    const btn = screen.getByRole('button', { name: /Recalculer la taxe de séjour/i });
    await user.click(btn);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});

// specs/per-platform-tourist-tax-three-way.md §6.2 — case 2 (platform collects AND remits the tax to
// the commune itself). The fiche shows the tax amount STRUCK THROUGH (it never lands in our books)
// but NOT labelled "Offert" — it isn't a geste commercial. A short neutral caption explains who
// handles it.
describe('PricingSummary — tourist tax case 2 (platform collects + remits to the commune)', () => {
  const QUOTE_OFFERED_BY_PLATFORM = {
    touristTaxTotal: 0, // nets to 0 in our books — the platform handles it
    touristTaxOriginalTotal: 16.80, // the struck-through amount we still surface for context
    touristTaxUnitAmount: 1.05,
    touristTaxAdultsCount: 8,
    touristTaxNights: 2,
    touristTaxLabel: 'taxe collectée par la plateforme',
    touristTaxOfferedByPlatform: true,
    touristTaxCollectedOnArrival: false,
    touristTaxReversedByPlatform: false,
    finalPrice: 1000,
    totalStayPrice: 1000,
    nights: 2,
    optionLines: [],
    resourceLines: [],
  };

  test('shows the gross amount + a « Plateforme » tag, never "Offert"', () => {
    renderSummary({ quote: QUOTE_OFFERED_BY_PLATFORM });
    // The original gross is surfaced (shown normally, no longer struck-through), not the netted 0.
    expect(screen.getByText('16,80 €')).toBeInTheDocument();
    // No "Offert" badge — this is not a geste commercial.
    expect(screen.queryByText(/Offert/i)).toBeNull();
    // A short « Plateforme » tag says the tax is handled platform-side (clearer than the struck amount).
    expect(screen.getByText('Plateforme')).toBeInTheDocument();
    // A short neutral caption explains the routing.
    expect(screen.getByText('Collectée et reversée à la commune par la plateforme')).toBeInTheDocument();
  });
});
