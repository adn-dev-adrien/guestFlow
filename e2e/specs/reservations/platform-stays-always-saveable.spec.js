// @ts-check
// specs/reservations/platform-stays-always-saveable.md rules 2, 5 — a stay a platform sold under the property's
// minimum stay opens and saves like any fiche: the broken rule is an info line under the dates, the save asks nothing.
// The minimum comes from the shipped recipe (a holiday bridge locks its nights to 3), the only level at which a real
// server derives it.
import { test, expect, request as pwRequest } from '@playwright/test';
import path from 'path';
import { createProperty, createClient, createReservation } from '../../fixtures/apiSeed.js';
import { CLIENT_URL, API_TIMEOUT } from '../../clientUrl.js';

const STORAGE_STATE = path.join(process.cwd(), 'e2e', '.auth', 'admin.json');

async function lodgeWithRecipe(name) {
  const property = await createProperty({ name, capacityAdults: 5 });
  const ctx = await pwRequest.newContext({ baseURL: CLIENT_URL, storageState: STORAGE_STATE, timeout: API_TIMEOUT });
  try {
    const detail = await (await ctx.get(`/api/properties/${property.id}`)).json();
    const updated = await ctx.put(`/api/properties/${property.id}`, {
      data: { ...detail, maxGuests: 5, doubleBeds: 2, singleBeds: 1, basePriceIncludedGuests: 2 },
    });
    if (!updated.ok()) throw new Error(`property update failed: ${updated.status()}`);
    for (const rule of detail.pricingRules || []) await ctx.delete(`/api/properties/${property.id}/pricing/${rule.id}`);
    const res = await ctx.post(`/api/properties/${property.id}/tariff-recipe/apply`, { data: { recipeId: 'aventura-lodge-2026' } });
    const body = await res.json();
    if (!body.applied) throw new Error(`apply failed: ${JSON.stringify(body.warnings || body)}`);
  } finally {
    await ctx.dispose();
  }
  return property;
}

test('a Booking stay under the minimum shows an info line and saves without any dialog', async ({ page }) => {
  const property = await lodgeWithRecipe('E2E séjour plateforme hors règles');
  const client = await createClient({ firstName: 'Test', lastName: 'PlateformeHorsRegles' });
  const reservation = await createReservation({
    propertyId: property.id, clientId: client.id, startDate: '2027-05-06', endDate: '2027-05-07', adults: 2, platform: 'Booking', // date-literal-ok: the recipe's Ascension bridge requires 3 nights
  });

  await page.goto(`/reservations/${reservation.id}`);
  await expect(page.getByText(/Booking a vendu 1 nuit ; ces dates en demandent 3/)).toBeVisible({ timeout: 15_000 });

  const puts = [];
  page.on('response', (r) => { if (r.request().method() === 'PUT' && /\/api\/reservations\/\d+$/.test(r.url())) puts.push(r.status()); });
  const adults = page.getByLabel('Adultes').first();
  await adults.fill('3');
  await adults.blur();
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).first().click();

  await expect.poll(() => puts, { timeout: 15_000 }).toEqual([200]);
  await expect(page.getByRole('dialog', { name: /Durée minimale/ })).toHaveCount(0);
});
