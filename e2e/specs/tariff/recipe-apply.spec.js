// @ts-check
// specs/tariff-recipes/spec.md §3.2 · specs/tariff-events-and-extra-guest-tiers/spec.md §3.3
//
// Applying a tariff recipe, through the real app against the real API.
//
// Unit tests cannot prove this: they mock the API on the client side and hand-build the recipe on
// the server side, so the two halves are never joined. What only a full round trip shows is that
// the diff the server computes is the diff the dialog renders, that confirming it writes seasons a
// reload can read back, and that the ranges survive the JSON column — the exact seam where
// `eventKey` was silently dropped once already.
import { test, expect, request as pwRequest } from '@playwright/test';
import path from 'path';
import { createProperty } from '../../fixtures/apiSeed.js';

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
 * A property created through the API carries an automatic « Tarif annuel » season built from its
 * basePrice — and that season is MANUAL, so the recipe refuses to overwrite it (rule 9). Removing
 * it is what the operator does before a first apply; `blockedApply` below covers the other branch.
 */
async function bareProperty(name) {
  const property = await createProperty({ name });
  await api(async (ctx) => {
    const detail = await (await ctx.get(`/api/properties/${property.id}`)).json();
    for (const rule of detail.pricingRules || []) {
      const res = await ctx.delete(`/api/properties/${property.id}/pricing/${rule.id}`);
      if (!res.ok()) throw new Error(`cleanup failed: ${res.status()}`);
    }
  });
  return property;
}

async function applyRecipe(propertyId) {
  return api(async (ctx) => {
    const res = await ctx.post(`/api/properties/${propertyId}/tariff-recipe/apply`, { data: { recipeId: RECIPE_ID } });
    const body = await res.json();
    // Never fire-and-forget: a silently blocked apply would make every later assertion lie.
    if (!res.ok() || !body.applied) throw new Error(`apply failed (${res.status()}): ${JSON.stringify(body.warnings || body)}`);
    return body;
  });
}

// The seasons TABLE, not the card: a season label also appears in the calendar tooltips and in the
// « appliquer à un autre logement » dialog, so a card-wide match is ambiguous.
const seasonsTable = (page) => page.getByRole('table').first();

test.describe('recette tarifaire', () => {
  test("appliquer depuis l'aperçu écrit les saisons, et rien avant la confirmation", async ({ page }) => {
    const property = await bareProperty('E2E recette lodge');

    await page.goto(`/properties/${property.id}/pricing-seasons`);
    await expect(page.getByText('Gestion tarifaire')).toBeVisible();

    await page.getByLabel('Recette').click();
    await page.getByRole('option', { name: /Aventura Lodge/ }).click();
    await page.getByText('Appliquer la recette…').click();
    await expect(page.getByText('Aperçu des modifications')).toBeVisible();
    await expect(page.getByText('sera créée').first()).toBeVisible();

    // The preview is a preview: the server must still hold nothing.
    const beforeApply = await api((ctx) => ctx.get(`/api/properties/${property.id}`).then((r) => r.json()));
    expect(beforeApply.pricingRules || []).toHaveLength(0);

    await page.getByRole('button', { name: 'Appliquer', exact: true }).click();

    for (const label of ['Basse saison', 'Moyenne saison', 'Haute saison']) {
      await expect(seasonsTable(page).getByRole('row').filter({ hasText: label })).toHaveCount(1);
    }
    await expect(seasonsTable(page).getByText('recette · high')).toBeVisible();
  });

  test("l'événement survit à l'aller-retour serveur et est nommé dans le tableau", async ({ page }) => {
    const property = await bareProperty('E2E recette événement');
    await applyRecipe(property.id);

    const detail = await api((ctx) => ctx.get(`/api/properties/${property.id}`).then((r) => r.json()));
    const high = (detail.pricingRules || []).find((r) => r.seasonKey === 'high');
    expect(high, 'the high season was written').toBeTruthy();
    const eventRanges = (high.dateRanges || []).filter((r) => r.eventKey === 'ardechoise');
    expect(eventRanges.length).toBeGreaterThan(0);
    expect(eventRanges[0].eventLabel).toBe("L'Ardéchoise");
    // The range carries NO minNights override: the event asks for 1, the season default is already
    // 1, and the write path drops a per-range value that merely restates the default. The effective
    // minimum is still 1 — asserted on the season, which is where it now lives.
    expect(eventRanges[0].minNights).toBeUndefined();
    expect(high.minNights).toBe(1);

    await page.goto(`/properties/${property.id}/pricing-seasons`);
    await expect(seasonsTable(page).getByText("L'Ardéchoise").first()).toBeVisible();
  });

  test('la grille plateformes affiche les deux paliers de personne supplémentaire', async ({ page }) => {
    const property = await bareProperty('E2E recette paliers');
    await applyRecipe(property.id);

    await page.goto(`/properties/${property.id}/pricing-seasons`);
    const grid = page.locator('.MuiCard-root').filter({ hasText: 'Prix plateformes' }).first();
    await expect(grid).toBeVisible();
    // « 15 € puis 8 € » — one number could never describe a tier table.
    await expect(grid.getByText(/puis \d+ €/).first()).toBeVisible();
  });

  test('réappliquer une recette inchangée ne propose aucune modification', async ({ page }) => {
    const property = await bareProperty('E2E recette idempotente');
    await applyRecipe(property.id);

    // Idempotency has a unit test, but only the real endpoint proves the OPERATOR sees « nothing to
    // do » — the reassurance that re-running the yearly pass is safe.
    const preview = await api((ctx) => ctx
      .get(`/api/properties/${property.id}/tariff-recipe/preview?recipeId=${RECIPE_ID}`)
      .then((r) => r.json()));
    const moved = (preview.seasons || []).filter((s) => s.action !== 'unchanged');
    expect(moved, `seasons reported as changed: ${moved.map((s) => s.seasonKey).join(', ')}`).toHaveLength(0);
    expect(preview.blocking).toBeFalsy();

    await page.goto(`/properties/${property.id}/pricing-seasons`);
    await page.getByText('Appliquer la recette…').click();
    await expect(page.getByText('Aperçu des modifications')).toBeVisible();
    await expect(page.getByText('sera créée')).toHaveCount(0);
    await expect(page.getByText('sera supprimée')).toHaveCount(0);
  });

  test('une saison manuelle bloque la recette et le conflit est nommé', async ({ page }) => {
    // The safety rule that matters most in production: hand-painted work is never silently
    // overwritten. A property created through the API keeps its automatic « Tarif annuel » season,
    // which is manual — so this is the real-world first-apply case, not a contrived one.
    const property = await createProperty({ name: 'E2E recette bloquée' });

    const { status, body } = await api(async (ctx) => {
      const res = await ctx.post(`/api/properties/${property.id}/tariff-recipe/apply`, { data: { recipeId: RECIPE_ID } });
      return { status: res.status(), body: await res.json() };
    });
    expect(status).toBe(409);
    expect(body.applied).toBeFalsy();
    expect(body.conflicts.length).toBeGreaterThan(0);
    expect(body.conflicts[0].blockedByLabel).toBeTruthy();

    // Nothing was written despite the partial work the diff describes.
    const detail = await api((ctx) => ctx.get(`/api/properties/${property.id}`).then((r) => r.json()));
    expect((detail.pricingRules || []).filter((r) => r.seasonKey)).toHaveLength(0);

    await page.goto(`/properties/${property.id}/pricing-seasons`);
    await page.getByLabel('Recette').click();
    await page.getByRole('option', { name: /Aventura Lodge/ }).click();
    await page.getByText('Appliquer la recette…').click();
    // The dialog shows the STRUCTURED conflict panel — which period, and which season blocks it —
    // and deliberately suppresses the raw « chevauche » warnings so the same fact is not said twice.
    await expect(page.getByText(/ne peut pas être écrite/)).toBeVisible();
    await expect(page.getByText(/bloquée par « Tarif annuel »/).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Appliquer', exact: true })).toBeDisabled();
  });
});
