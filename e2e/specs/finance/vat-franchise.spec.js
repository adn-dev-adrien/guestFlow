// @ts-check
// specs/vat-optional-mode.md rules 35-41, §6.6-6.8 — the franchise threshold, against the real app:
// under VAT there is no field and no card; under « Sans TVA · art. 293 B » the operator types the
// threshold (refusals shown under the field), the Suivi financier draws the card with its level, and
// emptying the field turns the card into an invitation. The card on a phone.
import { test, expect } from '@playwright/test';
import { createClient, createProperty, createReservation } from '../../fixtures/apiSeed.js';
import { resetVatRegime, setFranchiseRegime } from '../../fixtures/dbSeed.js';

test.describe.configure({ mode: 'serial' });
test.beforeAll(() => { resetVatRegime(); });
test.afterAll(() => { resetVatRegime(); });

const card = (page) => page.getByRole('region', { name: 'Seuil de franchise' });

async function saveSettings(page) {
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByText('Paramètres enregistrés.')).toBeVisible();
}

test('under VAT: no field on the settings page, no card in the Suivi financier', async ({ page }) => {
  await page.goto('/settings/tva-exercice');
  await expect(page.getByLabel('Taux de TVA (%)')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByLabel('Seuil de franchise')).toHaveCount(0);
  await page.goto('/finance');
  await expect(page.getByRole('region', { name: "Chiffre d'affaires" })).toBeVisible({ timeout: 15_000 });
  await expect(card(page)).toHaveCount(0);
});

test('under the franchise: refusals under the field, then the typed threshold gives the card its level', async ({ page }) => {
  const property = await createProperty({ name: 'E2E franchise villa', basePrice: 120 });
  const client = await createClient({ firstName: 'Franchise', lastName: 'Seuil' });
  await createReservation({ propertyId: property.id, clientId: client.id, startDate: '2099-06-10', endDate: '2099-06-13', adults: 2 });
  setFranchiseRegime();

  await page.goto('/settings/tva-exercice');
  const field = page.getByLabel('Seuil de franchise');
  await expect(field).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Montant fixé par la loi pour l’activité. À vérifier avant saisie.')).toBeVisible();

  for (const [typed, message] of [['0', 'Montant supérieur à 0 €. Vide pour ne pas en fixer.'], ['-5', 'Montant supérieur à 0 €. Vide pour ne pas en fixer.'], ['12,345', 'Deux décimales au plus.']]) {
    await field.fill(typed);
    await expect(page.getByText(message)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Enregistrer' })).toBeDisabled();
  }

  await field.fill('12 345,60');
  await field.blur();
  await expect(field).toHaveValue(/12\s345,6/);
  await saveSettings(page);
  await expect(page.getByText(/^Saisi le \d{2}\/\d{2}\/\d{4}$/)).toBeVisible();

  await page.goto('/finance');
  await expect(card(page)).toBeVisible({ timeout: 15_000 });
  await expect(card(page).getByText(/du seuil de 12\s346\s€/)).toBeVisible();
  await expect(card(page).getByRole('meter')).toBeVisible();
  await expect(card(page).locator('.MuiChip-label')).toHaveCount(1);
});

test('emptying the field turns the card into an invitation, and the card fits a phone', async ({ page }) => {
  await page.goto('/settings/tva-exercice');
  await page.getByLabel('Seuil de franchise').fill('');
  await saveSettings(page);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/finance');
  await expect(card(page)).toBeVisible({ timeout: 15_000 });
  await expect(card(page).getByRole('button', { name: 'Saisir le seuil' })).toBeVisible();
  await expect(card(page).getByRole('meter')).toHaveCount(0);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  await card(page).getByRole('button', { name: 'Saisir le seuil' }).click();
  await expect(page).toHaveURL(/\/settings\/tva-exercice#seuil-franchise$/);
  await expect(page.getByLabel('Seuil de franchise (€)')).toBeFocused();
});
