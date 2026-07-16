// @ts-check
// DS phase-6 smoke (specs/ds-sweep-reservations.md §7). PropertyDetail's hand-rolled header migrated
// to the shared PageActionBar: on /properties/new the create CTA is the bar's Save action (icon
// button, aria-label « Créer le logement »), disabled until a name is typed into the first form field.
import { test, expect } from '@playwright/test';

test('PropertyDetail /properties/new: create CTA lives in the bar and enables once a name is set', async ({ page }) => {
  await page.goto('/properties/new');

  const createBtn = page.getByRole('button', { name: 'Créer le logement' });
  await expect(createBtn).toBeVisible({ timeout: 10_000 });
  await expect(createBtn).toBeDisabled();

  await page.getByLabel('Nom du logement').fill('Cabane E2E');
  await expect(createBtn).toBeEnabled();
});
