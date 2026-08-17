// @ts-check
// specs/hourly-resource-quantity-and-sas-scheduling.md §7 — the reported bug, against the real app.
//
// Enabling the « Bain nordique » on a devis showed the resource card but added NOTHING: no line in
// the pricing panel and no change to the total. Two defects had to line up for that, and only a real
// render catches either of them:
//
//   1. the engine dropped an hourly-scheduled resource that had no session scheduled — and the fiche's
//      Switch only sets a quantity, it seeds no session;
//   2. the « Ressources » block never rendered at all on a blank « Nouveau devis », because
//      `GET /api/properties/:id` did not carry the resources the fiche reads.
//
// Unit tests pin the engine; this pins what the operator actually sees.
import { test, expect } from '@playwright/test';
import { createProperty, createHourlyResource } from '../../fixtures/apiSeed.js';

const extras = (page) => page.locator('.MuiCard-root').filter({ hasText: 'Options et ressources' }).first();
const summary = (page) => page.locator('.MuiCard-root').filter({ hasText: 'Résumé tarifaire' }).first();
// MUI renders a Switch as `input[type=checkbox] role="switch"`, so getByRole('checkbox') misses it.
const ACTIVATION_SWITCH = 'input[role="switch"]:not([aria-label="Forcer en complément"])';

async function totalOf(page) {
  const text = await summary(page).getByText(/Total du séjour/).locator('xpath=..').innerText();
  const match = text.replace(/\s/g, ' ').match(/Total du séjour\s*([\d\s,.]+)\s*€/);
  return Number((match?.[1] || '0').replace(/\s/g, '').replace(',', '.'));
}

test('an hourly resource enabled on a devis lands in the summary AND in the total', async ({ page }) => {
  const property = await createProperty({ name: 'E2E bain villa' });
  const resource = await createHourlyResource({ name: 'Bain nordique E2E', propertyIds: [property.id] });

  await page.goto(`/reservations/new?mode=devis&propertyId=${property.id}`);
  await expect(page.getByRole('heading', { name: 'Nouveau devis' })).toBeVisible({ timeout: 15_000 });

  // Defect 2: the « Ressources » block has to be there with NO dates set — the catalogue rides the
  // property payload, not the availability endpoint.
  await expect(extras(page).getByText('Ressources', { exact: true })).toBeVisible();
  const card = extras(page).locator('.MuiCard-root').filter({ hasText: resource.name }).first();
  await expect(card).toBeVisible();

  await page.locator('input[type=date]').first().fill('2099-10-04');
  await page.locator('input[type=date]').nth(1).fill('2099-10-07');
  await expect(summary(page).getByText(/Total du séjour/)).toBeVisible();
  // Read the baseline only once the quote has actually landed. Reading it eagerly caught the label
  // with no amount behind it yet, and the delta below then compared against 0.
  let before = 0;
  await expect.poll(async () => { before = await totalOf(page); return before; }).toBeGreaterThan(0);

  // Defect 1: switching it on, without touching the session editor, must bill the hour.
  await card.locator(ACTIVATION_SWITCH).first().check();

  await expect(summary(page).getByText(resource.name)).toBeVisible({ timeout: 10_000 });
  // Sold, not yet placed on a slot — the arrival SAS is where that happens.
  await expect(summary(page).getByText('à planifier')).toBeVisible();
  await expect.poll(() => totalOf(page)).toBe(before + 30);

  // The hours are the sale unit, so the field has to be editable right there.
  await expect(card.getByLabel(/Heures/i)).toBeVisible();
});
