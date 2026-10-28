// @ts-check
// specs/dashboard-planning-scroll.md rule 20 — while the past window loads, a thin progress bar sits right
// under the page bar. On a phone of a bare install the planning bar has a single action, handed to the
// app's top bar: the bar is not drawn, the progress bar still is, fixed under the top bar.
import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 } });

test('the past-loading progress bar shows at 390 px even when the page bar is not drawn', async ({ page, request }) => {
  const { today } = await (await request.get('/api/today')).json();
  const farPast = new Date(`${today}T00:00:00Z`);
  farPast.setUTCDate(farPast.getUTCDate() - 20);
  const cut = farPast.toISOString().slice(0, 10);
  let release = () => {};
  const held = new Promise((resolve) => { release = resolve; });
  await page.route('**/api/planning/days?*', async (route) => {
    const from = new URL(route.request().url()).searchParams.get('from');
    if (from < cut) await held;
    await route.continue();
  });

  await page.goto('/planning');
  await expect(page.getByTestId('planning-timeline')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-sticky-bar]')).toHaveCount(0);

  await page.mouse.move(200, 400);
  const progress = page.getByRole('progressbar', { name: 'Chargement des jours précédents' });
  // The edges extend only once the opening position is set: a wheel sent before that is ignored, so it is repeated.
  await expect(async () => {
    await page.mouse.wheel(0, -300);
    await expect(progress).toHaveCount(1, { timeout: 1000 });
  }).toPass({ timeout: 10_000 });
  await expect(progress).toBeVisible();
  const box = await progress.boundingBox();
  const topBar = await page.locator('header.MuiAppBar-root').first().boundingBox();
  // The progress starts right under the top bar's 1 px border, so both of its pixel rows show.
  expect(box.y).toBeGreaterThanOrEqual(topBar.y + topBar.height - 0.5);
  expect(box.y).toBeLessThanOrEqual(topBar.y + topBar.height + 0.5);
  expect(box.height).toBe(2);

  release();
  await expect(progress).toHaveCount(0);
});
