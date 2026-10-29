// @ts-check
// settings/settings-summary — specs/settings-rationalization.md rules 24–27 (UI/UX review 2026-10-18,
// proposal 20, decision 12). `/settings` is the summary: four groups with the server's state lines,
// a search that understands wifi / iban / smtp / 2fa, and a sidebar whose groups unfold.
import { test, expect } from '@playwright/test';

test('rule 24: « Paramètres » opens the summary, its four groups and their pages', async ({ page }) => {
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Paramètres' }).first()).toBeVisible({ timeout: 10_000 });
  for (const group of ['Établissement', 'Séjours', 'Paiements et emails', 'Compte et système']) {
    await expect(page.getByRole('heading', { level: 2, name: group })).toBeVisible();
  }
  const main = page.locator('main');
  await expect(main.getByRole('link', { name: /Mon compte/ })).toBeVisible();
  // Rule 25 — the server's state line under a row.
  await expect(main.getByRole('link', { name: /Logements/ })).toContainText(/\d+ logements?|Aucun logement/, { timeout: 10_000 });
});

test('rule 27: the search finds a page by the owner’s word and says which', async ({ page }) => {
  await page.goto('/settings');
  const search = page.getByRole('searchbox', { name: 'Chercher un réglage' });
  await search.fill('wifi');
  const main = page.locator('main');
  await expect(main.getByRole('link', { name: /Logements/ })).toContainText('Contient : Wi-Fi');
  await search.fill('smtp');
  await expect(main.getByRole('link', { name: /Emails & notifications/ })).toBeVisible();
  await search.fill('zzz');
  await expect(page.getByText('Aucun réglage pour « zzz »')).toBeVisible();
  await search.fill('2fa');
  await main.getByRole('link', { name: /Mon compte/ }).click();
  await expect(page).toHaveURL(/\/mon-compte$/);
});

test('rule 26: a group of the sidebar opens the summary on it and unfolds its pages only', async ({ page }) => {
  await page.goto('/settings/etablissement');
  const nav = page.getByRole('navigation').first().or(page.locator('.MuiDrawer-root').first());
  await expect(nav.getByRole('link', { name: 'Plateformes', exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(nav.getByRole('link', { name: 'TVA & exercice', exact: true })).toHaveCount(0);
  const group = nav.getByRole('link', { name: 'Paiements et emails' });
  await expect(group).toBeInViewport();
  await expect.poll(async () => {
    if (!/\/settings#paiements-emails$/.test(page.url())) await group.click();
    return page.url();
  }, { timeout: 15_000 }).toMatch(/\/settings#paiements-emails$/);
  await expect(nav.getByRole('link', { name: 'TVA & exercice', exact: true })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Plateformes', exact: true })).toHaveCount(0);
});
