// @ts-check
// specs/tariff-events-and-extra-guest-tiers/spec.md §3.1-§3.2
//
// What a recipe actually charges, quoted by the real server for a real reservation.
//
// Every client test mocks the quote and every server test hand-builds the property, so no test
// currently joins the two: that a recipe applied through the API produces, for a reservation the
// UI created, the seasons and the supplement the recipe declares. This is also the only level at
// which the minimum-stay contrast can be shown — one night sellable during the event, the same
// single night refused on a public-holiday bridge.
import { test, expect, request as pwRequest } from '@playwright/test';
import path from 'path';
import { createProperty, createClient, createReservation } from '../../fixtures/apiSeed.js';

const STORAGE_STATE = path.join(process.cwd(), 'e2e', '.auth', 'admin.json');
const RECIPE_ID = 'aventura-lodge-2026';

// ONE request context for the whole file. Creating one per call cost enough, next to a
// recipe apply (two years of calendar derivation per property), to push a request past the 5 s
// timeout under parallel workers — a flake with no bug behind it, which is the worst kind.
let sharedCtx;
test.beforeAll(async () => {
  sharedCtx = await pwRequest.newContext({ baseURL: 'http://localhost:3000', storageState: STORAGE_STATE });
});
test.afterAll(async () => { await sharedCtx?.dispose(); });

async function api(fn) {
  return fn(sharedCtx);
}

/**
 * A property carrying the shipped recipe.
 *
 * The occupancy fields are set SEPARATELY and on purpose: a recipe owns seasons, prices and the
 * calendar, never how many guests the base price covers (spec tariff-recipes §3.1 rule 6). Applying
 * the recipe to a property that still includes 0 guests bills no supplement at all — which is
 * exactly what this helper got wrong on its first run, and what the production script exists for.
 */
async function lodgeWithRecipe(name) {
  const property = await createProperty({ name, capacityAdults: 5 });
  await api(async (ctx) => {
    const detail = await (await ctx.get(`/api/properties/${property.id}`)).json();
    const updated = await ctx.put(`/api/properties/${property.id}`, {
      data: { ...detail, maxGuests: 5, basePriceIncludedGuests: 2, extraGuestPrice: 15, extraGuestPriceUnit: 'per_night' },
    });
    if (!updated.ok()) throw new Error(`property update failed: ${updated.status()}`);
    // The auto « Tarif annuel » season is manual and would block the recipe (rule 9).
    for (const rule of detail.pricingRules || []) await ctx.delete(`/api/properties/${property.id}/pricing/${rule.id}`);
    const res = await ctx.post(`/api/properties/${property.id}/tariff-recipe/apply`, { data: { recipeId: RECIPE_ID } });
    const body = await res.json();
    if (!body.applied) throw new Error(`apply failed: ${JSON.stringify(body.warnings || body)}`);
  });
  return property;
}

/** `/reservations/calculate-price` — the very endpoint the reservation form calls on every edit. */
async function quote(propertyId, { adults, startDate, endDate }) {
  return api(async (ctx) => {
    const res = await ctx.post('/api/reservations/calculate-price', {
      data: {
        propertyId, adults, children: 0, teens: 0, babies: 0,
        startDate, endDate, checkInTime: '16:00', checkOutTime: '10:00',
        platform: 'direct', selectedOptions: [], selectedResources: [], customOptions: [],
      },
    });
    if (!res.ok()) throw new Error(`quote failed: ${res.status()} ${await res.text()}`);
    return res.json();
  });
}

test.describe('quotes under a recipe', () => {
  test("the Ardéchoise week is billed at the high-season price", async () => {
    const property = await lodgeWithRecipe('E2E devis événement');

    const inEvent = await quote(property.id, { adults: 2, startDate: '2027-06-10', endDate: '2027-06-11' });
    const outside = await quote(property.id, { adults: 2, startDate: '2027-06-20', endDate: '2027-06-21' });

    expect(inEvent.baseAccommodationPrice).toBe(247);
    expect(outside.baseAccommodationPrice).toBe(179);
  });

  test('a single night passes during the race, but not on a holiday bridge', async () => {
    const property = await lodgeWithRecipe('E2E devis minimum');

    const race = await quote(property.id, { adults: 2, startDate: '2027-06-10', endDate: '2027-06-11' });
    expect(race.requiredMinNights).toBe(1);
    expect(race.minNightsBreached).toBeFalsy();

    // Ascension 2027 = Thursday 6 May; the bridge locks its nights to their own length.
    const bridge = await quote(property.id, { adults: 2, startDate: '2027-05-06', endDate: '2027-05-07' });
    expect(bridge.requiredMinNights).toBe(3);
    expect(bridge.minNightsBreached).toBeTruthy();
  });

  test('the supplement follows the 15 € then 8 € tiers, and the quote carries the phrase', async () => {
    const property = await lodgeWithRecipe('E2E devis paliers');

    const one = await quote(property.id, { adults: 5, startDate: '2027-07-20', endDate: '2027-07-21' });
    const two = await quote(property.id, { adults: 5, startDate: '2027-07-20', endDate: '2027-07-22' });
    const week = await quote(property.id, { adults: 5, startDate: '2027-07-13', endDate: '2027-07-20' });

    // 3 extra guests: 15, then 15 + 8, then 15 + 6 × 8 — the spec §3.1 table.
    expect(one.extraGuestSurcharge).toBe(45);
    expect(two.extraGuestSurcharge).toBe(69);
    expect(week.extraGuestSurcharge).toBe(189);

    // The wording is server-built: no single unit price describes a tier table, so the client must
    // be handed the sentence rather than left to invent one.
    expect(one.extraGuestTiersLabel).toBe('15,00 € la 1ʳᵉ nuit, puis 8,00 €/nuit');
  });

  test('the fiche shows the phrased tier rule, not an invented unit price', async ({ page }) => {
    // The last seam: the server phrases the rule, the client renders it. Every client test mocks
    // the quote, so only here is the real `extraGuestTiersLabel` shown to a real browser.
    const property = await lodgeWithRecipe('E2E fiche paliers');
    const client = await createClient({ firstName: 'Coureur', lastName: 'Ardéchois' });
    const reservation = await createReservation({
      propertyId: property.id, clientId: client.id,
      startDate: '2027-06-08', endDate: '2027-06-11', adults: 5,
    });

    await page.goto(`/reservations/${reservation.id}`);
    const summary = page.locator('.MuiCard-root').filter({ hasText: 'Surcoût voyageurs' }).first();
    await expect(summary).toBeVisible();
    await expect(summary.getByText(/15,00 € la 1ʳᵉ nuit, puis 8,00 €\/nuit/)).toBeVisible();
    // 3 extra guests × (15 + 8 + 8) = 93 €.
    await expect(summary.getByText('93,00 €')).toBeVisible();
  });

  test('the stay is capped at 7 nights', async () => {
    const property = await lodgeWithRecipe('E2E devis plafond');
    const ok = await quote(property.id, { adults: 2, startDate: '2027-07-13', endDate: '2027-07-20' });
    const tooLong = await quote(property.id, { adults: 2, startDate: '2027-07-13', endDate: '2027-07-21' });
    expect(ok.maxNightsBreached).toBeFalsy();
    expect(tooLong.maxNightsBreached).toBeTruthy();
  });
});
