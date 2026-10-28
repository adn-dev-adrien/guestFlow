// @ts-check
// specs/vat-optional-mode.md §7 — Paramètres › TVA & exercice › « Changer de régime… », against the real
// app: a switch from today (a new reservation prints the mention, an old one keeps « TVA 10 % »), a
// correction behind its acknowledgement, the way back, and the dialog on a phone.
import { test, expect } from '@playwright/test';
import { createClient, createProperty, createReservation } from '../../fixtures/apiSeed.js';
import { backdateReservation, resetVatRegime } from '../../fixtures/dbSeed.js';

const MENTION = 'TVA non applicable, art. 293 B du CGI';

test.describe.configure({ mode: 'serial' });
test.beforeAll(() => { resetVatRegime(); });
test.afterAll(() => { resetVatRegime(); });

/** @type {{ old: number, fresh: number }} */
const ids = { old: 0, fresh: 0 };

async function openCard(page) {
  await page.goto('/settings/tva-exercice');
  await expect(page.getByRole('heading', { name: 'TVA & exercice' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Changer de régime…' })).toBeVisible({ timeout: 10_000 });
}

async function summaryOf(page, id) {
  await page.goto(`/reservations/${id}`);
  await expect(page.getByText('Résumé tarifaire').first()).toBeVisible({ timeout: 15_000 });
}

test('a switch from today: the next reservation prints the mention, the old one keeps « TVA 10 % »', async ({ page }) => {
  const property = await createProperty({ name: 'E2E VAT villa', basePrice: 120 });
  const client = await createClient({ firstName: 'Regime', lastName: 'Tva' });
  const old = await createReservation({ propertyId: property.id, clientId: client.id, startDate: '2099-06-10', endDate: '2099-06-13', adults: 2 });
  backdateReservation(old.id, '2026-01-02 10:00:00');
  ids.old = old.id;

  await openCard(page);
  await expect(page.getByText('Assujetti · 10 %', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Changer de régime…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Passer sans TVA' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('radio', { name: /Réservations prises à partir du/ })).toBeChecked();
  await expect(dialog.getByText('Prix inchangés.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Passer sans TVA' }).click();
  await expect(dialog).toBeHidden();

  const history = page.getByRole('list', { name: 'Historique' });
  await expect(history.getByRole('listitem').first()).toContainText('Sans TVA');
  await expect(history.getByRole('listitem').first()).toContainText('En vigueur');
  await expect(page.getByLabel('Mention légale')).toBeVisible();

  const fresh = await createReservation({ propertyId: property.id, clientId: client.id, startDate: '2099-07-10', endDate: '2099-07-13', adults: 2 });
  ids.fresh = fresh.id;
  await summaryOf(page, fresh.id);
  await expect(page.getByTestId('vat-mention').first()).toHaveText(MENTION);
  await summaryOf(page, old.id);
  await expect(page.getByText('TVA 10%').first()).toBeVisible();
  await expect(page.getByTestId('vat-mention')).toHaveCount(0);
});

test('the way back as a correction: acknowledgement first, then the reservation that printed the mention reads « TVA 10 % » again', async ({ page }) => {
  await openCard(page);
  await page.getByRole('button', { name: 'Changer de régime…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Passer à la TVA' });
  await dialog.getByRole('radio', { name: /Toutes les réservations — correction/ }).check();
  const go = dialog.getByRole('button', { name: 'Corriger toutes les réservations' });
  await expect(dialog.getByText('Prix inchangés.')).toBeVisible();
  await expect(go).toBeDisabled();
  await dialog.getByRole('checkbox').check();
  await expect(go).toBeEnabled();
  await go.click();
  await expect(dialog).toBeHidden();
  await expect(page.getByLabel('Taux de TVA (%)')).toHaveValue('10');

  await summaryOf(page, ids.fresh);
  await expect(page.getByText('TVA 10%').first()).toBeVisible();
  await expect(page.getByTestId('vat-mention')).toHaveCount(0);
});

test('a refusal shown in place: a date before the last change', async ({ page }) => {
  await openCard(page);
  await page.getByRole('button', { name: 'Changer de régime…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Passer sans TVA' });
  await dialog.getByLabel('Réservations prises à partir du : date').fill('2020-01-01');
  await expect(dialog.getByText(/Date antérieure au dernier changement/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Passer sans TVA' })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Annuler' }).click();
});

test('on a phone the dialog is full screen, the scopes stack, nothing scrolls sideways', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await openCard(page);
  await page.getByRole('button', { name: 'Changer de régime…' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  expect(box && box.width).toBeGreaterThanOrEqual(388);
  await expect(dialog.getByRole('radio')).toHaveCount(3);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
