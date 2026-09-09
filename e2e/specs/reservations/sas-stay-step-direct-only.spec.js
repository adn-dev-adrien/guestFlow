// @ts-check
// specs/collect-stay-payment-at-check-in.md rule 6 (revised 2026-09-08) — the « Séjour à régler »
// step of the arrival SAS is DIRECT-channel only: a platform solde is the OTA's payout, never money
// to claim at the door, while the guest's unpaid complements are still collected. Pinned through the
// real server as the admin session: the client renders whatever `stayPayment.applicable` says
// (covered by the ReservationSasDialog vitest suites), so the server's answer is the contract.
import { test, expect } from '@playwright/test';
import { createClient, createProperty, createReservation } from '../../fixtures/apiSeed.js';

function isoDay(offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

test('a Booking arrival with an unpaid solde gets no « Séjour à régler » step', async ({ request }) => {
  const property = await createProperty({ name: 'E2E séjour OTA', basePrice: 150 });
  const client = await createClient({ firstName: 'Ota', lastName: 'Impayé' });
  const reservation = await createReservation({
    propertyId: property.id, clientId: client.id,
    startDate: isoDay(0), endDate: isoDay(2), adults: 2, platform: 'Booking',
  });

  const res = await request.get(`/api/reservations/${reservation.id}/sas?mode=arrival`);
  expect(res.ok()).toBeTruthy();
  const sas = await res.json();
  expect(sas.stayPayment.applicable).toBe(false);
  expect(sas.stayPayment.channel).toBe('platform');
});

test('a direct arrival with an unpaid solde keeps the step — the founding last-minute case', async ({ request }) => {
  const property = await createProperty({ name: 'E2E séjour direct', basePrice: 150 });
  const client = await createClient({ firstName: 'Direct', lastName: 'Impayé' });
  const reservation = await createReservation({
    propertyId: property.id, clientId: client.id,
    startDate: isoDay(0), endDate: isoDay(2), adults: 2, platform: 'direct',
  });

  const res = await request.get(`/api/reservations/${reservation.id}/sas?mode=arrival`);
  expect(res.ok()).toBeTruthy();
  const sas = await res.json();
  expect(sas.stayPayment.applicable).toBe(true);
  expect(sas.stayPayment.channel).toBe('direct');
  expect(sas.stayPayment.total).toBeGreaterThan(0);
});
