// @ts-check
// specs/per-property-default-options.md rule 11 — an option offered by default on one logement must
// not stay free after the fiche switches to a logement where it is billed.
//
// Reported on a devis: « Nouveau devis » opened on L'Estiva (Ménage offered by default), the operator
// switched to La Granja and took the Ménage — it showed « ✓ Offert » at 0 € instead of its 80 €.
import { test, expect } from '../../fixtures/test.js';
import { createProperty } from '../../fixtures/apiSeed.js';
import { FAR_YEAR } from '../../fixtures/farYear.js';

const extras = (page) => page.locator('.MuiCard-root').filter({ hasText: 'Options et ressources' }).first();
const logementSelect = (page) => page.locator('.MuiFormControl-root').filter({ hasText: 'Logement' }).first().getByRole('combobox');
const ACTIVATION_SWITCH = 'input[role="switch"]:not([aria-label="Forcer en complément"])';

test('switching logement does not carry the previous logement\'s offered default', async ({ page, request }) => {
  // Digits only (the option title stays in the server's sentence case); the worker slot and a random tail keep two runs started in
  // the same millisecond apart — they named two logements alike and the select's option became ambiguous.
  const run = `${Date.now()}${test.info().parallelIndex}${Math.floor(Math.random() * 1e4)}`;
  const billingName = `E2E offered-switch B ${run}`;
  const offering = await createProperty({ name: `E2E offered-switch A ${run}` });
  const billing = await createProperty({ name: billingName });
  // Already in the server's sentence case, so the label on screen is exactly this string.
  const title = `Ménage e2e ${run}`;
  const res = await request.post('/api/options', {
    data: {
      title,
      priceType: 'per_stay',
      price: 80,
      propertyIds: [offering.id, billing.id],
      propertyDefaults: { [offering.id]: { default: true, offered: true } },
    },
  });
  expect(res.ok()).toBeTruthy();

  await page.goto(`/reservations/new?mode=devis&propertyId=${offering.id}`);
  await expect(page.getByRole('heading', { name: 'Nouveau devis' })).toBeVisible({ timeout: 15_000 });
  await expect(extras(page).getByText(title, { exact: true })).toBeVisible();
  const card = extras(page).locator('.MuiCard-root').filter({ hasText: title }).last();
  // The offering logement selects its default on opening.
  await expect(card.locator(ACTIVATION_SWITCH)).toBeChecked();
  await logementSelect(page).click();
  await page.getByRole('option', { name: billingName, exact: true }).click();
  await expect(logementSelect(page)).toHaveText(billingName);
  // The switch empties the options only once the new logement's context, quote and occupancy are all read, after the select
  // already shows it: under a loaded parallel run, ticking before that reset lost the tick (loop sync of 2026-11-17). Wait for it.
  await expect(card.locator(ACTIVATION_SWITCH)).not.toBeChecked();
  await page.locator('input[type=date]').first().fill(`${FAR_YEAR}-11-04`);
  await page.locator('input[type=date]').nth(1).fill(`${FAR_YEAR}-11-07`);

  await card.locator(ACTIVATION_SWITCH).check();

  const summaryLine = page.getByText(title, { exact: true }).last().locator('xpath=ancestor::div[2]');
  await expect(summaryLine.getByRole('button', { name: 'Offrir' })).toBeVisible();
  await expect(summaryLine.getByText('80,00 €')).toBeVisible();
});
