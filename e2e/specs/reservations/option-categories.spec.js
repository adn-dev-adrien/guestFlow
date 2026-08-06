// @ts-check
// specs/option-categories.md §7 — the collapsible option categories, rendered by the real app
// against the real API.
//
// Unit tests can't prove this: the sections depend on the server's `optionGroups` payload, and the
// rule that matters (an enabled option stays visible while its category is collapsed) is only
// meaningful across a save + reload. The « Boissons » and « Restauration » catalogues come from the
// boot seed (server/src/utils/cateringSeed.js), so nothing extra needs seeding here.
import { test, expect, request as pwRequest } from '@playwright/test';
import path from 'path';
import { createClient, createProperty, createReservation } from '../../fixtures/apiSeed.js';

const STORAGE_STATE = path.join(process.cwd(), 'e2e', '.auth', 'admin.json');

/**
 * Attach the breakfast option to a property. The catering seed links its own articles to every
 * property, but « Petit déjeuner » predates it and carries no link — on a property created by this
 * spec it would simply be absent, and rule 9bis would have nothing to prove.
 */
async function linkBreakfastOption(propertyId) {
  const ctx = await pwRequest.newContext({ baseURL: 'http://localhost:3000', storageState: STORAGE_STATE });
  try {
    const list = await (await ctx.get('/api/options')).json();
    const ids = list.filter((o) => (o.propertyIds || []).includes(propertyId)).map((o) => o.id);
    const breakfast = list.find((o) => o.autoOptionType === 'breakfast');
    if (breakfast && !ids.includes(breakfast.id)) ids.push(breakfast.id);
    const res = await ctx.put(`/api/properties/${propertyId}/options`, { data: { optionIds: ids } });
    if (!res.ok()) throw new Error(`linkBreakfastOption failed: ${res.status()} ${await res.text()}`);
  } finally {
    await ctx.dispose();
  }
}

const BOISSONS = /Catégorie Boissons/;
const RESTAURATION = /Catégorie Restauration/;

// Every locator is scoped to the « Options et ressources » card: an enabled option's title also
// appears in the pricing side panel, so a page-wide getByText would match twice.
const extras = (page) => page.locator('.MuiCard-root').filter({ hasText: 'Options et ressources' }).first();
// `.last()` = the innermost matching card (ancestors come first in document order).
const optionCard = (page, title) => extras(page).locator('.MuiCard-root').filter({ hasText: title }).last();

async function openFiche(page, { withBreakfast = false } = {}) {
  const property = await createProperty({ name: 'E2E option-categories villa' });
  if (withBreakfast) await linkBreakfastOption(property.id);
  const client = await createClient({ firstName: 'Test', lastName: 'OptionCategories' });
  const reservation = await createReservation({
    propertyId: property.id,
    clientId: client.id,
    // Far-future window so the date range never collides with another spec's seed.
    startDate: '2099-11-04',
    endDate: '2099-11-07',
    adults: 2,
  });
  // `?from=` mirrors how the app links to a fiche, and gives the post-save `navigate(from)` a real
  // destination — without it the save does `navigate(-1)`, which lands on about:blank here.
  await page.goto(`/reservations/${reservation.id}?from=${encodeURIComponent('/reservations')}`);
  await expect(page.getByText('Options et ressources', { exact: true })).toBeVisible({ timeout: 10_000 });
  return reservation;
}

test('categories render collapsed, after the flat options and before the custom lines', async ({ page }) => {
  await openFiche(page);

  const boissons = page.getByRole('button', { name: BOISSONS });
  await expect(boissons).toBeVisible();
  await expect(boissons).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('button', { name: RESTAURATION })).toBeVisible();

  // Collapsed → the articles themselves are not in the DOM.
  await expect(extras(page).getByText('Champagne - bouteille 75cl')).toHaveCount(0);
  await expect(extras(page).getByText('Planche S — 1-2 pers. (Apéro Solo/Duo)')).toHaveCount(0);

  // Placement: the category headers sit between the « Options » heading and « Options personnalisées ».
  const order = await page.evaluate(() => {
    const texts = [...document.querySelectorAll('body *')]
      .filter((el) => el.children.length === 0 && el.textContent)
      .map((el) => el.textContent.trim());
    return {
      options: texts.indexOf('Options'),
      boissons: texts.indexOf('Boissons'),
      custom: texts.indexOf('Options personnalisées'),
    };
  });
  expect(order.options).toBeGreaterThanOrEqual(0);
  expect(order.boissons).toBeGreaterThan(order.options);
  expect(order.custom).toBeGreaterThan(order.boissons);
});

test('expanding a category reveals its articles and flips aria-expanded', async ({ page }) => {
  await openFiche(page);
  const boissons = page.getByRole('button', { name: BOISSONS });

  await boissons.click();
  await expect(boissons).toHaveAttribute('aria-expanded', 'true');
  await expect(extras(page).getByText('Champagne - bouteille 75cl')).toBeVisible();
  await expect(extras(page).getByText('Jus de pomme 1L')).toBeVisible();
  // The sibling category is unaffected.
  await expect(page.getByRole('button', { name: RESTAURATION })).toHaveAttribute('aria-expanded', 'false');

  await boissons.click();
  await expect(boissons).toHaveAttribute('aria-expanded', 'false');
});

test('enabled articles stay pinned and visible after a save + reload, section still collapsed', async ({ page }) => {
  // THE behaviour this feature exists for (spec §3 rule 9). A collapsed category must never hide a
  // line the guest is billed for.
  const reservation = await openFiche(page);

  await page.getByRole('button', { name: BOISSONS }).click();
  // An off option card carries exactly one switch — the activation one (the « Compl. » switch only
  // appears once it's on).
  await optionCard(page, 'Champagne - bouteille 75cl').getByRole('switch').first().check();
  await optionCard(page, 'Jus de pomme 1L').getByRole('switch').first().check();

  // Saving leaves the fiche, so wait on the write itself rather than on a still-mounted element.
  const saved = page.waitForResponse((r) => r.request().method() === 'PUT'
    && r.url().includes(`/api/reservations/${reservation.id}`)
    && r.ok());
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await saved;
  // Let the app's own post-save redirect land first, or it interrupts our navigation.
  await page.waitForURL('**/reservations');

  await page.goto(`/reservations/${reservation.id}`);
  await expect(page.getByText('Options et ressources', { exact: true })).toBeVisible({ timeout: 10_000 });

  // Collapsed again on load…
  const boissons = page.getByRole('button', { name: /Catégorie Boissons, 2 options sélectionnées/ });
  await expect(boissons).toHaveAttribute('aria-expanded', 'false');
  // …yet the two picked articles are visible, pinned above the fold.
  await expect(extras(page).getByText('Champagne - bouteille 75cl')).toBeVisible();
  await expect(extras(page).getByText('Jus de pomme 1L')).toBeVisible();
  // …and the untouched ones are still folded away.
  await expect(extras(page).getByText('Mad Max 75cl - 5,5°')).toHaveCount(0);
  await expect(extras(page).getByText(/Voir les \d+ autres/)).toBeVisible();
});

test('a category with nothing enabled and nothing pinned shows no article card at all', async ({ page }) => {
  await openFiche(page);
  await expect(page.getByRole('button', { name: RESTAURATION })).toBeVisible();
  await expect(extras(page).getByText('Planche XXL — 10-12 pers. (Apéro Gîte)')).toHaveCount(0);
  await expect(extras(page).getByText(/Voir les \d+ options/).first()).toBeVisible();
});

test('« Petit déjeuner » stays visible under Restauration without being selected', async ({ page }) => {
  // specs/option-categories.md §3 rule 9bis: the breakfast option is pinned, so a service offered
  // on every stay never hides behind a fold.
  await openFiche(page, { withBreakfast: true });

  const restauration = page.getByRole('button', { name: RESTAURATION });
  await expect(restauration).toHaveAttribute('aria-expanded', 'false');
  // Visible although the category is collapsed and nothing is ticked…
  await expect(extras(page).getByText('Petit déjeuner')).toBeVisible();
  // …and it does not count as a selection: no chip on the header.
  await expect(page.getByRole('button', { name: /Catégorie Restauration, \d+ option/ })).toHaveCount(0);
  // Its own switch is off.
  await expect(optionCard(page, 'Petit déjeuner').getByRole('switch').first()).not.toBeChecked();
});

test('mobile: the header is a ≥44px tap target and the page never scrolls sideways', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openFiche(page);

  const boissons = page.getByRole('button', { name: BOISSONS });
  const box = await boissons.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);

  await boissons.click();
  await expect(boissons).toHaveAttribute('aria-expanded', 'true');

  const overflows = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflows).toBe(false);
});
