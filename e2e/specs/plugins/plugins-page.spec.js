// @ts-check
// plugins/plugins-page — specs/plugins-phase-0-foundation.md §3.B, §3.D, §3.E.
// Drives the Plugins page against the real server and checks that an inactive plugin leaves no
// trace. Only Google Agenda is switched off: no other spec depends on it, so the suite can keep
// running in parallel locally. The seed installs every catalogue plugin active (seed-e2e.js); the
// last step puts Google Agenda back in that state.
import { test, expect } from '@playwright/test';

const GOOGLE = 'Google Agenda';
const googleCard = (page) => page.locator('.MuiCard-root').filter({ hasText: GOOGLE });
// specs/plugins-phase-0-foundation.md rule 25 — the E2E database has no Google connection: the card
// says what is missing, and « Désactiver » sits in ⋯ behind a confirmation.
const GOOGLE_STATE = 'Actif · à connecter';

async function deactivate(page, card) {
  await card.getByRole('button', { name: /Plus d’actions/ }).click();
  await page.getByRole('menuitem', { name: /Désactiver/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Désactiver' }).click();
}

test.describe.configure({ mode: 'serial' });

test('the seeded database has every catalogue plugin installed and active', async ({ page }) => {
  await page.goto('/parametres/plugins');
  await expect(page.getByRole('tab', { name: 'Installés (15)' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tab', { name: 'Disponibles (0)' })).toBeVisible();
  await expect(googleCard(page).getByText(GOOGLE_STATE, { exact: true })).toBeVisible();
});

test('deactivating Google Agenda removes its section and its API, activating brings them back', async ({ page, request }) => {
  await page.goto('/settings/integrations?tab=google-calendar');
  await expect(page.getByText('Synchronisation Google Agenda')).toBeVisible({ timeout: 10_000 });

  await page.goto('/parametres/plugins');
  await deactivate(page, googleCard(page));
  await expect(googleCard(page).getByText('Inactif', { exact: true })).toBeVisible();

  const off = await request.get('/api/google-calendar/status');
  expect(off.status()).toBe(404);
  expect(await off.json()).toEqual({ error: 'PLUGIN_INACTIVE', plugin: 'google-calendar' });

  await page.goto('/settings/integrations?tab=google-calendar');
  await expect(page.getByRole('heading', { name: 'Intégrations' }).first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Synchronisation Google Agenda')).toHaveCount(0);
  await expect(page.getByRole('tab', { name: /^Google Agenda/ })).toHaveCount(0);

  await page.goto('/parametres/plugins');
  await googleCard(page).getByRole('button', { name: 'Activer' }).click();
  await expect(googleCard(page).getByText(GOOGLE_STATE, { exact: true })).toBeVisible();
  expect((await request.get('/api/google-calendar/status')).status()).toBe(200);
});

test('uninstall takes two clicks, moves the plugin to « Disponibles », and it installs back active', async ({ page }) => {
  await page.goto('/parametres/plugins');
  await googleCard(page).getByText(GOOGLE).click();
  await googleCard(page).getByRole('button', { name: 'Désinstaller' }).click();
  await expect(googleCard(page).getByText(/^Données conservées\.$/)).toBeVisible();
  await googleCard(page).getByRole('button', { name: 'Confirmer la désinstallation' }).click();

  await expect(page.getByRole('tab', { name: 'Installés (14)' })).toBeVisible();
  await page.getByRole('tab', { name: 'Disponibles (1)' }).click();
  await googleCard(page).getByRole('button', { name: 'Installer' }).click();

  await expect(page.getByRole('tab', { name: 'Installés (15)' })).toHaveAttribute('aria-selected', 'true');
  await expect(googleCard(page).getByText(GOOGLE_STATE, { exact: true })).toBeVisible();
});

test('the SAS cannot be deactivated while a reception account is active', async ({ page }) => {
  await page.goto('/parametres/plugins');
  const sas = page.locator('.MuiCard-root').filter({ hasText: 'Arrivée et départ guidés' });
  // The refusal is said before the click, and the menu item it would refuse is disabled.
  await expect(sas.getByText('Actif', { exact: true })).toBeVisible();
  await sas.getByRole('button', { name: /Plus d’actions/ }).click();
  const item = page.getByRole('menuitem', { name: /Désactiver/ });
  await expect(item).toHaveAttribute('aria-disabled', 'true');
  await expect(item).toContainText('1 compte Accueil actif : changer son rôle dans Utilisateurs d’abord.');
  await page.keyboard.press('Escape');
});

test('rule 25: « Configurer » on Google Agenda opens its tab of Intégrations', async ({ page }) => {
  await page.goto('/parametres/plugins');
  await page.getByRole('button', { name: /^À configurer \(\d+\)$/ }).click();
  await googleCard(page).getByRole('button', { name: 'Configurer' }).click();
  await expect(page).toHaveURL(/\/settings\/integrations\?tab=google-calendar$/);
  await expect(page.getByRole('tab', { name: /^Google Agenda/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('Synchronisation Google Agenda')).toBeInViewport({ timeout: 10_000 });
});

// specs/integrations-tab-per-plugin.md rules 2, 5 and 6 — « Configurer » lands on its plugin's tab, on a
// phone and on a desktop; on a phone the tab strip scrolls inside the bar, never the page.
for (const width of [390, 1280]) {
  for (const [name, id, tab] of [['Assurance annulation Neat', 'neat', 'Neat'], ['Vigilance Météo-France', 'weather-alerts', 'Météo-France']]) {
    test(`integrations-tab-per-plugin rules 2, 5: at ${width} px « Configurer » on ${name} opens its tab`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/parametres/plugins');
      const card = page.locator('.MuiCard-root').filter({ hasText: name });
      await card.getByRole('button', { name: 'Configurer' }).click();
      await expect(page).toHaveURL(new RegExp(`/settings/integrations\\?tab=${id}$`));
      const selected = page.getByRole('tab', { name: new RegExp(`^${tab}`) });
      await expect(selected).toHaveAttribute('aria-selected', 'true');
      await expect(selected).toBeInViewport();
      await expect(page.getByRole('tabpanel', { name: tab })).toBeVisible({ timeout: 10_000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
    });
  }
}

test('integrations-tab-per-plugin rule 6: an old #plugin- link opens the tab and becomes ?tab=', async ({ page }) => {
  await page.goto('/settings/integrations#plugin-neat');
  await expect(page).toHaveURL(/\/settings\/integrations\?tab=neat$/);
  await expect(page.getByRole('tab', { name: /^Neat/ })).toHaveAttribute('aria-selected', 'true');
});

test('integrations-tab-per-plugin rule 2: on a phone the tab strip scrolls inside the bar', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto('/settings/integrations?tab=booking-intake');
  const list = page.getByRole('tablist', { name: 'Intégrations' });
  await expect(list.getByRole('tab', { name: /^Booking/ })).toBeInViewport({ timeout: 10_000 });
  const scroller = list.locator('xpath=..');
  expect(await scroller.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
});

test('the Plugins entry sits in the Paramètres submenu', async ({ page }) => {
  await page.goto('/parametres/plugins');
  const nav = page.getByRole('navigation').first().or(page.locator('.MuiDrawer-root').first());
  await expect(nav.getByRole('link', { name: 'Plugins', exact: true }).first()).toBeVisible();
});

// specs/plugins-phase-1-sdk.md rules 12, 21 and 24 — a plugin module's data goes with it when asked,
// and a reinstall starts empty. Météo: no other spec depends on its data.
test('uninstalling Météo with « Effacer aussi ses données » erases its key; the reinstall starts empty', async ({ page, request }) => {
  const saved = await request.put('/api/plugins/weather-alerts/settings', { data: { apiKey: 'e2e-key' } });
  expect(await saved.json()).toEqual({ apiKeySet: true });

  await page.goto('/parametres/plugins');
  const weather = page.locator('.MuiCard-root').filter({ hasText: 'Vigilance Météo-France' });
  await weather.getByText('Vigilance Météo-France').click();
  await weather.getByRole('checkbox', { name: 'Effacer aussi ses données' }).check();
  await expect(weather.getByText('Seront effacés : la clé Météo-France. C’est définitif.')).toBeVisible();
  await weather.getByRole('button', { name: 'Désinstaller' }).click();
  await weather.getByRole('button', { name: 'Désinstaller et effacer' }).click();

  await page.getByRole('tab', { name: /^Disponibles/ }).click();
  await weather.getByRole('button', { name: 'Installer' }).click();
  await expect(page.getByRole('tab', { name: 'Installés (15)' })).toHaveAttribute('aria-selected', 'true');
  expect(await (await request.get('/api/plugins/weather-alerts/settings')).json()).toEqual({ apiKeySet: false });
});
