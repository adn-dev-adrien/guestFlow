// @ts-check
// specs/non-card-option-served-persons.md rules 8, 9, 19, 20 and 26 — the two price types the party-change spec
// leaves out, against the real app: a number of nights typed stays that number when the stay moves and the field
// turns red; a per-person-per-night line shows its nights and follows party and stay while nobody types on it.
import { test, expect } from '@playwright/test';
import { createClient, createProperty, createReservation } from '../../fixtures/apiSeed.js';
import { seedPerPersonOption } from '../../fixtures/dbSeed.js';

const STAY_YEAR = new Date().getFullYear() + 1;

const optionCard = (page, title) => page.locator('.MuiCard-root').filter({ hasText: 'Options et ressources' }).first()
  .locator('.MuiCard-root').filter({ hasText: title }).last();
const qty = (page, title) => optionCard(page, title).getByLabel('Qté');
const saveButton = (page) => page.getByRole('button', { name: 'Enregistrer', exact: true });
const settled = (page) => expect(saveButton(page).and(page.locator(':enabled'))).toHaveCount(0, { timeout: 15_000 });
const savedStay = (page, id) => page.waitForResponse((res) => res.request().method() === 'PUT'
  && res.url().includes(`/api/reservations/${id}`) && res.ok());

async function type(locator, value) {
  await locator.fill(value);
  await locator.press('Tab');
}

async function openWithOption(page, { option, priceType, price, month }) {
  const property = await createProperty({ name: `E2E ${option} villa`, maxGuests: 12, singleBeds: 4, doubleBeds: 4 });
  const client = await createClient({ firstName: 'Typed', lastName: 'Nights' });
  seedPerPersonOption({ propertyId: property.id, title: option, price, priceType });
  const reservation = await createReservation({
    propertyId: property.id, clientId: client.id, startDate: `${STAY_YEAR}-${month}-04`, endDate: `${STAY_YEAR}-${month}-06`, adults: 4,
  });
  await page.goto(`/reservations/${reservation.id}`);
  await expect(page.getByLabel('Adultes')).toHaveValue('4', { timeout: 15_000 });
  await optionCard(page, option).locator('input[role="switch"]:not([aria-label="Forcer en complément"])').check();
  return reservation;
}

test('per night: a typed number of nights survives a longer stay, turns red, and the arrows apply the stay', async ({ page }) => {
  const option = 'E2E Bois';
  const reservation = await openWithOption(page, { option, priceType: 'per_night', price: 5, month: '09' });
  await expect(qty(page, option)).toHaveValue('2');
  await expect(optionCard(page, option).getByText(/Total: 10,00/)).toBeVisible();

  await type(qty(page, option), '3');
  await expect(optionCard(page, option).getByText(/Total: 15,00/)).toBeVisible();

  await Promise.all([savedStay(page, reservation.id), saveButton(page).click()]);
  await settled(page);
  await expect(async () => {
    await page.goto(`/reservations/${reservation.id}`);
    await expect(qty(page, option)).toHaveValue('3', { timeout: 5_000 });
  }).toPass({ timeout: 30_000 });
  await expect(qty(page, option)).toHaveAttribute('aria-invalid', 'false');

  await type(page.getByLabel('Date de départ'), `${STAY_YEAR}-09-08`);
  await expect(qty(page, option)).toHaveAttribute('aria-invalid', 'true');
  await expect(qty(page, option)).toHaveValue('3');
  await expect(optionCard(page, option).getByText('Saisi pour 2 nuits, séjour : 4')).toBeVisible();
  await expect(optionCard(page, option).getByText(/Total: 15,00/)).toBeVisible();

  await optionCard(page, option).getByRole('button', { name: 'Appliquer 4 nuits' }).click();
  await expect(qty(page, option)).toHaveValue('4');
  await expect(qty(page, option)).toHaveAttribute('aria-invalid', 'false');
  await expect(optionCard(page, option).getByText(/Total: 20,00/)).toBeVisible();
});

test('per person per night: the field shows its nights, and a line nobody typed follows the party and the stay', async ({ page }) => {
  const option = 'E2E Panier';
  await openWithOption(page, { option, priceType: 'per_person_per_night', price: 10, month: '10' });
  await expect(qty(page, option)).toHaveValue('4');
  await expect(optionCard(page, option).getByText('× 2 nuits')).toBeVisible();
  await expect(optionCard(page, option).getByText(/Total: 80,00/)).toBeVisible();

  await type(page.getByLabel('Adultes'), '5');
  await expect(qty(page, option)).toHaveValue('5');
  await expect(qty(page, option)).toHaveAttribute('aria-invalid', 'false');
  await expect(optionCard(page, option).getByText(/Total: 100,00/)).toBeVisible();

  await type(page.getByLabel('Date de départ'), `${STAY_YEAR}-10-07`);
  await expect(optionCard(page, option).getByText('× 3 nuits')).toBeVisible();
  await expect(qty(page, option)).toHaveValue('5');
  await expect(qty(page, option)).toHaveAttribute('aria-invalid', 'false');
  await expect(optionCard(page, option).getByText(/Total: 150,00/)).toBeVisible();
});
