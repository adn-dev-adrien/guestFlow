import React from 'react';
import { render, screen } from '@testing-library/react';

import { ReservationFormProvider } from '../ReservationFormContext';
import ExtrasSection from '../ExtrasSection';
import { makeMockContext } from '../mockReservationForm';

// specs/force-extras-complement-on-platform.md §3 rule 4 + §7.2.
// On non-direct platform reservations, the per-line "Forcer en complément"
// small Switches are hidden + a muted caption replaces them at the top of the
// section. Direct reservations are unaffected.
//
// The Compl. toggle was reshaped in this branch: small Switch (`size="small"`)
// instead of a Checkbox, no inline label, aria-label "Forcer en complément" for
// screen readers + test queryability. Same visual family as the per-line
// activation Switch above, just smaller.

function renderExtras(overrides = {}) {
  // Seed enough state on the form to render every Switch branch (property option +
  // auto-option + custom option + resource). The auto-options Switch path requires
  // an auto-enabled option in the catalog AND a selected entry that flips it ON.
  // Destructure `form` out of overrides before re-spreading so it merges with the
  // seeded shape instead of replacing it.
  const { form: formOverride, ...restOverrides } = overrides;
  const baseCtx = makeMockContext({
    propertyOptions: [
      { id: 10, title: 'Petit-déjeuner', price: 10, priceType: 'per_person' },
      { id: 11, title: 'Late check-out', price: 20, priceType: 'per_stay', autoOptionType: 'late_check_out', autoEnabled: 1, autoPricingMode: 'fixed', autoFullNightThreshold: '17:00' },
    ],
    displayableResources: [{ id: 20, name: 'Vélo', price: 5, priceType: 'per_stay', available: 3 }],
    form: {
      selectedOptions: [
        { optionId: 10, quantity: 2, totalPrice: 20 },
        // The auto-timed option line needs `quantity > 0` for its "enabled" branch.
        { optionId: 11, quantity: 1, totalPrice: 20, autoFullNightApplied: true },
      ],
      customOptions: [
        { customKey: 'custom_1', description: 'Frais ménage', amount: 30, offered: false, inComplement: false },
      ],
      selectedResources: [{ resourceId: 20, quantity: 1, totalPrice: 5 }],
      ...formOverride,
    },
    ...restOverrides,
  });
  // Mock-context doesn't ship the per-line `inComplement` setters by default — they're called
  // only on user interaction. Add stubs so the destructure inside the component succeeds.
  baseCtx.setOptionInComplement = () => {};
  baseCtx.setResourceInComplement = () => {};
  baseCtx.setAutoOptionInComplement = () => {};
  render(
    <ReservationFormProvider value={baseCtx}>
      <ExtrasSection />
    </ReservationFormProvider>
  );
  return baseCtx;
}

test('direct reservation: 4 "Forcer en complément" Switches rendered (property option + auto-option + custom option + resource)', () => {
  renderExtras({ form: { platform: 'direct' } });
  // Each Compl. Switch carries aria-label="Forcer en complément" — the canonical
  // identifier the operator's screen reader announces too.
  const complementSwitches = screen.getAllByRole('switch', { name: 'Forcer en complément' });
  expect(complementSwitches).toHaveLength(4);
  // No platform caption.
  expect(screen.queryByText(/Réservation plateforme — les extras sont automatiquement/i)).not.toBeInTheDocument();
});

test('platform reservation: caption renders + ZERO "Forcer en complément" Switches', () => {
  renderExtras({ form: { platform: 'Airbnb' } });
  expect(screen.getByText(/Réservation plateforme — les extras sont automatiquement facturés en paiement complémentaire/i)).toBeInTheDocument();
  expect(screen.queryAllByRole('switch', { name: 'Forcer en complément' })).toHaveLength(0);
});

test('platform reservation: option totals (Chip) are unchanged — only the Compl. Switch disappears', () => {
  renderExtras({ form: { platform: 'GitesDeFrance' } });
  // The "Total: 20.00€" chip on the property option is still visible.
  expect(screen.getByText(/Total: 20\.00€/)).toBeInTheDocument();
  // And the auto-option total chip too.
  expect(screen.getByText(/Total auto:/)).toBeInTheDocument();
});

test('case-insensitive Direct enum: any casing of "direct" keeps the regular Compl. Switches', () => {
  // Mirrors the runtime guard `String(form.platform || '').toLowerCase() !== 'direct'`.
  for (const directVariant of ['direct', 'Direct', 'DIRECT']) {
    const ctx = makeMockContext({
      propertyOptions: [{ id: 10, title: 'Petit-déjeuner', price: 10, priceType: 'per_person' }],
      displayableResources: [],
      form: { platform: directVariant, selectedOptions: [{ optionId: 10, quantity: 1, totalPrice: 10 }] },
    });
    ctx.setOptionInComplement = () => {};
    ctx.setResourceInComplement = () => {};
    ctx.setAutoOptionInComplement = () => {};
    const { unmount } = render(
      <ReservationFormProvider value={ctx}>
        <ExtrasSection />
      </ReservationFormProvider>
    );
    // 1 Compl. Switch (the property option). Custom options block is empty + no resources.
    expect(screen.getAllByRole('switch', { name: 'Forcer en complément' }).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(/Réservation plateforme — les extras sont automatiquement/i)).not.toBeInTheDocument();
    unmount();
  }
});
