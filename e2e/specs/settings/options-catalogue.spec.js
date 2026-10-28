// @ts-check
// specs/options-resources-ux.md rules 1, 8-17 — the options catalogue in the real app: fold a category,
// search, open an option in the side panel, a refused per-property price, a fixed one that is saved, and
// the list that shows the effective price range.
import { test, expect, request as pwRequest } from '@playwright/test';
import path from 'path';
import { createProperty } from '../../fixtures/apiSeed.js';
import { seedCateringOptions } from '../../fixtures/dbSeed.js';
import { CLIENT_URL } from '../../clientUrl.js';

const STORAGE_STATE = path.join(process.cwd(), 'e2e', '.auth', 'admin.json');

async function createOption(data) {
  const ctx = await pwRequest.newContext({ baseURL: CLIENT_URL, storageState: STORAGE_STATE });
  try {
    const res = await ctx.post('/api/options', { data });
    if (!res.ok()) throw new Error(`createOption failed: ${res.status()} ${await res.text()}`);
    return res.json();
  } finally {
    await ctx.dispose();
  }
}

test('fold a category, search, refuse a negative per-property price, save a fixed one', async ({ page }) => {
  const granja = await createProperty({ name: 'Granja E2E catalogue' });
  const estiva = await createProperty({ name: 'Estiva E2E catalogue' });
  seedCateringOptions(granja.id);
  await createOption({
    title: 'Ménage catalogue', priceType: 'per_stay', price: 30, propertyIds: [granja.id, estiva.id],
  });

  await page.goto('/parametres/options-ressources');
  await expect(page.getByRole('heading', { name: 'Options & ressources', level: 1 }).first()).toBeVisible({ timeout: 10_000 });

  // Rule 8 — a category folds, and its rows leave the page.
  const boissons = page.getByRole('heading', { name: /^Boissons/, level: 2 }).getByRole('button');
  await expect(page.getByRole('button', { name: 'Jus de pomme 1L', exact: true })).toBeVisible();
  await boissons.click();
  await expect(page.getByRole('button', { name: 'Jus de pomme 1L', exact: true })).toHaveCount(0);

  // Rule 11 — searching unfolds every section and keeps the matches.
  await page.getByRole('searchbox', { name: 'Rechercher une option' }).fill('jus');
  await expect(page.getByRole('button', { name: 'Jus de pomme 1L', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ménage catalogue', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Effacer' }).click();

  // Rules 12-14 — the option opens in a side panel; a negative price on Granja is refused inline.
  await page.getByRole('button', { name: 'Ménage catalogue', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Ménage catalogue' });
  await expect(panel).toBeVisible();
  const granjaPrice = panel.getByLabel('Prix · Granja E2E catalogue');
  await granjaPrice.fill('-5');
  await expect(panel.getByText('Positif ou nul')).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Enregistrer' })).toBeDisabled();

  // Rule 17 — fixed, saved, the panel closes and the row shows the price range.
  await granjaPrice.fill('85');
  await panel.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByText('Option enregistrée')).toBeVisible();
  await expect(panel).toHaveCount(0);
  const row = page.getByRole('button', { name: 'Ménage catalogue', exact: true }).locator('xpath=../..');
  await expect(row).toContainText(/30\s€\s–\s85\s€/);
  await expect(row).toContainText('selon logement');
});

test('the old standalone addresses land on their tab (rule 1)', async ({ page }) => {
  await page.goto('/options');
  await expect(page).toHaveURL(/\/parametres\/options-ressources$/);
  await page.goto('/resources');
  await expect(page).toHaveURL(/\/parametres\/options-ressources\?tab=resources$/);
  await expect(page.getByRole('tab', { name: 'Ressources' })).toHaveAttribute('aria-selected', 'true');
});
