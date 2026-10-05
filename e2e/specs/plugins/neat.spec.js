// @ts-check
// plugins/neat — specs/plugins-phase-3b-neat.md rules 13, 15, 21 (decision P13). With Neat active, its card
// sits in Intégrations, the insurance option is in the catalogue and its push toggle is listed. Switched
// off, the three go; switched back on, they come back with the option's settings.
import { test, expect } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

const insuranceIn = (options) => options.find((o) => Number(o.isCancellationInsurance) === 1) || null;

test('switched off, the insurance, the Neat card and its push toggle go; switched on, they come back', async ({ page, request }) => {
  await page.goto('/settings/integrations');
  await expect(page.getByText('Assurance annulation (Neat)')).toBeVisible({ timeout: 15_000 });
  const before = insuranceIn(await (await request.get('/api/options')).json());
  expect(before).not.toBeNull();
  expect((await (await request.get('/api/push/preferences')).json()).available).toContain('neat');

  expect((await request.post('/api/plugins/neat/deactivate')).status()).toBe(200);
  try {
    expect(insuranceIn(await (await request.get('/api/options')).json())).toBeNull();
    expect((await request.get(`/api/options/${before.id}`)).status()).toBe(404);
    expect((await (await request.get('/api/push/preferences')).json()).available).not.toContain('neat');
    expect((await request.get('/api/neat/settings')).status()).toBe(404);
    await page.goto('/settings/integrations');
    await expect(page.getByRole('heading', { name: 'Intégrations' }).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Assurance annulation (Neat)')).toHaveCount(0);
  } finally {
    expect((await request.post('/api/plugins/neat/activate')).status()).toBe(200);
  }

  const after = insuranceIn(await (await request.get('/api/options')).json());
  expect(after).toMatchObject({ id: before.id, price: before.price, priceType: before.priceType });
});
