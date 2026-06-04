// @ts-check
// Test 2/24 — auth/force-password-change (spec §3.4 row 2).
// Run `reset-admin.js` to restore the DEFAULT admin (mustChangePassword=1). Log in via the
// UI with the default credentials. The form must redirect to a change-password screen.
// Submit a new password. End on the Dashboard. Pins `admin-account-management` +
// `security-auth-encryption`.
import { test, expect } from '@playwright/test';
import { spawnSync } from 'child_process';
import path from 'path';

const DEFAULT_EMAIL = 'admin@guestflow.local';
const DEFAULT_PASSWORD = 'ChangeMe!2026';
const NEW_PASSWORD = 'NewPass!2026';

// SKIP until we have a per-spec auth-isolation pattern. The naive impl below calls
// `reset-admin.js` which executes `DELETE FROM sessions`, nuking the cached e2e admin
// cookie used by every other spec. Bringing this back requires either (a) running this
// spec in a dedicated worker with `test.use({ storageState: undefined })` + a per-spec
// admin user seeded via the API instead of reset-admin, or (b) running it last and
// re-running globalSetup at the end. Tracked as a follow-up.
test.skip('Default admin first-login flow: login redirects to change-password, succeeds, lands on dashboard', async ({ page, context }) => {
  // Reset the DEFAULT admin (mustChangePassword=1) — leaves the e2e seeded admin untouched.
  const reset = spawnSync('node', ['server/scripts/reset-admin.js'], {
    cwd: path.join(__dirname, '..', '..', '..'),
    env: { ...process.env, DB_PATH: process.env.GUESTFLOW_E2E_DB_PATH || '/tmp/guestflow-e2e.db' },
    encoding: 'utf8',
  });
  expect(reset.status, reset.stderr || reset.stdout).toBe(0);

  // Drop the cached e2e admin storageState so we start from a logged-out browser.
  await context.clearCookies();

  await page.goto('/');
  await expect(page.getByText('Connectez-vous pour continuer.')).toBeVisible();

  await page.getByRole('textbox', { name: 'Email' }).fill(DEFAULT_EMAIL);
  await page.getByRole('textbox', { name: 'Mot de passe' }).fill(DEFAULT_PASSWORD);
  await page.getByRole('button', { name: 'Se connecter' }).click();

  // The server returns the must-change flag and the client renders the change-password screen.
  await expect(page.getByRole('heading', { name: /changez? votre mot de passe/i })).toBeVisible({ timeout: 10_000 });

  // Both "new" and "confirm" fields take the same value.
  const newPasswordField = page.getByLabel(/nouveau mot de passe/i).first();
  const confirmField = page.getByLabel(/confirmer/i).first();
  await newPasswordField.fill(NEW_PASSWORD);
  await confirmField.fill(NEW_PASSWORD);
  await page.getByRole('button', { name: /valider|enregistrer|changer/i }).first().click();

  await expect(page.getByRole('heading', { name: 'Tableau de bord' })).toBeVisible({ timeout: 10_000 });
});
