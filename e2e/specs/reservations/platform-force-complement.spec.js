// @ts-check
// specs/force-extras-complement-on-platform.md §7 — Playwright smoke for the user-visible
// behaviour: on a non-direct platform reservation, the Extras section shows the muted caption
// "Réservation plateforme — les extras sont placés en paiement complémentaire par défaut
// (modifiable par ligne)." The per-line "Forcer en complément" Switches now STAY visible on
// operator-added extras (spec rule 1bis) — we don't seed any extras here (the e2e catalog is empty),
// so the switch count is trivially 0; the editable-switch behaviour is covered by the Vitest unit
// test `ExtrasSection.platform-force-complement.test.js`.
import { test, expect } from '@playwright/test';
import { createClient, createProperty, createReservation } from '../../fixtures/apiSeed.js';

test('platform reservation shows the default-routing caption in the Extras section', async ({ page }) => {
  const property = await createProperty({ name: 'E2E platform-force-complement villa' });
  const client = await createClient({ firstName: 'Test', lastName: 'PlatformForce' });
  const reservation = await createReservation({
    propertyId: property.id,
    clientId: client.id,
    // Far-future window so the date-range never collides with another spec's seed.
    startDate: '2099-09-15',
    endDate: '2099-09-17',
    adults: 2,
    platform: 'Airbnb',
  });

  await page.goto(`/reservations/${reservation.id}`);
  // The Extras section card heading anchors the page render.
  await expect(page.getByText('Options et ressources', { exact: true })).toBeVisible({ timeout: 10_000 });

  // The user-visible signal that extras default into Complément (but stay editable per line).
  await expect(
    page.getByText(/Réservation plateforme — les extras sont placés en paiement complémentaire par défaut/i),
  ).toBeVisible();

  // No extras are seeded in the e2e catalog, so no per-line Switch renders here. The editable-switch
  // behaviour on platform is covered by ExtrasSection.platform-force-complement.test.js.
  await expect(page.getByRole('switch', { name: 'Forcer en complément' })).toHaveCount(0);
});
