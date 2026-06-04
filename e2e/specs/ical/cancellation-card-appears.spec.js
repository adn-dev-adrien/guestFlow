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
  const reservation = await createReservation({
    propertyId: property.id, clientId: client.id,
    startDate: '2026-09-15', endDate: '2026-09-17',
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
