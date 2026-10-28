// @ts-check
// specs/clients-upcoming-past-directory.md rules 11-20 (amendment of 2026-10-28) — the Clients page opens
// on the people who are coming, keeps the view in the URL, and stays usable on a phone.
import { test, expect } from '@playwright/test';
import { createClient, createProperty, createReservation } from '../../fixtures/apiSeed.js';
import { setReservationDates } from '../../fixtures/dbSeed.js';

async function seed(tag) {
  const property = await createProperty({ name: `E2E annuaire ${tag}` });
  const upcoming = await createClient({ firstName: 'Venant', lastName: `Avenir${tag}`, phone: '0612345678', email: `venant-${tag}@example.fr` });
  const past = await createClient({ firstName: 'Parti', lastName: `Passe${tag}` });
  const nobody = await createClient({ firstName: 'Sans', lastName: `Rien${tag}` });
  await createReservation({ propertyId: property.id, clientId: upcoming.id, startDate: '2099-06-10', endDate: '2099-06-13' });
  const pastReservation = await createReservation({ propertyId: property.id, clientId: past.id, startDate: '2099-07-10', endDate: '2099-07-13' });
  setReservationDates(pastReservation.id, '2020-06-10', '2020-06-13');
  return { property, upcoming, past, nobody, pastReservation };
}

test('opens on « À venir » without the past clients; a search finds them in « Passés »', async ({ page }) => {
  const tag = `A${Date.now()}`;
  const { upcoming, past } = await seed(tag);
  await page.goto('/clients');
  await expect(page.getByRole('tab', { name: /^À venir/ })).toHaveAttribute('aria-selected', 'true');

  const box = page.getByRole('searchbox', { name: /Rechercher un client/ });
  await box.fill(`Avenir${tag}`);
  await expect(page.getByRole('button', { name: new RegExp(upcoming.lastName) })).toBeVisible();
  await expect(page.getByText('Arrive le 10/06/2099')).toBeVisible();

  await box.fill(`Passe${tag}`);
  await expect(page.getByText('Aucun résultat dans À venir')).toBeVisible();
  await page.getByRole('button', { name: '1 dans Passés' }).click();
  await expect(page).toHaveURL(/vue=passes/);
  await expect(page.getByRole('button', { name: new RegExp(past.lastName) })).toBeVisible();
});

test('the view survives a trip to a fiche and « Retour »; « Sans séjour » offers the cleanup', async ({ page }) => {
  const tag = `B${Date.now()}`;
  const { past, nobody } = await seed(tag);
  await page.goto('/clients?vue=passes');
  await page.getByRole('searchbox', { name: /Rechercher un client/ }).fill(`Passe${tag}`);
  await page.getByRole('button', { name: new RegExp(past.lastName) }).click();
  await expect(page.getByText('Modifier le client')).toBeVisible();
  await page.getByRole('dialog').getByText(/E2E annuaire/).first().click();
  await expect(page).toHaveURL(/\/reservations\/\d+/);

  await page.goBack();
  await expect(page).toHaveURL(/vue=passes/);
  await expect(page.getByText('Modifier le client')).toBeVisible();
  await page.getByRole('button', { name: 'Annuler' }).click();
  await expect(page.getByRole('tab', { name: /^Passés/ })).toHaveAttribute('aria-selected', 'true');

  await page.goto('/clients?vue=sans-sejour');
  await page.getByRole('searchbox', { name: /Rechercher un client/ }).fill(`Rien${tag}`);
  await expect(page.getByRole('button', { name: new RegExp(nobody.lastName) })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Nettoyer les clients' })).toBeVisible();
});

test.describe('phone (390 px)', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('no horizontal scroll, a tel: link at 44 px, the whole row is a 44 px target', async ({ page }) => {
    const tag = `C${Date.now()}`;
    await seed(tag);
    await page.goto('/clients');
    await page.getByRole('searchbox', { name: /Rechercher un client/ }).fill(`Avenir${tag}`);
    const row = page.getByTestId('client-row').first();
    await expect(row).toBeVisible();
    const call = row.getByRole('link', { name: /Appeler/ });
    const box = await call.boundingBox();
    expect(box && Math.round(box.width)).toBe(44);
    expect(box && Math.round(box.height)).toBe(44);
    expect((await row.boundingBox()).height).toBeGreaterThanOrEqual(44);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
