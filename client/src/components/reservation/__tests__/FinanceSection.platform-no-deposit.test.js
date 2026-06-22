import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';

import { ReservationFormProvider } from '../ReservationFormContext';
import FinanceSection from '../FinanceSection';
import { makeMockContext } from '../mockReservationForm';

// specs/accounting-platform-commission-and-no-deposit.md §3.8 rule 21 + §7.3.
// The Acompte block is HIDDEN on non-direct platform reservations (replaced by a muted
// caption "Pas d'acompte (réservation plateforme — virement unique)"). Direct bookings
// keep the regular Acompte block.

vi.mock('../../../api', () => ({ __esModule: true, default: { markPayment: vi.fn() } }));

function renderFinance(overrides) {
  const ctx = makeMockContext(overrides);
  render(
    <ReservationFormProvider value={ctx}>
      <FinanceSection />
    </ReservationFormProvider>
  );
  return ctx;
}

test("direct reservation: the Acompte block is rendered as usual", () => {
  renderFinance({ form: { platform: 'direct' } });
  // The Acompte heading sits in its own Grid column — present on direct.
  const acompteHeadings = screen.getAllByText('Acompte');
  expect(acompteHeadings.length).toBeGreaterThan(0);
  // The platform caption MUST NOT be present.
  expect(screen.queryByText(/Pas d'acompte/i)).not.toBeInTheDocument();
});

test("platform reservation (Airbnb): Acompte block is replaced by the no-deposit caption", () => {
  renderFinance({ form: { platform: 'Airbnb' } });
  // The caption is the user-facing signal that the platform has no deposit concept.
  expect(screen.getByText(/Pas d'acompte \(réservation plateforme — virement unique\)/i)).toBeInTheDocument();
});

test("platform reservation: the regular Acompte fields (échéance, montant) are NOT mounted", () => {
  renderFinance({ form: { platform: 'Gîtes de France' } });
  // The "Échéance acompte" field belongs to the direct-mode Acompte block; on a platform
  // reservation the whole block is gone so the input must not be in the DOM.
  expect(screen.queryByLabelText(/Échéance acompte/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/Marquer acompte payé/i)).not.toBeInTheDocument();
});

test("platform reservation: the Solde block stays rendered (it's the single encaissement on platforms)", () => {
  renderFinance({ form: { platform: 'Booking', balanceAmount: 200 } });
  // The Solde block is unaffected — it just absorbs the whole pre-arrival amount on platforms.
  const soldeHeadings = screen.getAllByText('Solde');
  expect(soldeHeadings.length).toBeGreaterThan(0);
});

test("case-insensitive Direct enum: 'Direct' / 'DIRECT' keep the regular Acompte block", () => {
  // The code path uses `String(form.platform || 'direct').toLowerCase() !== 'direct'` so any
  // casing variant of 'direct' should NOT trigger the platform caption.
  for (const directVariant of ['direct', 'Direct', 'DIRECT']) {
    const { unmount } = render(
      <ReservationFormProvider value={makeMockContext({ form: { platform: directVariant } })}>
        <FinanceSection />
      </ReservationFormProvider>
    );
    expect(screen.queryByText(/Pas d'acompte/i)).not.toBeInTheDocument();
    unmount();
  }
});

// specs/platform-commission-line.md (2026-06-22) — « Prix payé par le client » (clientGrossAmount) was
// retired; the platform block now exposes only the operator-entered « Commission plateforme » field.
test('platform reservation: « Commission plateforme » is shown, « Prix payé par le client » is gone', () => {
  renderFinance({ form: { platform: 'Airbnb' } });
  expect(screen.getByLabelText('Commission plateforme')).toBeInTheDocument();
  expect(screen.queryByLabelText('Prix payé par le client')).not.toBeInTheDocument();
});

test('direct reservation: no platform block (no commission field)', () => {
  renderFinance({ form: { platform: 'direct' } });
  expect(screen.queryByLabelText('Commission plateforme')).not.toBeInTheDocument();
});
