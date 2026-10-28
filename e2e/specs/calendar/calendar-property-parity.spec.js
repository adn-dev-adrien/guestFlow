// @ts-check
// specs/calendar-property-parity.md rules 1-2, 13, 17 — against the real app: a stay on a platform « Désactivé »
// for its logement is in « Tous » and in the logement; scrolling up in the logement calendar shows the previous
// month's title and its stay; at 390 px the logement calendar is a day agenda that scrolls into the next month.
import { test, expect } from '@playwright/test';
import { createClient, createProperty, createReservation, createIcalSource } from '../../fixtures/apiSeed.js';

let propertyId;

test.beforeAll(async () => {
  const property = await createProperty({ name: 'E2E parité calendriers' });
  propertyId = property.id;
  const client = await createClient({ firstName: 'Odilon', lastName: 'Marchetti' });
  await createIcalSource({ propertyId, name: 'Airbnb désactivé', url: '', platformKey: 'airbnb', platformLabel: 'Airbnb', disabled: true });
  await createReservation({ propertyId, clientId: client.id, startDate: '2099-08-10', endDate: '2099-08-13', platform: 'Airbnb' });
  const juillet = await createClient({ firstName: 'Perrine', lastName: 'Valdoie' });
  await createReservation({ propertyId, clientId: juillet.id, startDate: '2099-07-20', endDate: '2099-07-23', platform: 'direct' });
});

test('rules 1-2 — a stay on a disabled platform is in « Tous » and in the logement calendar', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/calendar?year=2099&month=7');
  await expect(page.locator('[data-bar]').filter({ hasText: 'Odilon Marchetti' }).first()).toBeVisible({ timeout: 20_000 });
  await page.goto(`/calendar?propertyId=${propertyId}&year=2099&month=7`);
  await expect(page.getByRole('button', { name: /Odilon Marchetti — Airbnb/ }).first()).toBeVisible({ timeout: 20_000 });
});

test('rule 13 — scrolling up in the logement calendar shows the previous month and its stay', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/calendar?propertyId=${propertyId}&year=2099&month=7`);
  await expect(page.locator('[data-month-anchor="2099-7"]')).toBeVisible({ timeout: 20_000 });
  await page.evaluate(() => {
    const block = document.querySelector('[data-month-anchor="2099-7"]');
    const container = block.parentElement.parentElement;
    container.scrollTop = 0;
  });
  await expect(page.locator('[data-month-anchor="2099-6"]')).toBeAttached({ timeout: 10_000 });
  await expect(page.getByRole('button', { name: /Perrine Valdoie — Direct/ }).first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('button', { name: /Mois précédent/ })).toHaveCount(0);
});

test('rule 17 — at 390 px the logement calendar is a day agenda that scrolls into the next month', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/calendar?propertyId=${propertyId}&year=2099&month=7`);
  await expect(page.locator('[data-day="2099-08-10"]')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[data-day="2099-08-10"] [data-ribbon]')).toHaveAttribute('data-side', 'right');
  await page.evaluate(() => {
    const block = document.querySelector('[data-month-anchor="2099-7"]');
    const container = block.parentElement.parentElement;
    container.scrollTop = container.scrollHeight;
  });
  await expect(page.locator('[data-month-anchor="2099-8"]')).toBeAttached({ timeout: 10_000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
