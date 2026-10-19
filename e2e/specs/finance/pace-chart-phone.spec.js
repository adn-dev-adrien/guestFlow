// @ts-check
// specs/booking-pace.md rules 14-15 (UI/UX review 2026-10-18, decision 9): on a phone « Réservations à
// venir, à date » stays a chart that scrolls under a fixed axis, set on the current month, and one tap
// opens a month's pickup curve. On a wide screen, one click does.
import { test, expect } from '@playwright/test';

const paceCard = (page) => page.locator('.MuiCard-root', { hasText: 'Réservations à venir, à date' });

test.describe('phone (390 px, touch)', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('rules 14-15 — scrolling chart under a fixed axis, set on the current month; one tap opens it', async ({ page }) => {
    await page.goto('/finance');
    const scroller = page.getByTestId('pace-scroller');
    await expect(scroller).toBeAttached({ timeout: 15_000 });
    await expect(page.getByTestId('pace-fixed-axis')).toBeAttached();
    const geometry = await scroller.evaluate((el) => ({ left: el.scrollLeft, overflows: el.scrollWidth > el.clientWidth + 1 }));
    expect(geometry).toEqual({ left: 0, overflows: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

    await scroller.scrollIntoViewIfNeeded();
    const box = await scroller.boundingBox();
    await page.touchscreen.tap(box.x + 56 * 1.5, box.y + 100);
    await expect(paceCard(page).getByText(/^Montée en charge · /)).toBeVisible();

    // A new payload (another metric) brings the scroll back to the current month.
    await scroller.evaluate((el) => { el.scrollLeft = 200; });
    await paceCard(page).getByRole('button', { name: 'Nuits', exact: true }).tap();
    await expect.poll(() => scroller.evaluate((el) => el.scrollLeft)).toBe(0);
  });
});

test('rule 15 — on a wide screen one click opens a month, without a hover first', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/finance');
  const scroller = page.getByTestId('pace-scroller');
  await expect(scroller).toBeAttached({ timeout: 15_000 });
  await expect(page.getByTestId('pace-fixed-axis')).toHaveCount(0);
  await scroller.scrollIntoViewIfNeeded();
  const box = await scroller.boundingBox();
  await page.mouse.click(box.x + 38 + ((box.width - 42) / 12) * 2.5, box.y + 100);
  await expect(paceCard(page).getByText(/^Montée en charge · /)).toBeVisible();
});
