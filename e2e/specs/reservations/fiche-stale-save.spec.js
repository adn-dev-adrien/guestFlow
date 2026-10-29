// @ts-check
// specs/reservation-fiche-concurrency.md rules 1-5 — a fiche saved after a background write is refused, not
// allowed to revert it. « Garder ma saisie » leaves the draft on screen; « Recharger » shows the write.
import { test, expect } from '@playwright/test';
import { createClient, createProperty, createReservation } from '../../fixtures/apiSeed.js';
import { enablePropertyDeposit, simulateBackgroundWrite } from '../../fixtures/dbSeed.js';

test('a save on an out-of-date fiche is refused; the draft is kept, then reload shows the background write', async ({ page }) => {
  const property = await createProperty({ name: 'E2E stale villa' });
  const client = await createClient({ firstName: 'Fiche', lastName: 'Perimee' });
  const reservation = await createReservation({
    propertyId: property.id, clientId: client.id, startDate: '2099-11-05', endDate: '2099-11-08', adults: 2,
  });
  await page.goto(`/reservations/${reservation.id}`);
  const notes = page.getByLabel('Notes').first();
  await expect(notes).toBeVisible({ timeout: 15_000 });

  simulateBackgroundWrite(reservation.id, 'Note posée par une importation');
  await notes.fill('Ma note de l’opérateur');
  const puts = [];
  page.on('response', (r) => { if (r.request().method() === 'PUT' && /\/api\/reservations\/\d+$/.test(r.url())) puts.push(r.status()); });

  await page.getByRole('button', { name: 'Enregistrer' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Fiche modifiée entre-temps' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Recharger efface la saisie en cours');
  expect(puts).toEqual([409]);

  await dialog.getByRole('button', { name: 'Annuler' }).click();
  await expect(dialog).toBeHidden();
  await expect(notes).toHaveValue('Ma note de l’opérateur');

  await page.getByRole('button', { name: 'Enregistrer' }).first().click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Recharger' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByLabel('Notes').first()).toHaveValue('Note posée par une importation');
});

test('rule 5 — « Enregistrer quand même » overwrites the background write, and the next save is not refused', async ({ page }) => {
  const property = await createProperty({ name: 'E2E overwrite villa' });
  const client = await createClient({ firstName: 'Fiche', lastName: 'Ecrasee' });
  const reservation = await createReservation({
    propertyId: property.id, clientId: client.id, startDate: '2099-08-05', endDate: '2099-08-08', adults: 2,
  });
  await page.goto(`/reservations/${reservation.id}`);
  const notes = page.getByLabel('Notes').first();
  await expect(notes).toBeVisible({ timeout: 15_000 });
  simulateBackgroundWrite(reservation.id, 'Note posée par une importation');
  await notes.fill('Ma note forcée');
  const statuses = [];
  page.on('response', (r) => { if (r.request().method() === 'PUT' && /\/api\/reservations\/\d+$/.test(r.url())) statuses.push(r.status()); });
  await page.getByRole('button', { name: 'Enregistrer' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Fiche modifiée entre-temps' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Enregistrer quand même' }).click();
  await expect.poll(() => statuses.length).toBe(2);
  expect(statuses).toEqual([409, 200]);
  const stored = await (await page.request.get(`/api/reservations/${reservation.id}`)).json();
  expect(stored.notes).toBe('Ma note forcée');
});

test.describe('phone (390 px)', () => {
  test.use({ viewport: { width: 390, height: 860 } });

  test('the dialog is reachable and nothing scrolls sideways', async ({ page }) => {
    const property = await createProperty({ name: 'E2E stale phone villa' });
    const client = await createClient({ firstName: 'Fiche', lastName: 'Mobile' });
    const reservation = await createReservation({
      propertyId: property.id, clientId: client.id, startDate: '2099-07-05', endDate: '2099-07-08', adults: 2,
    });
    await page.goto(`/reservations/${reservation.id}`);
    const notes = page.getByLabel('Notes').first();
    await expect(notes).toBeVisible({ timeout: 15_000 });
    simulateBackgroundWrite(reservation.id, 'Importée');
    await notes.fill('Saisie');
    await page.getByRole('button', { name: 'Enregistrer' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Fiche modifiée entre-temps' });
    await expect(dialog).toBeVisible();
    for (const name of ['Recharger', 'Enregistrer quand même', 'Annuler']) {
      const box = await dialog.getByRole('button', { name }).boundingBox();
      expect(box && box.height).toBeGreaterThanOrEqual(36);
      expect(box && box.x + box.width).toBeLessThanOrEqual(390);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });
});

test('a fiche that only the operator touched saves without any refusal', async ({ page }) => {
  const property = await createProperty({ name: 'E2E fresh villa' });
  const client = await createClient({ firstName: 'Fiche', lastName: 'Fraiche' });
  const reservation = await createReservation({
    propertyId: property.id, clientId: client.id, startDate: '2099-12-05', endDate: '2099-12-08', adults: 2,
  });
  await page.goto(`/reservations/${reservation.id}`);
  const notes = page.getByLabel('Notes').first();
  await expect(notes).toBeVisible({ timeout: 15_000 });
  await notes.fill('Une note');
  const statuses = [];
  page.on('response', (r) => { if (r.request().method() === 'PUT' && /\/api\/reservations\/\d+$/.test(r.url())) statuses.push(r.status()); });
  await page.getByRole('button', { name: 'Enregistrer' }).first().click();
  await expect.poll(() => statuses.length).toBeGreaterThan(0);
  expect(statuses).toEqual([200]);
});

test('rule 4 — a payment marked from the fiche does not make the next save look stale', async ({ page }) => {
  const property = await createProperty({ name: 'E2E twice villa' });
  enablePropertyDeposit(property.id);
  const client = await createClient({ firstName: 'Fiche', lastName: 'Deux' });
  const reservation = await createReservation({
    propertyId: property.id, clientId: client.id, startDate: '2099-09-05', endDate: '2099-09-08', adults: 2,
  });
  await page.goto(`/reservations/${reservation.id}`);
  const deposit = page.locator('[data-row="deposit"]');
  await deposit.getByRole('button', { name: 'Marquer perçu : Acompte' }).click();
  await deposit.getByLabel('Perçu le').fill(new Date().toLocaleDateString('sv-SE'));
  await deposit.getByRole('button', { name: 'Valider' }).click();
  await expect(deposit.getByText(/^Perçu le /)).toBeVisible({ timeout: 10_000 });

  const statuses = [];
  page.on('response', (r) => { if (r.request().method() === 'PUT' && /\/api\/reservations\/\d+$/.test(r.url())) statuses.push(r.status()); });
  await page.getByLabel('Notes').first().fill('Après encaissement');
  await page.getByRole('button', { name: 'Enregistrer' }).first().click();
  await expect.poll(() => statuses.length).toBeGreaterThan(0);
  expect(statuses).toEqual([200]);
});
