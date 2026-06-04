// @ts-check
// Test 7/24 — ical/date-drift-card-appears (spec §3.4 row 9).
// Seed a reservation + a pending row in `ical_date_drift_alerts` directly. Reload the
// Dashboard. Assert the orange card with the proposed dates is visible. Pins the
// Dashboard surfacing of `ical-sync-override-locked-dates` §6.1 alerts.
import { test, expect } from '@playwright/test';
import { createClient, createProperty, createReservation } from '../../fixtures/apiSeed.js';
import { seedPendingDateDrift, lockIcalReservation } from '../../fixtures/dbSeed.js';

test('A pending date-drift alert renders an orange card on the Dashboard', async ({ page }) => {
  const property = await createProperty({ name: 'Drift Property' });
  const client = await createClient({ firstName: 'Drift', lastName: 'Tester' });
  const reservation = await createReservation({
    propertyId: property.id, clientId: client.id,
    startDate: '2026-09-10', endDate: '2026-09-12',
  });
  // Mark the reservation as iCal-sync-locked (otherwise the engine just rewrites the dates).
  lockIcalReservation(reservation.id);
  seedPendingDateDrift({
    reservationId: reservation.id,
    previousStartDate: '2026-09-10', previousEndDate: '2026-09-12',
    newStartDate: '2026-10-05',      newEndDate: '2026-10-07',
  });

  await page.goto('/');
  // The alert title (specs/ical-sync-override-locked-dates.md §6.1).
  await expect(page.getByText(/Modifications de dates iCal/i)).toBeVisible({ timeout: 10_000 });
  // The new dates appear somewhere in the alert body.
  await expect(page.getByText(/05 oct\.? 2026/i).or(page.getByText('2026-10-05'))).toBeVisible();
});
