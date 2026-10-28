// @ts-check
// DS phase-5 mobile smoke (specs/ds-sweep-planning.md §7). /planning at 390px:
//   - the page title is visible on arrival (on xs it is the top bar's heading,
//     specs/shell-and-home-day-first.md rule 15);
//   - no date strip any more (specs/dashboard-planning-scroll.md rule 22): « Aujourd'hui » is a bar action;
//   - no page-level horizontal scroll;
//   - the page scrolls through the WINDOW (no own scroll container — rule 6), so the bar
//     stays sticky after scrolling.
import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 } });

test('Planning on xs: no date strip, « Aujourd\'hui » at hand, no horizontal scroll, window scroll keeps the bar', async ({ page }) => {
  await page.goto('/planning');

  // Title visible on xs (the top bar's heading) — pins « bandeau visible à l'ouverture ».
  await expect(page.getByRole('heading', { name: 'Planning' })).toBeVisible({ timeout: 10_000 });

  // No date picker; the one icon action « Aujourd'hui » is in the top bar (or beside the plugin buttons).
  await expect(page.locator('input[type="date"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: "Aujourd'hui" })).toBeVisible();

  // No page-level horizontal overflow.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);

  // The window (not an inner container) owns the scroll; after scrolling down the sticky
  // bar must still be on screen.
  await page.evaluate(() => window.scrollTo(0, 600));
  await expect(page.getByRole('heading', { name: 'Planning' })).toBeVisible();
});
