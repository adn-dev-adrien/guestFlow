// @ts-check
// specs/options-resources-ux.md rule 12 + §6 (mobile check) — at 390 px the options are a list of
// sections (no table), a row opens a full-height sheet, nothing scrolls sideways.
import { test, expect } from '@playwright/test';
import { createProperty } from '../../fixtures/apiSeed.js';
import { seedCateringOptions } from '../../fixtures/dbSeed.js';

test.use({ viewport: { width: 390, height: 844 } });

test('/options at 390px: sections and rows, a row opens a full-width sheet, no horizontal page scroll', async ({ page }) => {
  const property = await createProperty({ name: 'E2E mobile catalogue' });
  seedCateringOptions(property.id);
  await page.goto('/options');
  await expect(page.getByRole('button', { name: 'Nouvelle option' })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('heading', { name: /^Boissons/, level: 2 })).toBeVisible();
  await expect(page.locator('table')).toHaveCount(0);

  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(await overflow()).toBeLessThanOrEqual(0);

  await page.getByRole('button', { name: 'Modifier Jus de pomme 1L' }).click();
  const sheet = page.getByRole('dialog', { name: 'Jus de pomme 1L' });
  await expect(sheet).toBeVisible();
  const box = await sheet.boundingBox();
  expect(box.width).toBeGreaterThanOrEqual(388);
  expect(box.height).toBeGreaterThan(700);
  await expect(sheet.getByRole('button', { name: 'Fermer' })).toBeVisible();
  expect((await sheet.getByRole('button', { name: 'Fermer' }).boundingBox()).height).toBeGreaterThanOrEqual(44);
  expect(await overflow()).toBeLessThanOrEqual(0);

  await sheet.getByRole('button', { name: 'Fermer' }).click();
  await expect(sheet).toHaveCount(0);
});
