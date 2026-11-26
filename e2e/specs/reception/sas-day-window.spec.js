// @ts-check
// specs/sas/reception-sas-today-only.md — the « Accueil » role may only act on the SAS of the DAY.
// This is the end-to-end guard: the unit tests pin the window arithmetic and each guard in
// isolation, but only a real browser session proves that a reception user actually sees an inert ✓
// on a past / future / committed SAS and a live one on today's.
//
// Runs as the seeded reception account (its own storageState); the fixtures still seed through the
// ADMIN session, since reception may not create anything.
import { test, expect } from '../../fixtures/test.js';
import { createClient, createProperty, createReservation } from '../../fixtures/apiSeed.js';
import { setReservationDates } from '../../fixtures/dbSeed.js';
import { RECEPTION_STORAGE_STATE } from '../../fixtures/authState.js';

test.use({ storageState: RECEPTION_STORAGE_STATE });

// Local ISO day, offset in days. The window runs [D 00:00, D+1 04:00), so ±3 days keeps « past »
// and « future » unambiguous even for a run started just after midnight.
function isoDay(offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// One property per reservation: the planning refuses overlapping stays on the same property, and a
// dedicated property also keeps each case visually isolated on the page. Its name carries a run tag:
// the suite shares one database, so other specs (and a --repeat-each) leave arrivals of their own on the
// same days, and a locator that is not bound to THIS test's stay ends up on theirs.
//
// `POST /reservations` refuses a stay in the past (« Impossible de réserver dans le passé »), which is
// exactly the state this spec needs — so a past stay is created in the future through the real API,
// then back-dated with a direct SQLite write, the documented escape hatch for pre-existing state.
async function seedStay({ label, startDate, endDate }, testInfo) {
  const past = startDate < isoDay(0);
  const tag = `${testInfo.repeatEachIndex}-${Date.now().toString(36)}`;
  const propertyName = `E2E accueil ${label} ${tag}`;
  const property = await createProperty({ name: propertyName });
  const client = await createClient({ firstName: 'Accueil', lastName: `${label} ${tag}` });
  const reservation = await createReservation({
    propertyId: property.id,
    clientId: client.id,
    startDate: past ? isoDay(30) : startDate,
    endDate: past ? isoDay(32) : endDate,
    adults: 2,
  });
  if (past) setReservationDates(reservation.id, startDate, endDate);
  return { propertyName, property, client, reservation };
}

/** The arrival card of a seeded stay, inside the section of its own day. */
function arrivalCard(page, { propertyName }, day) {
  return page.locator(`[data-scroll-anchor="day-${day}"] .MuiCard-root`)
    .filter({ has: page.getByRole('heading', { name: propertyName, exact: true }) });
}

/** The SAS dialog of a seeded stay: its header band names the client and the property. */
function sasDialog(page, { propertyName }) {
  return page.getByRole('dialog').filter({ hasText: propertyName });
}

test("today's SAS is live while past / future ones are inert for the reception role", async ({ page }, testInfo) => {
  const today = await seedStay({ label: 'Jour', startDate: isoDay(0), endDate: isoDay(2) }, testInfo);
  const future = await seedStay({ label: 'Futur', startDate: isoDay(3), endDate: isoDay(5) }, testInfo);

  await page.goto('/planning');
  await expect(page.getByRole('heading', { name: 'Planning' })).toBeVisible({ timeout: 15_000 });
  const todayCard = arrivalCard(page, today, isoDay(0));
  const futureCard = arrivalCard(page, future, isoDay(3));
  await expect(todayCard).toBeVisible({ timeout: 15_000 });

  // Today → the SAS launcher is live.
  await expect(todayCard.getByRole('button', { name: 'Accueil', exact: true })).toBeEnabled();

  // Future → locked with its own wording, and the « Prêt » checkbox is locked too.
  const futureSas = futureCard.getByRole('button', { name: /Check-in à venir — modifiable le jour de l'arrivée/ });
  await expect(futureSas).toBeVisible();
  await expect(futureSas).toBeDisabled();
  await expect(futureCard.getByRole('checkbox', { name: /Statut modifiable uniquement le jour/ })).toBeDisabled();

  // Tapping the locked ✓ opens nothing. A disabled button takes no pointer event, so a finger lands on
  // the <span> that carries its tooltip: that is the element tapped, by an ordinary click. A forced
  // click on the button itself skips Playwright's hit-target check and fires at coordinates taken
  // before the tap; the planning keeps today pinned under its bar until an operator gesture
  // (specs/planning/dashboard-planning-scroll.md rule 24), so a card that grew meanwhile scrolled today's ✓ under
  // those coordinates and the tap opened today's wizard (CI, 2026-11-23).
  await futureSas.locator('xpath=..').click();
  await expect(sasDialog(page, future)).toHaveCount(0);
  await expect(sasDialog(page, today)).toHaveCount(0);
  await expect(page).toHaveURL(/\/planning$/);

  // The deep-link (reception Dashboard row / push notification) is the one way in — it must land on
  // the locked panel, not the wizard.
  await page.goto(`/planning?sas=arrival&reservationId=${future.reservation.id}`);
  const futureDialog = sasDialog(page, future);
  await expect(futureDialog).toContainText(`Ce check-in n'est possible que le`, { timeout: 15_000 });
  await expect(futureDialog).toContainText('le jour de l\'arrivée.');
  await expect(futureDialog.getByRole('button', { name: 'Fermer' })).toBeVisible();
  await expect(futureDialog.getByRole('button', { name: 'Valider et terminer' })).toHaveCount(0);

  // …while today's reservation opens the real wizard for the same account.
  await page.goto(`/planning?sas=arrival&reservationId=${today.reservation.id}`);
  await expect(sasDialog(page, today).getByRole('button', { name: 'Commencer' })).toBeVisible({ timeout: 15_000 });
});

test('a past SAS is refused by the server, with the reason, and no status write goes through', async ({ request }, testInfo) => {
  // `request` inherits this file's storageState → the calls below are made AS the reception user.
  const past = await seedStay({ label: 'Passe', startDate: isoDay(-5), endDate: isoDay(-3) }, testInfo);
  const id = past.reservation.id;

  const arrival = await request.post(`/api/reservations/${id}/sas/arrival`, { data: {} });
  expect(arrival.status()).toBe(403);
  expect(await arrival.json()).toEqual({ error: 'SAS_LOCKED', reason: 'past' });

  const departure = await request.post(`/api/reservations/${id}/sas/departure`, { data: {} });
  expect(departure.status()).toBe(403);
  expect(await departure.json()).toEqual({ error: 'SAS_LOCKED', reason: 'past' });

  const status = await request.patch(`/api/reservations/${id}/payment`, { data: { checkInReady: true } });
  expect(status.status()).toBe(403);
  expect(await status.json()).toEqual({ error: 'STATUS_LOCKED', reason: 'past' });

  // The read stays open on a locked SAS — that is what feeds the locked panel.
  const read = await request.get(`/api/reservations/${id}/sas`);
  expect(read.ok()).toBeTruthy();
  expect((await read.json()).receptionLock).toEqual({ arrival: 'past', departure: 'past' });
});

test("today's SAS commits, then locks itself as « done » while its status toggle stays open", async ({ request }, testInfo) => {
  const today = await seedStay({ label: 'Commit', startDate: isoDay(0), endDate: isoDay(2) }, testInfo);
  const id = today.reservation.id;

  const commit = await request.post(`/api/reservations/${id}/sas/arrival`, { data: { cautionReceived: true } });
  expect(commit.ok()).toBeTruthy();

  // Immediately locked as « done » — no grace period (spec §3.4 edge case).
  const again = await request.post(`/api/reservations/${id}/sas/arrival`, { data: {} });
  expect(again.status()).toBe(403);
  expect(await again.json()).toEqual({ error: 'SAS_LOCKED', reason: 'done' });

  // …but a committed SAS does NOT lock its status toggles for the rest of the day (rule 6).
  const status = await request.patch(`/api/reservations/${id}/payment`, { data: { checkInReady: true } });
  expect(status.ok()).toBeTruthy();

  // And the planning renders the « done » wording rather than a past/future one.
  const list = await request.get('/api/reservations');
  const row = (await list.json()).find((r) => r.id === id);
  expect(row.arrivalSasLock).toBe('done');
  expect(row.checkInStatusEditable).toBe(true);
});
