// @ts-check
// specs/pricing/pricing-components.md §6 — « Ajouter un produit » on a saved stay: the sale panel, the quote, the sale, no moment menu before the arrival,
// and the discount target selector, at 390 and 1280 px; rule 101 (loop t2 UI2-3): a typed note holds the panel, and the save keeps the sold line.
import { test, expect } from '@playwright/test';
import { createClient, createProperty, createReservation } from '../../fixtures/apiSeed.js';
import { seedCateringOptions } from '../../fixtures/dbSeed.js';
import { FAR_YEAR } from '../../fixtures/farYear.js';

for (const [name, size] of [['mobile', { width: 390, height: 844 }], ['desktop', { width: 1280, height: 900 }]]) {
  test(`extra sale on a saved stay (${name})`, async ({ page }, testInfo) => {
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
    const product = (await page.getByRole('option').first().innerText()).trim();
    await page.getByRole('option').first().click();
    await expect(dialog.getByText('À payer à l’arrivée')).toBeVisible();
    await dialog.getByLabel('Quantité').fill('0');
    await expect(dialog.getByText('Une quantité supérieure à 0.')).toBeVisible();
    await dialog.getByLabel('Quantité').fill('1');
    await dialog.getByRole('button', { name: 'Ajouter' }).click();
    await expect(dialog).toBeHidden();
    // Rules 37, 95 (loop t1 UI-11) — before the arrival the server offers no other moment (`moments: ['arrival']`, `movable: false`): no « Moment » button.
    await expect(page.getByRole('list', { name: 'Détail des ventes' })).toContainText('À payer à l’arrivée');
    await expect(page.getByRole('button', { name: /^Moment de / })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`extra-sale-${name}.png`) });

    // Rule 101 — a typed note holds the panel's writes; the save keeps the line the sale wrote. « Enregistrer » leaves the fiche for its
    // origin, as every fiche save does: the fiche is opened again to read what was stored. The sale's re-read keeps the fiche busy (fields
    // read-only, reading 2026-11-16) from the dialog's close until the server's form is applied: the note is typed once it is editable again.
    await expect(page.getByLabel('Notes')).toBeEditable({ timeout: 15_000 });
    await page.getByLabel('Notes').fill(`Note ${name}`);
    await expect(page.getByRole('button', { name: 'Ajouter un produit' })).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByText('Enregistrer d\'abord les modifications.').first()).toBeVisible();
    await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await page.waitForURL((url) => url.pathname !== `/reservations/${stay.id}`, { timeout: 15_000 });
    await page.goto(`/reservations/${stay.id}`);
    await expect(page.getByRole('list', { name: 'Détail des ventes' })).toContainText(product, { timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Ajouter un produit' })).not.toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByLabel('Notes')).toHaveValue(`Note ${name}`);
  });
}
