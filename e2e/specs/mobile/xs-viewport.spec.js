// @ts-check
// Test 6/24 — mobile/xs-viewport (spec §3.4 row 24). xs viewport, sidebar collapsed,
// reachable via a drawer toggle, primary content visible. Pins responsive memory rule.
import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 } });

test('Dashboard renders on xs viewport with reachable navigation drawer', async ({ page }) => {
  await page.goto('/');
  // The day first (specs/shell-and-home-day-first.md rule 1); the home's top bar keeps the wordmark.
  await expect(page.getByText('Départs du jour')).toBeVisible({ timeout: 10_000 });

  // On xs the persistent sidebar collapses behind the named menu button (rule 18).
  await page.getByRole('button', { name: 'Ouvrir le menu' }).click();
  await expect(page.getByRole('link', { name: /Planning/i }).first()).toBeVisible();
  // No horizontal scroll on a phone.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('specs/shell-and-home-day-first.md rule 15 — on a phone the top bar names the open page', async ({ page }) => {
  await page.goto('/devis');
  await expect(page.getByTestId('appbar-page-title')).toHaveText('Devis', { timeout: 10_000 });
});
