// @ts-check
// specs/shell-and-home-day-first.md rule 23 (review of PR #728, B1, M1, M2) — on a phone a page bar
// left with one ICON action gives it to the top bar, and only while the title stays whole; text
// buttons, selects and the folded « ⋯ » stay in the page; opening the search does not move the page;
// a calendar on one logement shows « Aujourd'hui » once.
import { test, expect } from '@playwright/test';
import { createProperty } from '../../fixtures/apiSeed.js';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

const header = (page) => page.locator('header');
const titleIsWhole = (page) => page.getByTestId('appbar-page-title')
  .evaluate((el) => el.scrollWidth <= el.clientWidth + 1);

for (const path of ['/finance', '/properties', '/planning', '/devis', '/finance/indemnites', '/calendar', '/settings/integrations']) {
  test(`rule 23: at 390 px the title of ${path} stays whole`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByTestId('appbar-page-title')).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(300);
    expect(await titleIsWhole(page)).toBe(true);
  });
}

test('rule 23: « Actualiser » moves to the top bar; « Nouveau logement » stays in the page', async ({ page }) => {
  await page.goto('/finance');
  await expect(header(page).getByRole('button', { name: 'Actualiser' })).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('main').getByTestId('page-action-bar-row')).toHaveCount(0);

  await page.goto('/properties');
  // With no logement yet the empty state offers the same button under the bar's: either one proves it stays in the page.
  await expect(page.locator('main').getByRole('button', { name: /Nouveau logement/ }).first()).toBeVisible({ timeout: 10_000 });
  await expect(header(page).getByRole('button', { name: /Nouveau logement/ })).toHaveCount(0);
});

test('rule 23: the planning keeps its own action in the page', async ({ page }) => {
  await page.goto('/planning');
  await expect(page.getByTestId('appbar-page-title')).toBeVisible({ timeout: 10_000 });
  const inHeader = await header(page).locator('[data-testid="appbar-page-action"] button').count();
  expect(inHeader).toBe(0);
});

test('rule 23: opening the phone search does not move the page', async ({ page }) => {
  await page.goto('/finance');
  const first = page.locator('main > *').first();
  await expect(header(page).getByRole('button', { name: 'Actualiser' })).toBeVisible({ timeout: 10_000 });
  const before = (await first.boundingBox()).y;
  await page.getByRole('button', { name: 'Rechercher une réservation' }).click();
  await expect(page.getByRole('button', { name: 'Fermer la recherche' })).toBeVisible();
  expect((await first.boundingBox()).y).toBe(before);
  await page.getByRole('button', { name: 'Fermer la recherche' }).click();
  await expect(header(page).getByRole('button', { name: 'Actualiser' })).toBeVisible();
});

test('rule 23: a calendar on one logement shows « Aujourd’hui » once, no « ⋯ » in the top bar', async ({ page }) => {
  const property = await createProperty({ name: 'Barre du haut' });
  await page.goto(`/calendar?propertyId=${property.id}`);
  await expect(page.getByRole('button', { name: /Aujourd['’]hui/ })).toHaveCount(1, { timeout: 10_000 });
  await expect(header(page).getByRole('button', { name: 'Plus d\'actions' })).toHaveCount(0);
});
