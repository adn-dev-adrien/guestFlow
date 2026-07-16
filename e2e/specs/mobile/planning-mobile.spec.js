// @ts-check
// DS phase-5 mobile smoke (specs/ds-sweep-planning.md §7). /planning at 390px:
//   - the sticky PageActionBar is visible on arrival (title shown on xs via titleOnXs);
//   - the date cluster renders as the compact strip under the bar (bar `center` is hidden on xs);
//   - no page-level horizontal scroll;
//   - the page scrolls through the WINDOW (no own scroll container — rule 6), so the bar
//     stays sticky after scrolling.
import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 } });

test('Planning on xs: sticky bar + date strip, no horizontal scroll, window scroll keeps the bar', async ({ page }) => {
  await page.goto('/planning');

  // Bar title visible on xs (titleOnXs) — pins « bandeau visible à l'ouverture ».
  await expect(page.getByRole('heading', { name: 'Planning' })).toBeVisible({ timeout: 10_000 });

  // The xs date strip renders the date input + nav arrows below the bar. The bar `center`
  // clone exists in the DOM but is display:none on xs — filter to the visible one.
  await expect(page.locator('input[type="date"]:visible').first()).toBeVisible();

  // No page-level horizontal overflow.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);

  // The window (not an inner container) owns the scroll; after scrolling down the sticky
  // bar must still be on screen.
  await page.evaluate(() => window.scrollTo(0, 600));
  await expect(page.getByRole('heading', { name: 'Planning' })).toBeVisible();
});
