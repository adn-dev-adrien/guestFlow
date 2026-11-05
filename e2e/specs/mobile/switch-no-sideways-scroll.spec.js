// @ts-check
// specs/ds-components.md rule 30 (audit R22-C7) — measured in a real browser at 390 px with touch: a switch's input
// sticks out in height only. It kept the row's text from its own tap, and scrolled a dialog's content sideways.
import { test, expect } from '@playwright/test';

test.describe('phone (390 px, touch)', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('rule 30 — a switch near the edge leaves its sides to the row, and keeps 44 px of height', async ({ page }) => {
    await page.goto('/settings/emails');
    const input = page.locator('.MuiSwitch-input').first();
    await expect(input).toBeAttached({ timeout: 10_000 });
    await input.scrollIntoViewIfNeeded();
    const probe = await input.evaluate((el) => {
      const root = el.closest('.MuiSwitch-root');
      const box = root.getBoundingClientRect();
      const y = box.top + box.height / 2;
      return {
        rootWidth: box.width,
        inputHeight: el.getBoundingClientRect().height,
        leftOfRoot: document.elementFromPoint(box.left - 8, y) === el,
        rightOfRoot: document.elementFromPoint(box.right + 8, y) === el,
        pageSlides: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      };
    });
    expect(probe).toEqual({ rootWidth: probe.rootWidth, inputHeight: 44, leftOfRoot: false, rightOfRoot: false, pageSlides: false });
  });
});
