// @ts-check
// specs/reconciliation-assisted-matching.md rules 11–13 — the page's counters filter the list, « Tout confirmer »
// confirms the shown proposals in one batch. Credits are loaded into the plugin's table: no Qonto call.
import { test, expect } from '@playwright/test';
import { createClient, createProperty, createReservation } from '../../fixtures/apiSeed.js';
import { seedBankCredits, setReservationAmounts } from '../../fixtures/dbSeed.js';

const RUN = Date.now();

test('a counter filters, « Tout confirmer » writes the count the dialog announced', async ({ page, request }) => {
  const property = await createProperty({ name: 'E2E tout confirmer villa' });
  const ids = [];
  for (const [i, name] of ['Alpha', 'Bravo'].entries()) {
    const client = await createClient({ firstName: 'Cam', lastName: `Tout${name}`, email: `cam${i}@example.com` });
    const resa = await createReservation({ propertyId: property.id, clientId: client.id, startDate: `2026-12-${10 + i * 5}`, endDate: `2026-12-${13 + i * 5}` });
    const id = resa.id || resa.reservationId;
    setReservationAmounts(id, { finalPrice: 200 + i * 50, depositAmount: 0, balanceAmount: 200 + i * 50, balanceDueDate: `2026-10-0${6 + i}`, depositPaid: 0, balancePaid: 0 });
    ids.push(id);
  }
  seedBankCredits({ startDate: '2026-01-01', credits: [
    { id: `tc-a-${RUN}`, amountCents: 20000, date: '2026-10-05', counterpartyName: 'TOUTALPHA' },
    { id: `tc-b-${RUN}`, amountCents: 25000, date: '2026-10-07', counterpartyName: 'TOUTBRAVO' },
  ] });

  await page.goto('/finance/rapprochement');
  const proposed = page.getByRole('button', { name: /^À confirmer \d/ });
  await expect(proposed).toBeVisible({ timeout: 20_000 });
  await proposed.click();
  await expect(proposed).toHaveAttribute('aria-pressed', 'true');
  await expect(page).toHaveURL(/filter=proposed/);
  await page.keyboard.press('Escape');
  await expect(proposed).toHaveAttribute('aria-pressed', 'false');
  await proposed.click();

  await page.getByRole('button', { name: 'Tout confirmer' }).click();
  const dialog = page.getByRole('dialog');
  const announced = await dialog.getByText(/\d+ rapprochements? · /).innerText();
  const count = Number(announced.match(/^(\d+)/)[1]);
  expect(count).toBeGreaterThanOrEqual(2);
  await dialog.getByRole('button', { name: `Confirmer ${count}` }).click();
  await expect(page.getByText(`${count} rapprochements confirmés`)).toBeVisible();

  for (const id of ids) {
    const fiche = await (await request.get(`/api/reservations/${id}`)).json();
    expect(fiche.balancePaid).toBe(1);
  }
});
