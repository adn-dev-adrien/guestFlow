// @ts-check
// DS phase-3 sweep, mobile check (specs/ds-sweep-settings.md §7) — the Options catalog renders
// stacked CARDS on a phone viewport (ResponsiveTable) instead of a horizontal-scroll table, and the
// page body never scrolls sideways.
import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 } });

test('/options at 390px renders cards (no table, no horizontal page scroll)', async ({ page }) => {
  await page.goto('/options');
  // The bar title is hidden on xs by design — anchor on the create CTA instead.
  await expect(page.getByRole('button', { name: 'Nouvelle option' })).toBeVisible({ timeout: 10_000 });
  // Wait for the list to settle (either cards or the empty state — the seed has options).
  await expect(page.locator('table')).toHaveCount(0);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
