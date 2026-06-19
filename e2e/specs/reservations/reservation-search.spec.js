// @ts-check
// specs/reservation-number-and-search.md — Playwright smoke for the reservation number + live search.
// Guards the user-visible flow AND the render (the search box mounts on the Dashboard/Calendar, so a
// crash here would blank those pages — exactly the regression this spec exists to catch).
import { test, expect } from '@playwright/test';
import { createClient, createProperty, createReservation } from '../../fixtures/apiSeed.js';

test('search by client name finds the reservation (with its number) and opens the fiche', async ({ page }) => {
  const property = await createProperty({ name: 'E2E search villa' });
  const client = await createClient({ firstName: 'Zoé', lastName: 'Searchableunique' });
  const reservation = await createReservation({
    propertyId: property.id,
    clientId: client.id,
    // Far-future window so the date-range never collides with another spec's seed.
    startDate: '2099-08-10',
    endDate: '2099-08-12',
    adults: 2,
  });
  // The create response carries the generated number (AAAA-MM-###).
  expect(reservation.reservationNumber).toMatch(/^\d{4}-\d{2}-\d{3}$/);

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Tableau de bord' })).toBeVisible({ timeout: 10_000 });

  const box = page.getByPlaceholder(/Rechercher une réservation/);
  await box.fill('Searchableunique');

  const option = page.getByRole('option').filter({ hasText: 'Zoé Searchableunique' });
  await expect(option).toBeVisible({ timeout: 10_000 });
  // The result line carries the reservation number (shaped server-side).
  await expect(option).toContainText(reservation.reservationNumber);

  // Selecting a result opens the reservation fiche, whose number field carries the value.
  await option.click();
  await expect(page).toHaveURL(new RegExp(`/reservations/${reservation.id}(\\?|$)`));
  await expect(page.getByLabel('Numéro de réservation')).toHaveValue(reservation.reservationNumber);
});

test('search by reservation number matches the reservation', async ({ page }) => {
  const property = await createProperty({ name: 'E2E search-by-number villa' });
  const client = await createClient({ firstName: 'Marc', lastName: 'Numbersearch' });
  const reservation = await createReservation({
    propertyId: property.id,
    clientId: client.id,
    startDate: '2099-10-05',
    endDate: '2099-10-08',
    adults: 2,
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Tableau de bord' })).toBeVisible({ timeout: 10_000 });

  await page.getByPlaceholder(/Rechercher une réservation/).fill(reservation.reservationNumber);
  const option = page.getByRole('option').filter({ hasText: reservation.reservationNumber });
  await expect(option).toBeVisible({ timeout: 10_000 });
  await expect(option).toContainText('Marc Numbersearch');
});
