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

  const title = page.getByRole('heading', { name: 'Options & ressources' });
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
  await expect(page.getByRole('heading', { name: 'Options & ressources' })).toBeVisible({ timeout: 10_000 });

  // rule 10 — the tab still lives in the URL, under its original name.
  await page.getByRole('tab', { name: 'Ressources' }).click();
  await expect(page).toHaveURL(/tab=resources/);

  const title = page.getByRole('heading', { name: 'Options & ressources' });
  await expect(title).toBeVisible();
  // Each tab mounts its own bar, so the strip is replaced on a switch: measure what is there NOW, retrying
  // while the previous strip is detached (a handle taken from it has no box).
  await expect.poll(async () => {
    const tabsBox = await page.getByRole('tab').first().boundingBox();
    const titleBox = await title.boundingBox();
    return tabsBox && titleBox ? tabsBox.y > titleBox.y : null;
  }).toBe(true);
  await expect(page.getByRole('tab', { name: 'Ressources' })).toHaveAttribute('aria-selected', 'true');
});

// specs/ds-tabs.md rule 12 — a lazy plugin tab keeps the bar drawn while its chunk loads.
test('switching to a plugin tab never leaves the page without tabs', async ({ page }) => {
  await page.goto('/parametres/options-ressources');
  await expect(page.getByRole('tab')).toHaveCount(3, { timeout: 10_000 });
  await page.evaluate(() => {
    window.__tabCounts = new Set();
    window.__tabYs = new Set();
    const sample = () => {
      const tabs = document.querySelectorAll('[role=tab]');
      window.__tabCounts.add(tabs.length);
      if (tabs.length) window.__tabYs.add(Math.round(tabs[0].getBoundingClientRect().y));
      requestAnimationFrame(sample);
    };
    sample();
  });
  await page.getByRole('tab', { name: 'Facturables au SAS' }).click();
  await expect(page).toHaveURL(/tab=sas/);
  await expect(page.getByRole('heading', { name: 'Facturables au SAS' }).first()).toBeVisible();
  await page.evaluate(() => new Promise((resolve) => { requestAnimationFrame(() => requestAnimationFrame(resolve)); }));
  expect(await page.evaluate(() => [...window.__tabCounts])).toEqual([3]);
  // The fallback bar has the same rows as the loaded one: the strip does not jump when the real bar mounts.
  expect(await page.evaluate(() => [...window.__tabYs])).toHaveLength(1);
});
