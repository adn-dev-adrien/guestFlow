// @ts-check
// specs/tariff-recipes/spec.md §3.2 rules 12bis-12ter — A SOLD RESERVATION NEVER MOVES.
//
// The rule the owner stated plainly: « une résa faite ne doit jamais bouger suite à un changement
// de recette tarifaire ». Options, prices, supplement — nothing.
//
// Only an end-to-end test can settle it, because the answer is spread across four layers that each
// look innocent alone: the update controller (does it merge the property's option defaults?), the
// client form (does it re-apply them on edit?), the pricing engine (does it replay the frozen
// tariff?) and the reservation model (does it keep the stored lines?). Unit tests pin each half;
// only a real save through the real API proves the whole.
import { test, expect, request as pwRequest } from '@playwright/test';
import path from 'path';
import Database from 'better-sqlite3';
import { createProperty, createClient, createReservation } from '../../fixtures/apiSeed.js';

const STORAGE_STATE = path.join(process.cwd(), 'e2e', '.auth', 'admin.json');
const DB_PATH = process.env.GUESTFLOW_E2E_DB_PATH || '/tmp/guestflow-e2e.db';
const RECIPE_ID = 'aventura-lodge-2026';

let sharedCtx;
test.beforeAll(async () => {
  sharedCtx = await pwRequest.newContext({ baseURL: 'http://localhost:3000', storageState: STORAGE_STATE });
});
test.afterAll(async () => { await sharedCtx?.dispose(); });

const api = (fn) => fn(sharedCtx);

function withDb(fn) {
  const db = new Database(DB_PATH);
  try { return fn(db); } finally { db.close(); }
}

/** A property priced by the shipped recipe, with the occupancy the recipe does not own. */
async function lodgeWithRecipe(name) {
  const property = await createProperty({ name, capacityAdults: 5 });
  await api(async (ctx) => {
    const detail = await (await ctx.get(`/api/properties/${property.id}`)).json();
    await ctx.put(`/api/properties/${property.id}`, {
      data: { ...detail, maxGuests: 5, basePriceIncludedGuests: 2, extraGuestPrice: 27, extraGuestPriceUnit: 'per_night' },
    });
    for (const rule of detail.pricingRules || []) await ctx.delete(`/api/properties/${property.id}/pricing/${rule.id}`);
    const res = await ctx.post(`/api/properties/${property.id}/tariff-recipe/apply`, { data: { recipeId: RECIPE_ID } });
    const body = await res.json();
    if (!body.applied) throw new Error(`apply failed: ${JSON.stringify(body.warnings || body)}`);
  });
  return property;
}

/**
 * A NEW tariff lands on the property after the reservation was sold: the supplement is re-priced,
 * an option becomes included in the rate, another gains free units, and its unit price moves.
 * Written straight to SQLite — this is the state a recipe apply + configure script would leave.
 */
function landANewTariff(propertyId, optionId) {
  withDb((db) => {
    db.prepare('UPDATE properties SET extraGuestPrice = 15 WHERE id = ?').run(propertyId);
    db.prepare('UPDATE pricing_rules SET extraGuestTiers = ? WHERE propertyId = ?')
      .run(JSON.stringify([{ fromNight: 1, price: 15 }, { fromNight: 2, price: 8 }]), propertyId);
    db.prepare('INSERT OR REPLACE INTO property_option_prices (propertyId, optionId, price, freeUnits) VALUES (?, ?, ?, ?)')
      .run(propertyId, optionId, 99, 2);
    // …and the option becomes a property default marked « offered », the case that would turn a
    // billed line into « Comprise » at 0 € on an old reservation.
    db.prepare('INSERT OR REPLACE INTO property_option_defaults (propertyId, optionId, offered) VALUES (?, ?, 1)')
      .run(propertyId, optionId);
  });
}

/** Billable options the seeded catering catalogue links to every property. */
function linkedOptions(propertyId, limit = 1) {
  return withDb((db) => db.prepare(`
    SELECT o.id, o.title, COALESCE(pop.price, o.price) AS price
    FROM options o
    JOIN property_options po ON po.optionId = o.id AND po.propertyId = ?
    LEFT JOIN property_option_prices pop ON pop.optionId = o.id AND pop.propertyId = ?
    WHERE o.archivedAt IS NULL AND COALESCE(o.displayToClient, 1) != 0 AND o.price > 0
    ORDER BY o.id LIMIT ?
  `).all(propertyId, propertyId, limit));
}
const anyLinkedOption = (propertyId) => linkedOptions(propertyId, 1)[0];

/** What the configure script does: mark an option as a property default, offered or billed. */
function makeDefaultOption(propertyId, optionId, offered) {
  withDb((db) => db.prepare(
    'INSERT OR REPLACE INTO property_option_defaults (propertyId, optionId, offered) VALUES (?, ?, ?)',
  ).run(propertyId, optionId, offered ? 1 : 0));
}

const financeOf = (r) => ({
  finalPrice: r.finalPrice,
  totalPrice: r.totalPrice,
  options: (r.options || []).map((o) => ({ optionId: o.optionId, unitPrice: o.unitPrice, totalPrice: o.totalPrice, offered: o.offered })).sort((a, b) => a.optionId - b.optionId),
});

test.describe('a sold reservation never moves', () => {
  test('a new tariff changes nothing on a reservation already in the database', async () => {
    const property = await lodgeWithRecipe('E2E résa figée');
    const client = await createClient({ firstName: 'Ancien', lastName: 'Client' });
    const option = anyLinkedOption(property.id);
    expect(option, 'the seeded catalogue links a billable option').toBeTruthy();

    // Sold under the OLD tariff: 5 guests (3 above the base) and one billed option.
    const reservation = await createReservation({
      propertyId: property.id, clientId: client.id,
      startDate: '2027-09-10', endDate: '2027-09-12', adults: 5,
    });
    const seeded = await api((ctx) => ctx.get(`/api/reservations/${reservation.id}`).then((r) => r.json()));
    const attach = await api((ctx) => ctx.put(`/api/reservations/${reservation.id}`, {
      data: {
        ...seeded, adults: 5,
        options: [{ optionId: option.id, quantity: 1 }],
        customOptions: [], resources: [],
      },
    }));
    expect(attach.ok(), await attach.text()).toBeTruthy();
    const sold = await api((ctx) => ctx.get(`/api/reservations/${reservation.id}`).then((r) => r.json()));
    const before = financeOf(sold);
    expect(before.options.length, 'the reservation carries its option').toBeGreaterThan(0);

    landANewTariff(property.id, option.id);

    // The operator re-opens and saves it — a note edit, the most innocent act there is.
    const saved = await api((ctx) => ctx.put(`/api/reservations/${reservation.id}`, {
      data: {
        ...sold,
        notes: 'Rappel : arrivée tardive',
        options: (sold.options || []).map((o) => ({ optionId: o.optionId, quantity: o.quantity })),
        customOptions: [], resources: [],
      },
    }));
    expect(saved.ok(), await saved.text()).toBeTruthy();

    const after = financeOf(await api((ctx) => ctx.get(`/api/reservations/${reservation.id}`).then((r) => r.json())));
    expect(after, 'not one amount, not one line, may have moved').toEqual(before);
  });

  test('saving an old reservation does not graft the new default options onto it', async () => {
    // The fear stated plainly: « les résas existantes prennent les nouvelles options ». The default
    // merge exists in the CREATE path only, and the form deliberately skips it on edit — this pins
    // both halves at once, through a real save.
    const property = await lodgeWithRecipe('E2E pas de greffe');
    const client = await createClient({ firstName: 'Sans', lastName: 'Options' });
    const reservation = await createReservation({
      propertyId: property.id, clientId: client.id,
      startDate: '2027-09-20', endDate: '2027-09-22', adults: 2,
    });
    const sold = await api((ctx) => ctx.get(`/api/reservations/${reservation.id}`).then((r) => r.json()));
    const optionCountBefore = (sold.options || []).length;

    const option = anyLinkedOption(property.id);
    landANewTariff(property.id, option.id); // the option becomes a default « offered »

    await api((ctx) => ctx.put(`/api/reservations/${reservation.id}`, {
      data: { ...sold, notes: 'sauvegarde anodine', options: [], customOptions: [], resources: [] },
    }));

    const after = await api((ctx) => ctx.get(`/api/reservations/${reservation.id}`).then((r) => r.json()));
    expect((after.options || []).length, 'no option was grafted on by the save').toBe(optionCountBefore);
    expect(after.finalPrice).toBe(sold.finalPrice);
  });

  test('a reservation created AFTER the new recipe carries its new options, offered AND billed', async () => {
    // The symmetric half, and the one that matters just as much: the freeze protects the past, it
    // must not petrify the future. A booking taken after the recipe lands has to receive everything
    // the recipe brought — the supplement AND the options it turned into property defaults, whether
    // those are « comprises dans le tarif » (billed 0) or simply pre-selected and billed.
    const property = await lodgeWithRecipe('E2E nouvelle résa');
    const client = await createClient({ firstName: 'Nouveau', lastName: 'Client' });
    const [comprise, billed] = linkedOptions(property.id, 2);
    expect(billed, 'the catalogue offers two billable options').toBeTruthy();

    landANewTariff(property.id, comprise.id);          // new tiers on the supplement
    makeDefaultOption(property.id, comprise.id, true);  // « comprise dans le tarif »
    makeDefaultOption(property.id, billed.id, false);   // pre-selected, still billed

    const fresh = await createReservation({
      propertyId: property.id, clientId: client.id,
      startDate: '2027-09-10', endDate: '2027-09-12', adults: 5,
    });
    const detail = await api((ctx) => ctx.get(`/api/reservations/${fresh.id}`).then((r) => r.json()));
    const lines = Object.fromEntries((detail.options || []).map((o) => [o.optionId, o]));

    // Both defaults landed on the reservation without anyone ticking them.
    expect(lines[comprise.id], 'the offered default is on the reservation').toBeTruthy();
    expect(lines[billed.id], 'the billed default is on it too').toBeTruthy();

    // The offered one bills 0 while keeping the price it is worth; the other bills normally.
    expect(lines[comprise.id].offered).toBe(1);
    expect(lines[comprise.id].totalPrice).toBe(0);
    expect(lines[comprise.id].unitPrice).toBeGreaterThan(0);
    expect(lines[billed.id].offered).toBe(0);
    expect(lines[billed.id].totalPrice).toBeGreaterThan(0);

    // …and the supplement follows the NEW tiers: 3 extra guests × (15 + 8) = 69 €.
    const optionsTotal = (detail.options || []).reduce((sum, o) => sum + Number(o.totalPrice || 0), 0);
    expect(detail.finalPrice - detail.totalPrice - optionsTotal).toBe(69);
  });
});
