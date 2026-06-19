// @ts-check
// specs/reservation-number-and-search.md — Playwright smoke for the reservation number + live search.
// Guards the user-visible flow AND the render (the search box mounts on the Dashboard/Calendar, so a
// crash here would blank those pages — exactly the regression this spec exists to catch).
import { test, expect } from '@playwright/test';
import { createClient, createProperty, createReservation } from '../../fixtures/apiSeed.js';

// Distinctive name so the seeded reservation is unambiguous in the results; every result line also
// carries the (globally-unique) reservation number, which is what the assertions filter on.
async function seedReservation({ firstName, lastName, startDate, endDate }) {
  const property = await createProperty({ name: `E2E search ${lastName}` });
  const client = await createClient({ firstName, lastName });
  const reservation = await createReservation({
    propertyId: property.id,
    clientId: client.id,
    // Far-future window so the date-range never collides with another spec's seed.
    startDate,
    endDate,
    adults: 2,
  });
  return { client, reservation };
}

test('search matches by number, first name, last name, and both name orders', async ({ page }) => {
  const { client, reservation } = await seedReservation({
    firstName: 'Amandine', lastName: 'Berthollet', startDate: '2099-08-10', endDate: '2099-08-12',
  });
  // The create response carries the generated number (AAAA-MM-###).
  expect(reservation.reservationNumber).toMatch(/^\d{4}-\d{2}-\d{3}$/);

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Tableau de bord' })).toBeVisible({ timeout: 10_000 });
  const box = page.getByPlaceholder(/Rechercher une réservation/);

  // Each of the 5 supported query forms must surface the same reservation. We filter the result on the
  // unique reservation number, so the assertion holds regardless of any other seeded data.
  const queries = {
    'numéro':       reservation.reservationNumber,
    'prénom':       client.firstName,
    'nom':          client.lastName,
    'prénom nom':   `${client.firstName} ${client.lastName}`,
    'nom prénom':   `${client.lastName} ${client.firstName}`,
  };

  for (const [label, query] of Object.entries(queries)) {
    await box.fill('');
    await box.fill(query);
    const option = page.getByRole('option').filter({ hasText: reservation.reservationNumber });
    await expect(option, `query by ${label} ("${query}") should match`).toBeVisible({ timeout: 10_000 });
    await expect(option).toContainText('Amandine Berthollet');
  }
});

test('selecting a result opens the reservation fiche, whose number field carries the value', async ({ page }) => {
  const { reservation } = await seedReservation({
    firstName: 'Marc', lastName: 'Numbersearch', startDate: '2099-10-05', endDate: '2099-10-08',
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Tableau de bord' })).toBeVisible({ timeout: 10_000 });

  await page.getByPlaceholder(/Rechercher une réservation/).fill('Numbersearch');
  const option = page.getByRole('option').filter({ hasText: reservation.reservationNumber });
  await expect(option).toBeVisible({ timeout: 10_000 });

  await option.click();
  await expect(page).toHaveURL(new RegExp(`/reservations/${reservation.id}(\\?|$)`));
  await expect(page.getByLabel('Numéro de réservation')).toHaveValue(reservation.reservationNumber);
});
