// @ts-check
// specs/review-2026-10-18-reservations.md rules 6 and 7 — the fiche and the calendar never scroll
// sideways: at 900 px the fiche is one column and its bar drops the centred client name; a long
// property name ellipsises in its select instead of widening the page (review 2026-10-18, M-4, M-5).
import { test, expect } from '@playwright/test';
import { createClient, createProperty, createReservation } from '../../fixtures/apiSeed.js';

const LONG_NAME = 'Domaine-des-Chênes-Centenaires-et-de-la-Rivière-Sauvage-Lodge-Panoramique-Familial';

async function pageWidth(page) {
  return page.evaluate(() => document.documentElement.scrollWidth);
}

let reservationId;
let propertyId;

test.beforeAll(async () => {
  const property = await createProperty({ name: LONG_NAME });
  propertyId = property.id;
  const client = await createClient({ firstName: 'Camille', lastName: 'Largeur' });
  const reservation = await createReservation({
    propertyId, clientId: client.id, startDate: '2099-05-10', endDate: '2099-05-13',
  });
  reservationId = reservation.id;
});

for (const width of [390, 900]) {
  test(`rules 6-7 — the fiche of a long-named property fits ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`/reservations/${reservationId}`);
    await expect(page.getByText('Résumé tarifaire')).toBeVisible({ timeout: 15_000 });
    expect(await pageWidth(page)).toBeLessThanOrEqual(width);
  });

  test(`rule 7 — the calendar of a long-named property fits ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`/calendar?propertyId=${propertyId}`);
    await expect(page.getByLabel('Logement').first()).toBeVisible({ timeout: 15_000 });
    expect(await pageWidth(page)).toBeLessThanOrEqual(width);
  });
}

test('rule 6 — the centred client name shows from 1280 px, not at 900 px', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 1000 });
  await page.goto(`/reservations/${reservationId}`);
  await expect(page.getByText('Résumé tarifaire')).toBeVisible({ timeout: 15_000 });
  const centre = page.getByTestId('page-action-bar-center');
  await expect(centre).toBeHidden();
  await page.setViewportSize({ width: 1280, height: 1000 });
  await expect(centre).toBeVisible();
  await expect(centre).toContainText('Camille Largeur');
});
