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

/** Distance between a day's header and the bottom of the page bar, in px (null while the day is not drawn). */
const gapUnderBar = (page, date) => page.evaluate((d) => {
  const section = document.querySelector(`[data-scroll-anchor="day-${d}"]`);
  const bar = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--gf-page-bar-bottom'));
  return section ? Math.round(section.getBoundingClientRect().top - bar) : null;
}, date);
/** Absolute distance: today's header above the bar is as wrong as below it. */
const offBar = async (page, date) => {
  const gap = await gapUnderBar(page, date);
  return gap === null ? Infinity : Math.abs(gap);
};

test('the planning opens on today, scrolls into the past, crosses an empty fortnight and comes back', async ({ page, request }) => {
  const { today } = await (await request.get('/api/today')).json();
  const property = await createProperty({ name: 'E2E timeline' });
  const client = await createClient({ firstName: 'Camille', lastName: 'Timeline' });
  const farArrival = addDays(today, 56);
  await createReservation({ propertyId: property.id, clientId: client.id, startDate: farArrival, endDate: addDays(farArrival, 2), adults: 2 });
  // Enough cards below today for the page to scroll it up under the bar (a short page cannot).
  for (const start of [2, 5, 8, 11]) {
    await createReservation({ propertyId: property.id, clientId: client.id, startDate: addDays(today, start), endDate: addDays(today, start + 2), adults: 2 });
  }

  await page.goto('/planning');
  await expect(page.getByRole('heading', { name: 'Planning' })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('input[type="date"]')).toHaveCount(0);

  // Opens on today, its header right under the bar (rule 12).
  await expect(page.locator(`[data-scroll-anchor="day-${today}"]`)).toBeVisible();
  await expect.poll(() => offBar(page, today)).toBeLessThanOrEqual(8);
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
    await page.waitForTimeout(260);
  }
  await expect(far).toHaveCount(1);
  await far.scrollIntoViewIfNeeded();
  await expect(far).toBeVisible();
  await expect(far.getByText('Timeline', { exact: false }).first()).toBeVisible();

  // « Aujourd'hui » brings today back under the bar (rule 18).
  await todayButton.click();
  await expect.poll(() => offBar(page, today), { timeout: 10_000 }).toBeLessThanOrEqual(8);
  await expect(todayButton).toBeDisabled();
});

// A planning with nothing on it is short: it never fills the screen, so both edges are always « near ».
// The timeline must not keep asking for windows on its own (specs/dashboard-planning-scroll.md rules 26-27).
test('an empty planning asks for no more windows while nobody touches it', async ({ page, request }) => {
  const { today } = await (await request.get('/api/today')).json();
  let asked = 0;
  await page.route('**/api/planning/days?*', async (route) => {
    asked += 1;
    const url = new URL(route.request().url());
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    const days = [];
    for (let d = from; d <= to; d = addDays(d, 1)) {
      days.push({ date: d, label: d, shortLabel: d, isToday: d === today, isPast: d < today, arrivals: [], departures: [], breakfast: null, optionCards: null });
    }
    await route.fulfill({ json: { from, to, today, days, alerts: { arrivals: {}, departures: {} } } });
  });
  await page.goto('/planning');
  await expect(page.getByTestId('planning-timeline')).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(1500);
  const settled = asked;
  expect(settled).toBeLessThanOrEqual(10);
  await page.waitForTimeout(5000);
  expect(asked).toBe(settled);

  // One pull of the operator asks for more, once per gesture, not without end.
  await page.mouse.move(400, 400);
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(1500);
  const pulled = asked;
  expect(pulled).toBeGreaterThan(settled);
  expect(pulled).toBeLessThanOrEqual(settled + 6);
  await page.waitForTimeout(3000);
  expect(asked).toBe(pulled);
});

test('scrolling past the last booked stay does not load without end', async ({ page, request }) => {
  const { today } = await (await request.get('/api/today')).json();
  const property = await createProperty({ name: 'E2E past the last stay' });
  const client = await createClient({ firstName: 'Camille', lastName: 'Derniere' });
  const arrival = addDays(today, 5);
  await createReservation({ propertyId: property.id, clientId: client.id, startDate: arrival, endDate: addDays(arrival, 2), adults: 2 });
  let asked = 0;
  page.on('request', (r) => { if (r.url().includes('/api/planning/days')) asked += 1; });
  await page.goto('/planning');
  await expect(page.getByTestId('planning-timeline')).toBeVisible({ timeout: 15_000 });
  await page.mouse.move(400, 400);
  for (let i = 0; i < 12; i += 1) {
    await page.mouse.wheel(0, 3000);
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(1500);
  const settled = asked;
  await page.waitForTimeout(4000);
  expect(asked).toBe(settled);
  expect(settled).toBeLessThanOrEqual(40);
});
