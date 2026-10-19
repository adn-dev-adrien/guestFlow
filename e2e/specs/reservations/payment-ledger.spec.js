// @ts-check
// specs/reservation-payment-ledger.md — the payments ledger of the fiche, end to end: set the solde
// (rule 17), a refusal shown in place (rule 16), mark the acompte with a future date (refused, rule 9)
// then today (rule 8), undo with a confirmation naming the date (rule 14), the caution in order
// (rule 12), and a platform payout received with its transfer (rule 26).
import { test, expect } from '@playwright/test';
import { createClient, createProperty, createReservation } from '../../fixtures/apiSeed.js';
import { enablePropertyDeposit, setReservationAmounts, setReservationDates } from '../../fixtures/dbSeed.js';

const today = () => new Date().toLocaleDateString('sv-SE');

async function openFiche(page, id) {
  await page.goto(`/reservations/${id}`);
  await expect(page.getByTestId('ledger')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-row="balance"]').getByRole('button', { name: /montant/i })).toBeVisible();
}

// Every full save of the fiche the page sends while the test runs.
function watchSaves(page) {
  const puts = [];
  page.on('request', (r) => { if (r.method() === 'PUT' && /\/api\/reservations\/\d+$/.test(r.url())) puts.push(r.url()); });
  return puts;
}

test('direct stay: set the solde, refusal in place, mark the acompte (future refused), undo, caution in order', async ({ page }) => {
  const property = await createProperty({ name: 'E2E ledger villa' });
  enablePropertyDeposit(property.id);
  const client = await createClient({ firstName: 'Lena', lastName: 'Registre' });
  const reservation = await createReservation({
    propertyId: property.id, clientId: client.id, startDate: '2099-10-05', endDate: '2099-10-08', adults: 2,
  });
  await openFiche(page, reservation.id);

  const deposit = page.locator('[data-row="deposit"]');
  const balance = page.locator('[data-row="balance"]');
  await expect(deposit.getByRole('button', { name: 'Marquer perçu : Acompte' })).toBeVisible();

  // Rule 16 — an acompte above the accommodation is refused, in French, under the field.
  await deposit.getByRole('button', { name: /Modifier le montant : Acompte/ }).click();
  await page.getByLabel("Montant de l'acompte (€)").fill('99999');
  await expect(deposit.getByText(/L'acompte ne dépasse pas l'hébergement/)).toBeVisible();
  await expect(deposit.getByRole('button', { name: 'Valider' })).toBeDisabled();
  await deposit.getByRole('button', { name: 'Annuler', exact: true }).click();

  // Rule 17 — typing the solde moves the split, the total stays.
  await balance.getByRole('button', { name: /Modifier le montant : Solde/ }).click();
  await page.getByLabel('Montant du solde (€)').fill('150');
  await expect(balance.getByText(/· total inchangé/)).toBeVisible();
  await balance.getByRole('button', { name: 'Valider' }).click();
  await expect(balance.getByRole('button', { name: /Modifier le montant : Solde/ })).toContainText('150,00');

  // Rule 9 — a future date is refused, the form stays open with the typed value.
  await deposit.getByRole('button', { name: 'Marquer perçu : Acompte' }).click();
  await deposit.getByLabel('Perçu le').fill('2099-01-01');
  await deposit.getByRole('button', { name: 'Valider' }).click();
  await expect(deposit.getByText('Un encaissement ne peut pas être daté dans le futur.')).toBeVisible({ timeout: 10_000 });
  await expect(deposit.getByLabel('Perçu le')).toHaveValue('2099-01-01');

  // Rule 8 — today: the acompte is perceived (the fiche was saved first, rule 10).
  await deposit.getByLabel('Perçu le').fill(today());
  await deposit.getByRole('button', { name: 'Valider' }).click();
  await expect(deposit.getByText(/^Perçu le /)).toBeVisible({ timeout: 10_000 });
  const stored = await (await page.request.get(`/api/reservations/${reservation.id}`)).json();
  expect(stored.depositPaid).toBeTruthy();
  expect(stored.balanceAmount).toBe(150);

  // Rule 14 — undo asks, naming the date and the accounting entry.
  await deposit.getByRole('button', { name: 'Annuler : Acompte' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText("L'écriture comptable correspondante disparaît.");
  await dialog.getByRole('button', { name: 'Annuler la perception' }).click();
  await expect(deposit.getByRole('button', { name: 'Marquer perçu : Acompte' })).toBeVisible({ timeout: 10_000 });

  // Rule 12 — « Restituer » only after « Recevoir ».
  const returned = page.locator('[data-row="cautionReturned"]');
  await expect(returned.getByText('Après réception')).toBeVisible();
  await expect(returned.getByRole('button', { name: /^Restituer/ })).toHaveCount(0);
  const received = page.locator('[data-row="cautionReceived"]');
  await received.getByRole('button', { name: /^Recevoir/ }).click();
  await received.getByRole('button', { name: 'Valider' }).click();
  await expect(returned.getByRole('button', { name: /^Restituer/ })).toBeVisible({ timeout: 10_000 });
});

test('platform stay: « Marquer reçu » asks for the transfer and shows the gap', async ({ page }) => {
  const property = await createProperty({ name: 'E2E ledger platform villa' });
  const client = await createClient({ firstName: 'Paul', lastName: 'Versement' });
  const reservation = await createReservation({
    propertyId: property.id, clientId: client.id, startDate: '2099-11-05', endDate: '2099-11-08', adults: 2, platform: 'Booking',
  });
  await openFiche(page, reservation.id);
  await expect(page.locator('[data-row="deposit"]')).toContainText('Sans objet');

  const payout = page.locator('[data-row="balance"]');
  await expect(payout).toContainText('Versement Booking');
  await payout.getByRole('button', { name: /^Marquer reçu/ }).click();
  await payout.getByLabel('Virement reçu (€)').fill('100');
  await expect(payout.getByText(/^Écart : .* avec le net attendu$/)).toBeVisible({ timeout: 10_000 });
  await payout.getByRole('button', { name: 'Valider' }).click();
  await expect(payout.getByText(/^Reçu le .* · Booking$/)).toBeVisible({ timeout: 10_000 });
  const stored = await (await page.request.get(`/api/reservations/${reservation.id}`)).json();
  expect(stored.balancePaid).toBeTruthy();
  expect(stored.platformPayoutAmount).toBe(100);
});

test('the ledger does not scroll sideways on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const property = await createProperty({ name: 'E2E ledger phone villa with a rather long name' });
  const client = await createClient({ firstName: 'Ana', lastName: 'Téléphone' });
  const reservation = await createReservation({
    propertyId: property.id, clientId: client.id, startDate: '2099-12-05', endDate: '2099-12-08', adults: 2, platform: 'GitesDeFrance',
  });
  await openFiche(page, reservation.id);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
});

// Review of #727 (B1) — a payout received on a PAST, locked platform stay: the transfer rides the mark,
// the fiche is never saved whole, nothing is re-priced (specs/reservation-payment-ledger.md rule 34).
test('past platform stay: « Marquer reçu » records the transfer without saving the fiche', async ({ page }) => {
  const property = await createProperty({ name: 'E2E ledger past platform villa' });
  const client = await createClient({ firstName: 'Iris', lastName: 'Passé' });
  const reservation = await createReservation({
    propertyId: property.id, clientId: client.id, startDate: '2099-08-05', endDate: '2099-08-08', adults: 2, platform: 'Booking',
  });
  setReservationDates(reservation.id, '2026-01-05', '2026-01-08');
  setReservationAmounts(reservation.id, { balanceDueDate: '2026-01-18', depositDueDate: null });
  const before = await (await page.request.get(`/api/reservations/${reservation.id}`)).json();
  const puts = watchSaves(page);
  await openFiche(page, reservation.id);
  const payout = page.locator('[data-row="balance"]');
  await expect(payout.getByText(/^En retard depuis le/)).toBeVisible();
  await payout.getByRole('button', { name: /^Marquer reçu/ }).click();
  await payout.getByLabel('Virement reçu (€)').fill('250');
  await payout.getByRole('button', { name: 'Valider' }).click();
  await expect(payout.getByText(/^Reçu le .* · Booking$/)).toBeVisible({ timeout: 10_000 });
  const after = await (await page.request.get(`/api/reservations/${reservation.id}`)).json();
  expect(after.balancePaid).toBeTruthy();
  expect(after.platformPayoutAmount).toBe(250);
  expect([after.balanceAmount, after.finalPrice]).toEqual([before.balanceAmount, before.finalPrice]);
  expect(puts).toEqual([]);
  // The amounts of a locked fiche are read-only.
  await payout.getByRole('button', { name: /Montant figé|Modifier le montant/ }).click();
  await expect(payout.getByText(/Versement reçu le|déverrouiller la fiche/)).toBeVisible();
});

// Review of #727 (B2, M3, H2) — a stay whose stored amount drifted from today's engine: the fiche shows
// and marks the STORED amount, without a save, and stays unmodified afterwards (rules 7, 10, 33).
test('drifted stored amount: shown and marked as stored, no save, the fiche stays unmodified', async ({ page }) => {
  const property = await createProperty({ name: 'E2E ledger drift villa' });
  const client = await createClient({ firstName: 'Noé', lastName: 'Dérive' });
  const reservation = await createReservation({
    propertyId: property.id, clientId: client.id, startDate: '2099-09-05', endDate: '2099-09-08', adults: 2,
  });
  const stored = await (await page.request.get(`/api/reservations/${reservation.id}`)).json();
  const drifted = Math.round((stored.balanceAmount - 24) * 100) / 100;
  setReservationAmounts(reservation.id, { balanceAmount: drifted });
  const puts = watchSaves(page);
  await openFiche(page, reservation.id);
  const balance = page.locator('[data-row="balance"]');
  await expect(balance.getByRole('button', { name: /Modifier le montant : Solde/ })).toContainText(String(drifted).replace('.', ','));
  await balance.getByRole('button', { name: /^Marquer perçu/ }).click();
  await balance.getByRole('button', { name: 'Valider' }).click();
  await expect(balance.getByText(/^Perçu le /)).toBeVisible({ timeout: 10_000 });
  expect(puts).toEqual([]);
  const after = await (await page.request.get(`/api/reservations/${reservation.id}`)).json();
  expect(after.balancePaid).toBeTruthy();
  expect(after.balanceAmount).toBe(drifted);
  // Unmodified: leaving the fiche asks nothing.
  await page.getByRole('button', { name: 'Annuler', exact: true }).first().click();
  await expect(page).not.toHaveURL(new RegExp(`/reservations/${reservation.id}$`), { timeout: 10_000 });
});
