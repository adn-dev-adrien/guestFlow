// @ts-check
// specs/plugins-phase-4-registry.md rule 19 — the production build served by the server, every plugin
// loaded from its package (rules 17–18): the app renders its plugin surfaces without a console error;
// a plugin installs from the test registry (rules 10–11, 13); an update restarts the instance and
// leaves a rollback (rules 13, 16, 20); a package that does not match the signed index is refused
// with nothing changed (rule 22).
const { test, expect } = require('@playwright/test');

test.describe.configure({ mode: 'serial' });

function trackErrors(page) {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

const card = (page, name) => page.locator('.MuiCard-root').filter({ has: page.getByText(name, { exact: true }) });

test('rule 19: the app renders with plugins loaded from their bundles, without a console error', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Tableau de bord' })).toBeVisible();
  await page.goto('/planning');
  await expect(page.getByRole('heading', { name: 'Planning' })).toBeVisible();
  await page.goto('/parametres/recettes');
  await expect(page.getByRole('heading', { name: 'Recettes tarifaires' })).toBeVisible();
  await page.goto('/parametres/plugins');
  await expect(card(page, 'Vigilance Météo-France')).toBeVisible();
  const entries = await (await page.request.get('/plugin-assets/entries.json')).json();
  expect(entries.map((e) => e.id)).toContain('tariff-recipes');
  expect(entries.map((e) => e.id)).not.toContain('linen');
  expect(errors).toEqual([]);
});

test('rules 10, 11, 13: a plugin installs from the registry, and its page renders after the reload', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/parametres/plugins');
  await page.getByRole('tab', { name: /Disponibles/ }).click();
  const linen = card(page, 'Linge et blanchisserie');
  await expect(linen.getByText('1.0.1')).toBeVisible();
  await linen.getByRole('button', { name: 'Installer' }).click();
  await page.waitForLoadState('load');
  await expect(card(page, 'Linge et blanchisserie').getByText('Actif')).toBeVisible();
  await expect(card(page, 'Linge et blanchisserie').getByText('1.0.1')).toBeVisible();
  await page.goto('/parametres/stock-blanchisserie');
  await expect(page.getByText('Parures de lit')).toBeVisible();
  expect(errors).toEqual([]);
});

test('rules 13, 16, 20: an update shows its changelog, restarts the instance and offers the rollback', async ({ page }) => {
  await page.goto('/parametres/plugins');
  await expect(page.getByText(/mises? à jour disponibles?/)).toBeVisible();
  const weather = card(page, 'Vigilance Météo-France');
  await weather.getByText('Mise à jour 1.0.2').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('L’alerte orange est rappelée la veille de l’arrivée.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Mettre à jour' }).click();
  await expect(page.getByText('Redémarrage en cours')).toBeVisible();
  await expect(card(page, 'Vigilance Météo-France').getByText('1.0.2')).toBeVisible({ timeout: 45_000 });
  await card(page, 'Vigilance Météo-France').getByText('Vigilance Météo-France', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Revenir à la version précédente' })).toBeVisible();
});

test('rule 22: a package that does not match its signature is refused, nothing changes', async ({ page }) => {
  await page.goto('/parametres/plugins');
  const holidays = card(page, 'Vacances scolaires');
  await holidays.getByText('Mise à jour 1.0.1').click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Mettre à jour' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Le paquet reçu ne correspond pas à sa signature — rien n’a été modifié.');
  await dialog.getByRole('button', { name: 'Fermer' }).click();
  await expect(card(page, 'Vacances scolaires').getByText('1.0.0')).toBeVisible();
});
