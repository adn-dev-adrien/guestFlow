// @ts-check
// specs/ds-tabs.md rules 2-3 — on a phone the tabs are the SECOND ROW of the page's sticky bar,
// under a title that stays visible. Before this spec, the tab wrappers drew their strip ABOVE the
// bar and the page showed no title at all.
// Also rule 10: nothing about the tabs' content moved — same labels, and `?tab=` still drives the
// selection, so every existing link keeps landing on the tab it named.
import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 } });

test('/parametres/options-ressources at 390px: title first, tabs under it, no sideways scroll', async ({ page }) => {
  await page.goto('/parametres/options-ressources');

  const title = page.getByRole('heading', { name: 'Options de séjour' });
  await expect(title).toBeVisible({ timeout: 10_000 });

  const tabs = page.getByRole('tab');
  await expect(tabs).toHaveCount(3);

  // The tabs sit BELOW the title, not above it.
  const titleBox = await title.boundingBox();
  const tabsBox = await tabs.first().boundingBox();
  expect(tabsBox.y).toBeGreaterThan(titleBox.y);

  // Touch target (CLAUDE.md §7): at least 44px tall.
  expect(tabsBox.height).toBeGreaterThanOrEqual(44);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('switching tab on a phone keeps the title + tabs in the same block', async ({ page }) => {
  await page.goto('/parametres/options-ressources');
  await expect(page.getByRole('heading', { name: 'Options de séjour' })).toBeVisible({ timeout: 10_000 });

  // rule 10 — the tab still lives in the URL, under its original name.
  await page.getByRole('tab', { name: 'Ressources' }).click();
  await expect(page).toHaveURL(/tab=resources/);

  const title = page.getByRole('heading', { name: 'Ressources' });
  await expect(title).toBeVisible();
  const tabsBox = await page.getByRole('tab').first().boundingBox();
  expect(tabsBox.y).toBeGreaterThan((await title.boundingBox()).y);
  await expect(page.getByRole('tab', { name: 'Ressources' })).toHaveAttribute('aria-selected', 'true');
});
