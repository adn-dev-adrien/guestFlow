// @ts-check
// settings/settings-input-guards — specs/settings-input-guards.md rules 2, 4, 5, 9, 28: a bounded number
// strips a typed minus, refuses an out-of-range value (the server answers the same), and a commission
// that is not a number brings the previous rate back.
import { test, expect } from '@playwright/test';

test('property delays: -5 becomes 5, 45 is refused in red and the server refuses the save too', async ({ page }) => {
  await page.goto('/properties/new?tab=paiement');
  await page.getByRole('tab', { name: 'Paiement & caution' }).click();
  await page.getByRole('switch', { name: 'Demander un acompte' }).check();

  const days = page.getByRole('textbox', { name: /Acompte \(jours après réservation\)/ });
  await days.fill('-5');
  await expect(days).toHaveValue('5');
  await expect(page.getByText('Positif uniquement.').first()).toBeVisible();

  await days.fill('45');
  await days.blur();
  await expect(days).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText('Entre 0 et 30 jours.')).toBeVisible();

  await page.getByRole('tab', { name: 'Général' }).click();
  await page.getByLabel('Nom du logement').fill('Cabane gardes-fous');
  await page.getByRole('button', { name: 'Créer le logement' }).click();
  await expect(page.getByText('Enregistrement refusé : corrigez les champs en rouge.')).toBeVisible({ timeout: 10_000 });
  await expect(page).toHaveURL(/\/properties\/new/);
});

test('Plateformes: a commission that is not a number brings the previous rate back', async ({ page }) => {
  await page.goto('/settings/plateformes');
  const commission = page.getByRole('textbox', { name: /^Commission / }).first();
  await expect(commission).toBeVisible({ timeout: 10_000 });
  const before = await commission.inputValue();
  await commission.fill('abc');
  await commission.blur();
  await expect(commission).toHaveValue(before);
  await expect(page.getByText('Nombre attendu.').first()).toBeVisible();
});
