// @ts-check
// specs/pricing-components.md §6 — « Ajouter un produit » on a saved stay: the sale panel, the quote, the sale, the moment menu,
// and the discount target selector, at 390 and 1280 px.
import { test, expect } from '@playwright/test';
import { createClient, createProperty, createReservation } from '../../fixtures/apiSeed.js';
import { seedCateringOptions } from '../../fixtures/dbSeed.js';
import { FAR_YEAR } from '../../fixtures/farYear.js';

for (const [name, size] of [['mobile', { width: 390, height: 844 }], ['desktop', { width: 1280, height: 900 }]]) {
  test(`extra sale on a saved stay (${name})`, async ({ page }) => {
    await page.setViewportSize(size);
    const property = await createProperty({ name: `Ventes ${name}` });
    seedCateringOptions(property.id);
    const client = await createClient({ firstName: 'Vente', lastName: name });
    const stay = await createReservation({ propertyId: property.id, clientId: client.id, startDate: `${FAR_YEAR}-09-${name === 'mobile' ? '08' : '15'}`, endDate: `${FAR_YEAR}-09-${name === 'mobile' ? '11' : '18'}` });
    await page.goto(`/reservations/${stay.id}`);
    await expect(page.getByText('Ventes du séjour')).toBeVisible();
    await expect(page.getByRole('list', { name: 'Détail des ventes' })).toContainText('Hébergement');
    await expect(page.getByLabel('Réduction sur')).toBeVisible();

    await page.getByRole('button', { name: 'Ajouter un produit' }).click();
    const dialog = page.getByRole('dialog', { name: 'Ajouter un produit' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Ajouter' })).toBeDisabled();
    await dialog.getByRole('combobox', { name: 'Produit' }).click();
    await page.getByRole('option').first().click();
    await expect(dialog.getByText('À payer à l’arrivée')).toBeVisible();
    await dialog.getByLabel('Quantité').fill('0');
    await expect(dialog.getByText('Une quantité supérieure à 0.')).toBeVisible();
    await dialog.getByLabel('Quantité').fill('1');
    await dialog.getByRole('button', { name: 'Ajouter' }).click();
    await expect(dialog).toBeHidden();
    const moment = page.getByRole('button', { name: /^Moment de / }).first();
    await expect(moment).toHaveText('À l’arrivée');
    await moment.click();
    await page.getByRole('menuitem', { name: 'À payer au départ' }).click();
    await expect(moment).toHaveText('Au départ');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `${process.env.E2E_SHOT_DIR || '/tmp'}/extra-sale-${name}.png` });
  });
}
