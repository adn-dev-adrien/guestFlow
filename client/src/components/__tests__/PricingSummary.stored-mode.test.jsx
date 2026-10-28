import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';

import PricingSummary from '../PricingSummary';

// specs/reservation-payment-ledger.md rules 50, 52 and 57 (and specs/pricing-summary-extraction.md rule 7) — the stored summary goes through the same
// component as the live quote: same sections, same labels, no per-line control, no notice.

const PROPERTY_OPTIONS = [{ id: 10, title: 'Petit-déjeuner', price: 25, priceType: 'per_stay' }];

const FORM = {
  startDate: '2099-09-15', endDate: '2099-09-17', finalPrice: 200, customPrice: '', platform: 'direct',
  touristTaxTotal: 4.8, depositAmount: 60, balanceAmount: 144.8, depositDueDate: '2099-08-01', balanceDueDate: '2099-08-16',
  cautionAmount: 300, depositPaid: 0, balancePaid: 0,
};

const OPTION_LINES = [
  { optionId: 10, title: 'Petit-déjeuner', quantity: 2, offered: false, totalPrice: 50, originalTotalPrice: 50, inComplement: 0 },
  { optionId: 11, title: 'Linge de lit', quantity: 1, offered: true, includedInRate: true, totalPrice: 0, originalTotalPrice: 70, inComplement: 0 },
  { optionId: 12, title: 'Parking', quantity: 1, offered: true, totalPrice: 0, originalTotalPrice: 15, inComplement: 0 },
  { isCustom: true, customKey: 'custom_1', title: 'Bouquet', quantity: 1, offered: false, totalPrice: 25, originalTotalPrice: 25, inComplement: 1 },
];
const NIGHTS = [
  { date: '2099-09-15', nightNumber: 1, price: 75 },
  { date: '2099-09-16', nightNumber: 2, price: 75 },
];

const QUOTE = {
  nights: 2, finalPrice: 200, totalStayPrice: 204.8, touristTaxTotal: 4.8, touristTaxOriginalTotal: 4.8, vatPercentageAccommodation: 10,
  totalNetPrice: 181.82, totalVatAmount: 18.18, optionLines: OPTION_LINES,
  resourceLines: [{ resourceId: 30, name: 'Bain nordique', quantity: 1, offered: false, totalPrice: 60, originalTotalPrice: 60, inComplement: 0 }],
  summaryCascade: { grossTotal: 204.8, offeredTaxDeduction: 0, onSiteTotal: 0, commissionBase: 204.8 },
  complementSplit: { arrival: 0, duringStay: 0, endOfStay: 0 }, sejourNetTotal: 204.8,
};

function renderSummary(mode, extra = {}) {
  const handlers = {
    onToggleOptionOffered: vi.fn(), onToggleCustomOptionOffered: vi.fn(), onToggleResourceOffered: vi.fn(),
    onToggleOptionInComplement: vi.fn(), onToggleTouristTaxInComplement: vi.fn(), onRefreshTouristTax: vi.fn(),
  };
  const view = render(
    <PricingSummary
      mode={mode}
      quote={{ ...QUOTE, ...extra }}
      form={FORM}
      nightlyBreakdown={NIGHTS}
      selectedProperty={{ name: 'La Granja' }}
      offeredOptionIds={new Set([11, 12])}
      propertyOptions={PROPERTY_OPTIONS}
      availableResources={[]}
      parsedTotalPrice={null}
      accommodationDiscountedPriceDisplay={150}
      isTouristTaxFrozen
      {...handlers}
    />,
  );
  return { ...view, handlers };
}

test('rule 50 — the stored mode renders the OPTIONS section, each line by name, and the nightly detail', () => {
  renderSummary('stored');
  expect(screen.getByText('Options')).toBeInTheDocument();
  for (const name of ['Petit-déjeuner ×2', 'Linge de lit', 'Parking', 'Bouquet', 'Bain nordique']) {
    expect(screen.getByText(name)).toBeInTheDocument();
  }
  expect(screen.getByRole('button', { name: 'Détail' })).toBeInTheDocument();
  expect(screen.getByText('(2 nuits)')).toBeInTheDocument();
});

test('rule 50 — an offered line keeps its state word and its real price struck through; « Comprise » for a rate-included one', () => {
  renderSummary('stored');
  expect(screen.getByText('Comprise')).toBeInTheDocument();
  expect(screen.getByText('✓ Offert')).toBeInTheDocument();
  expect(getComputedStyle(screen.getByText('70,00 €')).textDecoration).toContain('line-through');
  expect(screen.getByText('incluse dans le tarif')).toBeInTheDocument();
});

test('rule 50 — same section labels as the live mode for the same fixture', () => {
  const headings = (container) => [...container.querySelectorAll('p, span, label')]
    .map((n) => n.textContent.trim())
    .filter((t) => ['Prix hébergement', 'Options', 'Ressources', 'Taxe de séjour', 'Total HT', 'Total du séjour', 'Acompte', 'Solde', 'Caution'].includes(t));
  const live = renderSummary('live');
  const liveLabels = headings(live.container);
  live.unmount();
  const stored = renderSummary('stored');
  expect(headings(stored.container)).toEqual(liveLabels);
});

test('rule 52 — no « Offrir », no « compl. » toggle, no tax refresh and no tax detail toggle in the stored mode', () => {
  renderSummary('stored');
  expect(screen.queryByRole('button', { name: 'Offrir' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Offert|Comprise/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Recalculer la taxe de séjour/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Afficher détail|Masquer détail/ })).not.toBeInTheDocument();
  expect(screen.queryByText('+ compl.')).not.toBeInTheDocument();
});

test('rule 52 — a line routed to the complement keeps a read-only « compl. » hint', () => {
  renderSummary('stored');
  expect(screen.getByText('compl.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'compl.' })).not.toBeInTheDocument();
});

test('rules 57 and 64 — no notice about the calculation, no « Appliquer le calcul actuel »', () => {
  renderSummary('stored');
  expect(document.body).not.toHaveTextContent(/Montants enregistrés|calcul actuel|diffère|ancien tarif/i);
});

test('the live mode keeps its controls (the stored mode is the only one that drops them)', () => {
  renderSummary('live');
  expect(screen.getAllByRole('button', { name: /Offrir|Offert|Comprise/ }).length).toBeGreaterThan(0);
  expect(screen.getByRole('button', { name: /Recalculer la taxe de séjour/ })).toBeInTheDocument();
});
