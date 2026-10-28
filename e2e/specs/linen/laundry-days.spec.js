// @ts-check
// specs/linen-laundry-days.md §7.3 — Tuesday + Thursday with a two-day turnaround, end to end: the Linge
// page edits and saves the schedule (refusals shown before Save), the Planning then draws a card on both
// laundry days, the Thursday one telling where its pick-up comes from. One run at 390 px.
import { test, expect } from '@playwright/test';
import { createClient, createProperty, createReservation } from '../../fixtures/apiSeed.js';
import { seedBedLinenOption, removeBedLinenOption } from '../../fixtures/dbSeed.js';

const isoOf = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const inDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d; };

// The first Tuesday from four days on: the new schedule starts tomorrow, and a stay may not begin in the past.
function nextTuesdayFromFourDays() {
  const d = inDays(4);
  while (d.getDay() !== 2) d.setDate(d.getDate() + 1);
  return d;
}
const plusDays = (date, n) => { const d = new Date(date); d.setDate(d.getDate() + n); return d; };

async function restoreTuesdayOnly(request) {
  const res = await request.put('/api/laundry/schedule', { data: { weekdays: [2], turnaroundDays: 1 } });
  expect(res.ok()).toBeTruthy();
}

test.describe.configure({ mode: 'serial' });

test.afterEach(async ({ request }) => { await restoreTuesdayOnly(request); });

test('Linge page — Tuesday + Thursday, turnaround 2: refusals before Save, then saved with its start date', async ({ page }) => {
  await page.goto('/parametres/stock-blanchisserie');
  await expect(page.getByRole('heading', { name: 'Linge', exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Blanchisserie', { exact: true })).toBeVisible();

  const tuesday = page.getByRole('button', { name: 'Mardi' });
  const thursday = page.getByRole('button', { name: 'Jeudi' });
  await expect(tuesday).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Enregistrer' })).toBeDisabled();

  // The last day cannot be unticked: it stays ticked and says why.
  await tuesday.click();
  await expect(tuesday).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Au moins un jour.')).toBeVisible();

  // The stepper stops at 1; a typed value out of range is refused and blocks Save.
  await expect(page.getByRole('button', { name: 'Un jour de moins' })).toBeDisabled();
  await page.getByLabel('Délai en jours').fill('15');
  await expect(page.getByText('Entre 1 et 14 jours.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Enregistrer' })).toBeDisabled();

  await thursday.click();
  await page.getByLabel('Délai en jours').fill('2');
  await expect(page.getByText('Entre 1 et 14 jours.')).toBeHidden();
  // The cycle is the server's: Tuesday → Thursday in 2 days, Thursday → Tuesday in 5.
  const cycle = page.getByTestId('laundry-cycle');
  await expect(cycle).toContainText('Mar. → jeu.');
  await expect(cycle).toContainText('Jeu. → mar.');
  await expect(page.getByText(/^À partir de demain, /)).toBeVisible();

  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByText(/aujourd’hui : mardi/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Enregistrer' })).toBeDisabled();

  await page.reload();
  await expect(page.getByRole('button', { name: 'Jeudi' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Délai en jours')).toHaveValue('2');
  await expect(page.getByText(/aujourd’hui : mardi/)).toBeVisible();

  // Cancel puts the saved schedule back.
  await page.getByRole('button', { name: 'Un jour de plus' }).click();
  await expect(page.getByLabel('Délai en jours')).toHaveValue('3');
  await page.getByRole('button', { name: 'Annuler' }).click();
  await expect(page.getByLabel('Délai en jours')).toHaveValue('2');
});

test('Planning — a card on both laundry days, the Thursday one says where its pick-up comes from', async ({ page, request }) => {
  const tuesday = nextTuesdayFromFourDays();
  const thursday = plusDays(tuesday, 2);
  const client = await createClient({ firstName: 'Linge', lastName: 'Blanchisserie' });
  const property = await createProperty({ name: 'Gîte du linge (E2E)', singleBeds: 2, doubleBeds: 1 });
  const stayA = await createReservation({
    propertyId: property.id, clientId: client.id, startDate: isoOf(plusDays(tuesday, -2)), endDate: isoOf(tuesday), singleBeds: 2,
  });
  const stayB = await createReservation({
    propertyId: property.id, clientId: client.id, startDate: isoOf(tuesday), endDate: isoOf(thursday), singleBeds: 1,
  });
  const optionId = seedBedLinenOption([{ id: stayA.id, singleBeds: 2 }, { id: stayB.id, singleBeds: 1 }]);
  try {
    const saved = await request.put('/api/laundry/schedule', { data: { weekdays: [2, 4], turnaroundDays: 2 } });
    expect(saved.ok()).toBeTruthy();

    // The same answer the page draws from.
    const days = (await (await request.get(`/api/planning/laundry/days?from=${isoOf(tuesday)}&to=${isoOf(thursday)}`)).json()).days;
    expect(days[isoOf(tuesday)].dropOff.singleBeds).toBe(2);
    expect(days[isoOf(thursday)].pickUp.fromTrips).toEqual([isoOf(tuesday)]);

    await page.goto('/planning');
    await expect(page.getByRole('heading', { name: 'Planning', exact: true })).toBeVisible({ timeout: 10_000 });
    const cards = page.getByText('Linge à la blanchisserie', { exact: true });
    // Tuesday and Thursday, plus the following Tuesday that collects the Thursday drop.
    await expect.poll(() => cards.count(), { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
    await expect(page.getByText(/À récupérer · déposé mar\. \d+/)).toBeVisible();
  } finally {
    removeBedLinenOption(optionId);
    await request.delete(`/api/reservations/${stayA.id}`);
    await request.delete(`/api/reservations/${stayB.id}`);
  }
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('Linge page at 390 px — touch-sized toggles, no horizontal scroll, the schedule saved', async ({ page }) => {
    await page.goto('/parametres/stock-blanchisserie');
    await expect(page.getByText('Blanchisserie', { exact: true })).toBeVisible();
    const buttons = page.getByRole('group', { name: 'Jours' }).getByRole('button');
    await expect(buttons).toHaveCount(7);
    for (let i = 0; i < 7; i += 1) {
      const box = await buttons.nth(i).boundingBox();
      expect(box && box.width).toBeGreaterThanOrEqual(40);
      expect(box && box.height).toBeGreaterThanOrEqual(44);
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    await page.getByRole('button', { name: 'Jeudi' }).click();
    await page.getByRole('button', { name: 'Un jour de plus' }).click();
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByText(/aujourd’hui : mardi/)).toBeVisible();
  });
});
