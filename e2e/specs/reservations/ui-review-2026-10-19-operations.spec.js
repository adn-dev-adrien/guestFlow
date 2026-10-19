// @ts-check
// specs/ui-review-2026-10-19-operations.md rules 11, 12 and 16 — against the real app: the fiche keeps
// its total on screen below 1200 px and opens the summary in a sheet; the calendar filter is usable on
// a phone.
import { test, expect } from '@playwright/test';
import { createClient, createProperty, createReservation } from '../../fixtures/apiSeed.js';

let reservationId;

test.beforeAll(async () => {
  const property = await createProperty({ name: 'E2E barre de total' });
  const client = await createClient({ firstName: 'Vittoria', lastName: 'Guernier' });
  const reservation = await createReservation({
    propertyId: property.id, clientId: client.id, startDate: '2099-08-07', endDate: '2099-08-13',
  });
  reservationId = reservation.id;
});

test('rules 11-12 — at 390 px the bar shows the total and opens the summary; the identity line names the guest', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 860 });
  await page.goto(`/reservations/${reservationId}`);
  const bar = page.getByTestId('sticky-total-bar');
  await expect(bar).toBeVisible({ timeout: 15_000 });
  await expect(bar).toContainText('Total du séjour');
  await expect(page.getByTestId('page-action-bar-identity')).toContainText('Vittoria Guernier');
  // Pinned to the bottom of the screen, not at the end of the 6 000 px fiche.
  const box = await bar.boundingBox();
  expect(box && box.y + box.height).toBeLessThanOrEqual(860);
  await bar.click();
  const sheet = page.getByRole('dialog', { name: 'Résumé tarifaire' });
  await expect(sheet).toBeVisible();
  await page.getByRole('button', { name: 'Fermer le résumé tarifaire' }).click();
  await expect(sheet).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('rule 11 — at 1280 px there is no bar: the summary column is sticky', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/reservations/${reservationId}`);
  await expect(page.getByText('Résumé tarifaire').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('sticky-total-bar')).toHaveCount(0);
});

test('rule 16 — at 390 px the calendar filter takes the full width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 860 });
  await page.goto('/calendar');
  const filter = page.getByLabel('Logement').filter({ visible: true }).first();
  await expect(filter).toBeVisible({ timeout: 15_000 });
  // The control is replaced once the logements arrive (segments ↔ select): measure until it settles.
  await expect.poll(async () => ((await filter.boundingBox()) || { width: 0 }).width, { timeout: 10_000 }).toBeGreaterThan(300);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
