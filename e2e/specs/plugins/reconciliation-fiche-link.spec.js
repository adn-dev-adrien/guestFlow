// @ts-check
// specs/reconciliation-assisted-matching.md rules 1–8 — « Rattacher des virements » on the fiche: the
// plausible credits first, the search, two credits ticked at once, one gesture, the fiche marked received.
// The credits are loaded straight into the plugin's table: no Qonto call is ever made.
import { test, expect } from '@playwright/test';
import { createClient, createProperty, createReservation } from '../../fixtures/apiSeed.js';
import { seedBankCredits, setReservationAmounts } from '../../fixtures/dbSeed.js';

const RUN = Date.now();

test.describe.configure({ mode: 'serial' });

async function stay() {
  const property = await createProperty({ name: 'E2E rapprochement villa' });
  const client = await createClient({ firstName: 'Luce', lastName: 'Virement', email: 'luce@example.com' });
  const resa = await createReservation({ propertyId: property.id, clientId: client.id, startDate: '2026-12-10', endDate: '2026-12-13' });
  const id = resa.id || resa.reservationId;
  setReservationAmounts(id, { finalPrice: 300, depositAmount: 0, balanceAmount: 300, balanceDueDate: '2026-10-10', depositPaid: 0, balancePaid: 0 });
  return id;
}

test('two credits ticked at once are linked in one gesture and mark the fiche received', async ({ page, request }) => {
  const id = await stay();
  seedBankCredits({ startDate: '2026-01-01', credits: [
    { id: `e2e-a-${RUN}`, amountCents: 15000, date: '2026-10-05', counterpartyName: 'M. VIREMENT' },
    { id: `e2e-b-${RUN}`, amountCents: 15000, date: '2026-10-08', counterpartyName: 'VIREMENT LUCE' },
    { id: `e2e-c-${RUN}`, amountCents: 9900, date: '2026-02-12', counterpartyName: 'AUTRE SOCIETE' },
  ] });

  await page.goto(`/reservations/${id}`);
  await page.getByRole('button', { name: 'Rattacher des virements' }).click({ timeout: 20_000 });
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Correspondances probables')).toBeVisible();
  await expect(dialog.getByText(/Tous les virements disponibles \(\d+\)/)).toBeVisible();

  await dialog.getByLabel(/Nom, date/).fill('12/02');
  await expect(dialog.getByText(/AUTRE SOCIETE/)).toBeVisible();
  await expect(dialog.getByText('Correspondances probables')).toBeVisible();
  await dialog.getByLabel(/Nom, date/).fill('');

  const boxes = dialog.getByRole('checkbox');
  await boxes.nth(0).check();
  await boxes.nth(1).check();
  await expect(dialog.getByText('2 virements · 300,00 €')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Rattacher' })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Rattacher' }).click();
  await expect(dialog).toBeHidden();

  const fiche = await (await request.get(`/api/reservations/${id}`)).json();
  expect(fiche.balancePaid).toBe(1);
  expect(String(fiche.balancePaidDate).slice(0, 10)).toBe('2026-10-08');
});

test('390 px: the dialog is full screen, the footer stays reachable and nothing scrolls sideways', async ({ page }) => {
  const id = await stay();
  seedBankCredits({ startDate: '2026-01-01', credits: [{ id: `e2e-m-${RUN}`, amountCents: 30000, date: '2026-10-07', counterpartyName: 'M. VIREMENT' }] });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/reservations/${id}`);
  await page.getByRole('button', { name: 'Rattacher des virements' }).click({ timeout: 20_000 });
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('checkbox').first().check();
  await expect(dialog.getByRole('button', { name: 'Rattacher' })).toBeInViewport();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
