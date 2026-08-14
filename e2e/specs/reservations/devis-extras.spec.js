// @ts-check
// specs/devis-extras-parity-and-price-lock.md §7 — the devis fiche, against the real app + real API.
//
// This is the spec that would have caught the reported bug: « Nouveau devis » opened a fiche whose
// « Options et ressources » card was empty, because the blank init path deliberately cleared the
// catalogue and no branch ever refilled it. Only a real render proves it — the option list comes from
// the property payload, and the entry point (a URL with no propertyId and no dates) is the whole
// point. The round-trip test then pins rules 6-12: what the operator ticks is what the reopened devis
// shows, planning-card occurrences included.
import { test, expect } from '@playwright/test';
import { createClient } from '../../fixtures/apiSeed.js';

// Scope every locator to the extras card: an enabled option's title also shows in the pricing panel.
const extras = (page) => page.locator('.MuiCard-root').filter({ hasText: 'Options et ressources' }).first();
const optionCard = (page, title) => extras(page).locator('.MuiCard-root').filter({ hasText: title }).last();

async function openNewDevis(page) {
  await page.goto('/reservations/new?mode=devis');
  await expect(page.getByText('Nouveau devis')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Options et ressources', { exact: true })).toBeVisible();
}

test('« Nouveau devis » shows the preselected logement\'s option catalogue right away', async ({ page }) => {
  await openNewDevis(page);

  // The « Options » block only renders when the catalogue actually arrived (rule 1).
  await expect(extras(page).getByText('Options', { exact: true })).toBeVisible();
  // At least one catalogue option card, with its activation Switch.
  await expect(extras(page).getByRole('checkbox').first()).toBeVisible();
  // The server-computed categories are there too — same payload as a reservation fiche.
  await expect(page.getByRole('button', { name: /Catégorie / })).toBeVisible();
});

test('a devis keeps its options across save + reopen (rules 6-12)', async ({ page }) => {
  const client = await createClient({ firstName: 'Devis', lastName: 'Parité' });

  await openNewDevis(page);

  // Dates first: a planning-card option needs a stay to lay its occurrences out.
  await page.getByLabel("Date d'arrivée").fill('2099-10-04');
  await page.getByLabel('Date de départ').fill('2099-10-07');

  await page.getByLabel('Rechercher un client').fill('Parité');
  await page.getByRole('option').first().click();

  // Tick the first catalogue option and read back the total the fiche computes for it.
  const firstOption = extras(page).locator('.MuiCard-root').first();
  const optionTitle = (await firstOption.locator('p').first().innerText()).trim();
  await firstOption.getByRole('checkbox').first().check();
  const totalChip = optionCard(page, optionTitle).getByText(/^Total/);
  await expect(totalChip).toBeVisible();
  const quotedTotal = (await totalChip.innerText()).trim();

  await page.getByRole('button', { name: 'Enregistrer le devis' }).click();
  // A saved devis lands on its own edit URL (?devisId=…).
  await expect(page).toHaveURL(/devisId=\d+/, { timeout: 15_000 });

  await page.reload();
  await expect(page.getByText('Options et ressources', { exact: true })).toBeVisible({ timeout: 10_000 });

  // Same option, still ticked, same money — nothing was dropped by the save/reload round trip.
  const reopened = optionCard(page, optionTitle);
  await expect(reopened.getByRole('checkbox').first()).toBeChecked();
  await expect(reopened.getByText(/^Total/)).toHaveText(quotedTotal);
  // And the quote states how long it holds (rule 16).
  await expect(page.getByText(/Valide jusqu'au/)).toBeVisible();
});
