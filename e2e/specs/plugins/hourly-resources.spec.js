// @ts-check
// plugins/hourly-resources — specs/plugins-phase-3c-hourly-resources.md rules 18–21 (decision P14). With
// the plugin active, a resource sold by the hour is in the catalogue and Calendrier › Ressources is in the
// menu. Switched off, both go and its URLs answer 404; switched back on, they come back with the resource's
// settings.
import { test, expect } from '@playwright/test';
import { createHourlyResource } from '../../fixtures/apiSeed';

test.describe.configure({ mode: 'serial' });

const byId = (resources, id) => resources.find((r) => Number(r.id) === Number(id)) || null;

test('switched off, nothing is sold by the hour and Calendrier › Ressources goes; switched on, both come back', async ({ page, request }) => {
  const bath = await createHourlyResource({ name: 'Bain nordique plugin E2E' });
  expect(byId(await (await request.get('/api/resources')).json(), bath.id)).not.toBeNull();
  await page.goto('/calendar');
  await page.getByRole('button', { name: 'Calendrier' }).first().click().catch(() => {});
  await expect(page.getByRole('link', { name: 'Ressources' })).toBeVisible({ timeout: 15_000 });

  expect((await request.post('/api/plugins/hourly-resources/deactivate')).status()).toBe(200);
  try {
    expect(byId(await (await request.get('/api/resources')).json(), bath.id)).toBeNull();
    expect((await request.get(`/api/resources/${bath.id}`)).status()).toBe(404);
    expect((await request.get('/api/resource-bookings/planning-events?from=2026-01-01&to=2026-01-02')).status()).toBe(404);
    await page.goto('/calendar');
    await expect(page.getByRole('link', { name: 'Ressources' })).toHaveCount(0);
  } finally {
    expect((await request.post('/api/plugins/hourly-resources/activate')).status()).toBe(200);
  }

  const back = byId(await (await request.get('/api/resources')).json(), bath.id);
  expect(back).toMatchObject({ id: bath.id, priceType: 'per_hour', price: bath.price });
});
