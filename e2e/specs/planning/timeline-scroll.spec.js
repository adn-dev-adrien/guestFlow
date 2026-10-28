// @ts-check
// specs/dashboard-planning-scroll.md rules 12-14, 18, 22 — the planning is a timeline of days that scrolls
// into the past and the future: it opens on today under the bar, the past is one scroll up, an empty
// fortnight does not stop the scroll (a stay 8 weeks out is reachable), « Aujourd'hui » comes back, and
// there is no date input on the page.
import { test, expect } from '@playwright/test';
import { createClient, createProperty, createReservation } from '../../fixtures/apiSeed.js';

const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Distance between a day's header and the bottom of the page bar, in px. */
const gapUnderBar = (page, date) => page.evaluate((d) => {
  const section = document.querySelector(`[data-scroll-anchor="day-${d}"]`);
  const bar = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--gf-page-bar-bottom'));
  return section ? Math.round(section.getBoundingClientRect().top - bar) : null;
}, date);

test('the planning opens on today, scrolls into the past, crosses an empty fortnight and comes back', async ({ page, request }) => {
  const { today } = await (await request.get('/api/today')).json();
  const property = await createProperty({ name: 'E2E timeline' });
  const client = await createClient({ firstName: 'Camille', lastName: 'Timeline' });
  const farArrival = addDays(today, 56);
  await createReservation({ propertyId: property.id, clientId: client.id, startDate: farArrival, endDate: addDays(farArrival, 2), adults: 2 });

  await page.goto('/planning');
  await expect(page.getByRole('heading', { name: 'Planning' })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('input[type="date"]')).toHaveCount(0);

  // Opens on today, its header right under the bar (rule 12).
  await expect(page.locator(`[data-scroll-anchor="day-${today}"]`)).toBeVisible();
  await expect.poll(() => gapUnderBar(page, today)).toBeLessThanOrEqual(8);
  expect(await gapUnderBar(page, today)).toBeGreaterThanOrEqual(-8);
  const todayButton = page.getByRole('button', { name: "Aujourd'hui" });
  await expect(todayButton).toBeDisabled();

  // Scroll up: the past is there, and today moved down without a jump (rule 13).
  await page.mouse.move(400, 400);
  await page.mouse.wheel(0, -500);
  await expect(todayButton).toBeEnabled();
  const afterWheel = await gapUnderBar(page, today);
  expect(afterWheel).toBeGreaterThan(8);
  const yesterday = addDays(today, -1);
  await expect(page.locator(`[data-scroll-anchor="day-${yesterday}"], [data-testid="planning-fold"]`).first()).toBeVisible();

  // Scroll down through empty fortnights up to the stay 8 weeks out (rule 14).
  const far = page.locator(`[data-scroll-anchor="day-${farArrival}"]`);
  for (let i = 0; i < 60 && (await far.count()) === 0; i += 1) {
    await page.mouse.wheel(0, 1500);
    await page.waitForTimeout(120);
  }
  await expect(far).toHaveCount(1);
  await far.scrollIntoViewIfNeeded();
  await expect(far).toBeVisible();
  await expect(far.getByText('Timeline', { exact: false }).first()).toBeVisible();

  // « Aujourd'hui » brings today back under the bar (rule 18).
  await todayButton.click();
  await expect.poll(() => gapUnderBar(page, today), { timeout: 10_000 }).toBeLessThanOrEqual(8);
  await expect(todayButton).toBeDisabled();
});
