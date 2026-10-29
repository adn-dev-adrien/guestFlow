// @ts-check
// Test 2/24 — auth/force-password-change (spec §3.4 row 2).
// A freshly seeded admin with mustChangePassword=1 (its own account, so the suite's cached admin session
// is untouched) logs in through the UI, lands on the forced change screen, sets a new password and
// is sent back to the login with the success notice. Pins `admin-account-management` +
// `security-auth-encryption`.
import { test, expect } from '@playwright/test';
import fixtures from '../../fixtures/accountSecurity.js';

const { seedAccount } = fixtures;
const NEW_PASSWORD = 'NewPass!2026-e2e';

test.use({ storageState: { cookies: [], origins: [] } });

test('Default admin first-login flow: login shows the forced change screen, then back to the login', async ({ page }) => {
  const account = seedAccount('forced', { mustChangePassword: true });

  await page.goto('/login');
  await page.getByLabel(/^Email/).fill(account.email);
  await page.getByLabel(/^Mot de passe/).fill(account.password);
  await page.getByRole('button', { name: 'Se connecter' }).click();

  await expect(page.getByRole('heading', { name: 'Définir le mot de passe' })).toBeVisible({ timeout: 15_000 });

  await page.getByLabel(/^Mot de passe actuel/).fill(account.password);
  await page.getByLabel(/^Nouveau mot de passe/).fill(NEW_PASSWORD);
  await page.getByLabel(/^Confirmer le nouveau mot de passe/).fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Définir le mot de passe' }).click();

  await expect(page.getByText('Mot de passe modifié. Connexion avec le nouveau mot de passe.')).toBeVisible({ timeout: 15_000 });

  await page.getByLabel(/^Mot de passe/).fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.getByRole('heading', { name: 'Tableau de bord' })).toBeVisible({ timeout: 15_000 });
});
