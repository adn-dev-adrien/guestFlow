// @ts-check
// Test 8/24 — ical/cancellation-card-appears (spec §3.4 row 10).
// Seed a reservation + a pending row in `ical_cancellation_alerts`. Reload the Dashboard.
// Assert the orange card is visible. Pins the Dashboard surfacing of
// `ical-cancellation-approval` §6.1 alerts.
import { test, expect } from '@playwright/test';
import { createClient, createProperty, createReservation, createIcalSource } from '../../fixtures/apiSeed.js';
import { seedPendingCancellation } from '../../fixtures/dbSeed.js';

test('A pending cancellation alert renders an orange card on the Dashboard', async ({ page }) => {
  const property = await createProperty({ name: 'Cancel Property' });
  const client = await createClient({ firstName: 'Cancel', lastName: 'Tester' });
  // Dates are relative to today: hard-coded ones eventually fall into the past, and the API
  // answers 409 « Impossible de réserver dans le passé » (this suite started failing on 2026-09-16,
  // the day after the literal it used to carry). Same shape as date-drift-card-appears.spec.js.
  const DAY = 24 * 60 * 60 * 1000;
  const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
  const now = Date.now();
  const reservation = await createReservation({
    propertyId: property.id, clientId: client.id,
    startDate: iso(now + 30 * DAY), endDate: iso(now + 32 * DAY),
  });
  const source = await createIcalSource({ propertyId: property.id, name: 'Cancel feed', platformLabel: 'Airbnb' });
  seedPendingCancellation({
    reservationId: reservation.id,
    sourceId: source.id,
    eventUid: 'TEST-CANCEL-UID',
  });

  await page.goto('/');
  await expect(page.getByText(/Annulations iCal/i)).toBeVisible({ timeout: 10_000 });
  // The source name appears in the card body.
  await expect(page.getByText(/Cancel feed|Airbnb/i)).toBeVisible();
});
