// @ts-check
// specs/force-extras-complement-on-platform.md §7 — Playwright smoke for the user-visible
// behaviour: on a non-direct platform reservation, the Extras section shows the muted
// caption "Réservation plateforme — les extras sont automatiquement facturés en paiement
// complémentaire." and ZERO "Forcer en complément" Switches are present.
//
// Direct reservations are the inverse: no caption, ≥1 Compl. Switch on every selected
// extra. We don't seed any extras here (the catalog is empty in the e2e DB), so the
// direct check is implicit — covered by the Vitest unit tests
// `ExtrasSection.platform-force-complement.test.js`.
import { test, expect } from '@playwright/test';
import { createClient, createProperty, createReservation } from '../../fixtures/apiSeed.js';

test('platform reservation hides Compl. Switches + shows the caption in the Extras section', async ({ page }) => {
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

  // The user-visible signal that the routing is automatic.
  await expect(
    page.getByText(/Réservation plateforme — les extras sont automatiquement facturés en paiement complémentaire/i),
  ).toBeVisible();

  // The per-line "Forcer en complément" Switches are gone on platform reservations.
  // (Direct reservations would render ≥1 of these — see ExtrasSection.platform-force-complement.test.js.)
  await expect(page.getByRole('switch', { name: 'Forcer en complément' })).toHaveCount(0);
});
