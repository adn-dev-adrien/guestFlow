// @ts-check
// specs/non-card-option-served-persons.md rule 25 — the whole path against the real app: a number typed
// on a non-card option stays that number when the party changes, the field turns red, retyping another
// wrong number leaves it red, the save asks, and the circular arrows apply the new value.
import { test, expect } from '@playwright/test';
import { createClient, createProperty, createReservation } from '../../fixtures/apiSeed.js';
import { seedPerPersonOption } from '../../fixtures/dbSeed.js';

const OPTION_TITLE = 'E2E Serviettes';
const STAY_YEAR = new Date().getFullYear() + 1;

// Scoped to the extras card: an enabled option's title also shows in the pricing panel.
const optionCard = (page) => page.locator('.MuiCard-root').filter({ hasText: 'Options et ressources' }).first()
  .locator('.MuiCard-root').filter({ hasText: OPTION_TITLE }).last();
const qty = (page) => optionCard(page).getByLabel('Qté');
const adults = (page) => page.getByLabel('Adultes');

async function type(locator, value) {
  await locator.fill(value);
  await locator.press('Tab');
}

test('a typed number survives a party change, turns red, and the save asks', async ({ page }) => {
  const property = await createProperty({ name: 'E2E typed count villa', maxGuests: 12, singleBeds: 4, doubleBeds: 4 });
  const client = await createClient({ firstName: 'Typed', lastName: 'Count' });
  seedPerPersonOption({ propertyId: property.id, title: OPTION_TITLE, price: 8 });
  const reservation = await createReservation({
    propertyId: property.id, clientId: client.id, startDate: `${STAY_YEAR}-11-04`, endDate: `${STAY_YEAR}-11-06`, adults: 4,
  });

  await page.goto(`/reservations/${reservation.id}`);
  await expect(adults(page)).toHaveValue('4', { timeout: 15_000 });

  const toggle = optionCard(page).locator('input[role="switch"]:not([aria-label="Forcer en complément"])');
  await toggle.check();
  await expect(qty(page)).toHaveValue('4');

  await type(qty(page), '3');
  await expect(optionCard(page).getByText(/Total: 24,00/)).toBeVisible();

  // A save leaves the fiche: come back to it.
  await page.getByRole('button', { name: 'Enregistrer' }).first().click();
  await expect(page).not.toHaveURL(new RegExp(`/reservations/${reservation.id}`), { timeout: 15_000 });
  await page.goto(`/reservations/${reservation.id}`);
  await expect(qty(page)).toHaveValue('3', { timeout: 15_000 });
  await expect(qty(page)).toHaveAttribute('aria-invalid', 'false');

  // The party moves: the number stays, the total stays, the field says so.
  await type(adults(page), '5');
  await expect(qty(page)).toHaveValue('3');
  await expect(qty(page)).toHaveAttribute('aria-invalid', 'true');
  await expect(optionCard(page).getByText('Saisi pour 4 personnes, groupe : 5')).toBeVisible();
  await expect(page.getByText(`Valeur saisie à vérifier : ${OPTION_TITLE}`)).toBeVisible();
  await expect(optionCard(page).getByText(/Total: 24,00/)).toBeVisible();

  // Another wrong number is still wrong.
  await type(qty(page), '2');
  await expect(qty(page)).toHaveAttribute('aria-invalid', 'true');

  // The save asks: « Annuler » keeps the fiche.
  await page.getByRole('button', { name: 'Enregistrer' }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Quantités saisies à vérifier')).toBeVisible();
  await dialog.getByRole('button', { name: 'Annuler' }).click();
  await expect(qty(page)).toHaveAttribute('aria-invalid', 'true');

  // The arrows apply the new value: back to the party, nothing flagged.
  await optionCard(page).getByRole('button', { name: 'Appliquer 5 personnes' }).click();
  await expect(qty(page)).toHaveValue('5');
  await expect(qty(page)).toHaveAttribute('aria-invalid', 'false');
  await expect(optionCard(page).getByText(/Total: 40,00/)).toBeVisible();

  // Typed again, then forced: the number is stored as typed and the reload shows no red.
  await type(qty(page), '2');
  await type(adults(page), '6');
  await expect(qty(page)).toHaveAttribute('aria-invalid', 'true');
  await page.getByRole('button', { name: 'Enregistrer' }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Forcer l\'enregistrement' }).click();
  await expect(page).not.toHaveURL(new RegExp(`/reservations/${reservation.id}`), { timeout: 15_000 });

  await page.goto(`/reservations/${reservation.id}`);
  await expect(qty(page)).toHaveValue('2', { timeout: 15_000 });
  await expect(qty(page)).toHaveAttribute('aria-invalid', 'false');
  await expect(optionCard(page).getByText(/Total: 16,00/)).toBeVisible();
});
