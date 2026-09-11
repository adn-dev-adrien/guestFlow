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
  // Relative dates: the stay must stay in the future (the API rejects a past check-in) so the test
  // never ages out — a hard-coded 2026-09-10 broke the smoke run on 2026-09-11.
  const DAY = 86_400_000;
  const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
  const now = Date.now();
  const startDate = iso(now + 30 * DAY);
  const endDate = iso(now + 32 * DAY);
  const newStartDate = iso(now + 60 * DAY);
  const newEndDate = iso(now + 62 * DAY);

  const reservation = await createReservation({
    propertyId: property.id, clientId: client.id, startDate, endDate,
  });
  // Mark the reservation as iCal-sync-locked (otherwise the engine just rewrites the dates).
  lockIcalReservation(reservation.id);
  seedPendingDateDrift({
    reservationId: reservation.id,
    previousStartDate: startDate, previousEndDate: endDate,
    newStartDate, newEndDate,
  });

  await page.goto('/');
  // The alert title (specs/ical-sync-override-locked-dates.md §6.1).
  await expect(page.getByText(/Modifications de dates iCal/i)).toBeVisible({ timeout: 10_000 });
  // The proposed new start date appears in the alert body — built from the app's own short format
  // (displayDateShort → « 05 oct. 2026 »), tolerant to the ICU period/spacing.
  const p = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
    .formatToParts(new Date(`${newStartDate}T12:00:00`));
  const dd = p.find((x) => x.type === 'day').value;
  const mon = p.find((x) => x.type === 'month').value.replace('.', '');
  const yyyy = p.find((x) => x.type === 'year').value;
  await expect(
    page.getByText(new RegExp(`${dd}\\s+${mon}\\.?\\s+${yyyy}`, 'i')).or(page.getByText(newStartDate)),
  ).toBeVisible();
});
