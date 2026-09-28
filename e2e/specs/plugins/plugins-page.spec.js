// @ts-check
// plugins/plugins-page — specs/plugins-phase-0-foundation.md §3.B, §3.D, §3.E.
// Drives the Plugins page against the real server and checks that an inactive plugin leaves no
// trace. Only Google Agenda is switched off: no other spec depends on it, so the suite can keep
// running in parallel locally. The seed installs the twelve plugins active (seed-e2e.js); the
// last step puts Google Agenda back in that state.
import { test, expect } from '@playwright/test';

const GOOGLE = 'Google Agenda';
const googleCard = (page) => page.locator('.MuiCard-root').filter({ hasText: GOOGLE });

test.describe.configure({ mode: 'serial' });

test('the seeded database has the twelve plugins installed and active', async ({ page }) => {
  await page.goto('/parametres/plugins');
  await expect(page.getByRole('tab', { name: 'Installés (12)' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tab', { name: 'Disponibles (0)' })).toBeVisible();
  await expect(googleCard(page).getByText('Actif', { exact: true })).toBeVisible();
});

test('deactivating Google Agenda removes its section and its API, activating brings them back', async ({ page, request }) => {
  await page.goto('/settings/integrations');
  await expect(page.getByText('Synchronisation Google Agenda')).toBeVisible({ timeout: 10_000 });

  await page.goto('/parametres/plugins');
  await googleCard(page).getByRole('button', { name: 'Désactiver' }).click();
  await expect(googleCard(page).getByText('Inactif', { exact: true })).toBeVisible();

  const off = await request.get('/api/google-calendar/status');
  expect(off.status()).toBe(404);
  expect(await off.json()).toEqual({ error: 'PLUGIN_INACTIVE', plugin: 'google-calendar' });

  await page.goto('/settings/integrations');
  await expect(page.getByRole('heading', { name: 'Intégrations' }).first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Synchronisation Google Agenda')).toHaveCount(0);

  await page.goto('/parametres/plugins');
  await googleCard(page).getByRole('button', { name: 'Activer' }).click();
  await expect(googleCard(page).getByText('Actif', { exact: true })).toBeVisible();
  expect((await request.get('/api/google-calendar/status')).status()).toBe(200);
});

test('uninstall takes two clicks, moves the plugin to « Disponibles », and it installs back active', async ({ page }) => {
  await page.goto('/parametres/plugins');
  await googleCard(page).getByText(GOOGLE).click();
  await googleCard(page).getByRole('button', { name: 'Désinstaller' }).click();
  await expect(googleCard(page).getByText(/Tes données sont conservées/)).toBeVisible();
  await googleCard(page).getByRole('button', { name: 'Confirmer la désinstallation' }).click();

  await expect(page.getByRole('tab', { name: 'Installés (11)' })).toBeVisible();
  await page.getByRole('tab', { name: 'Disponibles (1)' }).click();
  await googleCard(page).getByRole('button', { name: 'Installer' }).click();

  await expect(page.getByRole('tab', { name: 'Installés (12)' })).toHaveAttribute('aria-selected', 'true');
  await expect(googleCard(page).getByText('Actif', { exact: true })).toBeVisible();
});

test('the SAS cannot be deactivated while a reception account is active', async ({ page }) => {
  await page.goto('/parametres/plugins');
  const sas = page.locator('.MuiCard-root').filter({ hasText: 'Arrivée et départ guidés' });
  await sas.getByRole('button', { name: 'Désactiver' }).click();
  await expect(sas.getByRole('alert')).toContainText('1 compte Accueil est actif');
  await expect(sas.getByText('Actif', { exact: true })).toBeVisible();
});

test('the Plugins entry sits in the Paramètres submenu', async ({ page }) => {
  await page.goto('/parametres/plugins');
  const nav = page.getByRole('navigation').first().or(page.locator('.MuiDrawer-root').first());
  await expect(nav.getByRole('link', { name: 'Plugins', exact: true }).first()).toBeVisible();
});
