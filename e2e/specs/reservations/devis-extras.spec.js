// @ts-check
// specs/devis-extras-parity-and-price-lock.md §7 — the devis fiche, against the real app + real API.
//
// This is the spec that would have caught the reported bug: the fiche opened with an EMPTY
// « Options et ressources » card, because the init path preselected a logement, deliberately cleared
// the catalogue, and then only refilled it in the branch guarded by a complete `startDate + endDate`
// pair — which « Nouveau devis » never carries. Only a real render proves it: the option list comes
// from the property payload. The round-trip test then pins rule 12 — what the operator ticks is what
// the reopened devis shows, at the same price.
//
// The URL below carries `propertyId` but NO dates: that is the same broken branch as the parameterless
// « Nouveau devis » (which resolves the logement from `properties[0]`), while keeping the fixture
// independent of whatever properties the other specs left in the shared ephemeral DB.
import { test, expect } from '@playwright/test';
import { createClient, createProperty } from '../../fixtures/apiSeed.js';

// Scope every locator to the extras card: an enabled option's title also shows in the pricing panel.
const extras = (page) => page.locator('.MuiCard-root').filter({ hasText: 'Options et ressources' }).first();
// The activation Switch of an option row. MUI renders it as `input[type=checkbox] role="switch"`, so
// `getByRole('checkbox')` does NOT match it. « Forcer en complément » is the other switch on the row —
// excluded here so « the first switch » always means « take this option ».
const ACTIVATION_SWITCH = 'input[role="switch"]:not([aria-label="Forcer en complément"])';
// A takeable option: neither an engine-driven auto-option (« Ajout automatique ») nor one forced on by
// a property default (« Inclus ») — both render their Switch disabled.
const takeableSwitch = (page) => extras(page).locator(`${ACTIVATION_SWITCH}:enabled:not(:checked)`).first();
const cardOf = (locator) => locator.locator('xpath=ancestor::*[contains(@class,"MuiCard-root")][1]');

async function openNewDevis(page, propertyId) {
  await page.goto(`/reservations/new?mode=devis&propertyId=${propertyId}`);
  await expect(page.getByRole('heading', { name: 'Nouveau devis' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Options et ressources', { exact: true })).toBeVisible();
}

test('« Nouveau devis » shows the logement\'s option catalogue right away, with no dates set', async ({ page }) => {
  const property = await createProperty({ name: 'E2E devis-extras villa' });

  await openNewDevis(page, property.id);

  // The « Options » block only renders once the catalogue actually arrived (rule 1) — it was empty.
  await expect(extras(page).getByText('Options', { exact: true })).toBeVisible();
  await expect(extras(page).locator(ACTIVATION_SWITCH)).not.toHaveCount(0);
  // The categories ride the same property payload, so they prove where the list came from.
  await expect(page.getByRole('button', { name: /^Catégorie / }).first()).toBeVisible();
});

test('a devis keeps a ticked option across save + reopen (rules 12 + 16)', async ({ page }) => {
  const property = await createProperty({ name: 'E2E devis-roundtrip villa' });
  const client = await createClient({ firstName: 'Devis', lastName: 'Parite' });

  await openNewDevis(page, property.id);

  // Dates first: a planning-card option needs a stay before it can lay its occurrences out.
  await page.locator('input[type=date]').first().fill('2099-10-04');
  await page.locator('input[type=date]').nth(1).fill('2099-10-07');

  await page.getByRole('combobox', { name: 'Rechercher un client' }).fill(client.lastName);
  await page.getByRole('option').first().click();

  // Open a category so there is always something left to take, whatever the property defaults and the
  // welcome pack already ticked in the flat list.
  await page.getByRole('button', { name: /^Catégorie / }).first().click();

  // Read the option's NAME first, then act through a title-scoped locator: taking an option moves its
  // card from the category's foldable list up to the pinned block, so a positional locator would chase
  // a different row on every re-render.
  const firstTakeable = takeableSwitch(page);
  await expect(firstTakeable).toBeVisible();
  const title = (await cardOf(firstTakeable).locator('p').first().innerText()).trim();

  const card = extras(page).locator('.MuiCard-root').filter({ hasText: title }).last();
  await card.locator(ACTIVATION_SWITCH).check();

  const total = card.getByText(/^Total/);
  await expect(total).toBeVisible();
  // The chip is born at 0 € and fills in when the server's recompute lands, so capturing it right
  // after the click would pin a transient. A catering article is never free — waiting for a non-zero
  // total both settles the race and proves the fiche actually priced the line it just took.
  await expect(total).not.toHaveText(/^Total\s*:\s*0,00/);
  const quotedTotal = (await total.innerText()).trim();

  await page.getByRole('button', { name: 'Enregistrer le devis' }).click();
  // A saved devis lands on its own edit URL (?devisId=…).
  await expect(page).toHaveURL(/devisId=\d+/, { timeout: 15_000 });

  await page.reload();
  await expect(page.getByText('Options et ressources', { exact: true })).toBeVisible({ timeout: 15_000 });

  // An enabled option is pinned outside its collapsed category, so it is directly visible again.
  const reopened = extras(page).locator('.MuiCard-root').filter({ hasText: title }).last();
  await expect(reopened.locator(ACTIVATION_SWITCH)).toBeChecked();
  await expect(reopened.getByText(/^Total/)).toHaveText(quotedTotal);
  // And the quote states how long it holds (rule 16).
  await expect(page.getByText(/Valide jusqu'au/)).toBeVisible();
});
