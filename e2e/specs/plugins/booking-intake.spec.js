// @ts-check
// plugins/booking-intake — specs/booking-extranet-intake.md rules 1–3, 7, 12–15, 17–18, 21–23 (E2E).
// The userscript's request is replayed by hand against the real server: the iCal placeholder is filled
// (guest, party, money reconciled with ✓), the dashboard line it created goes away, a second view is
// « déjà à jour », a fiche edited since gets a proposal that Appliquer settles.
import { test, expect, request as playwrightRequest } from '@playwright/test';
import { createClient, createProperty, createReservation } from '../../fixtures/apiSeed.js';
import { setPublicUrl, markIcalImported, setPlatformPayout } from '../../fixtures/dbSeed.js';
import { CLIENT_URL, SERVER_PORT } from '../../clientUrl.js';

const { PAGE_6392081711, replaceOnce } = require('../../../server/src/plugins/booking-intake/tests/fixtures.js');

const HOTEL_ID = '14407976';
const RES_ID = '6392081711';
const START = '2099-10-05';
const END = '2099-10-07';
const BACKEND = `http://127.0.0.1:${SERVER_PORT}`;

const pageText = () => replaceOnce(replaceOnce(PAGE_6392081711, 'ven. 6 nov. 2026', 'lun. 5 oct. 2099'), 'dim. 8 nov. 2026', 'mer. 7 oct. 2099');

// The seed installs every plugin active (server/scripts/seed-e2e.js): the Plugins page switches it.
const bookingCard = (page) => page.locator('.MuiCard-root').filter({ hasText: 'Saisie Booking' });

async function setActive(page, active) {
  await page.goto('/parametres/plugins');
  const card = bookingCard(page);
  await expect(card.getByText(/^(Actif|Inactif)$/)).toBeVisible({ timeout: 10_000 });
  if (active) {
    const button = card.getByRole('button', { name: 'Activer' });
    if (await button.count()) await button.click();
  } else if (await card.getByText('Actif', { exact: true }).count()) {
    // specs/plugins-phase-0-foundation.md rule 25 — « Désactiver » sits in ⋯, behind a confirmation.
    await card.getByRole('button', { name: /Plus d’actions/ }).click();
    await page.getByRole('menuitem', { name: /Désactiver/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Désactiver' }).click();
  }
  await expect(card.getByText(active ? 'Actif' : 'Inactif', { exact: true })).toBeVisible({ timeout: 10_000 });
}

async function sendPage(secret, text = pageText()) {
  const ctx = await playwrightRequest.newContext({ baseURL: BACKEND });
  try {
    const res = await ctx.post('/public/booking-intake/page', {
      headers: { 'X-Booking-Intake-Key': secret },
      data: { v: 1, hotelId: HOTEL_ID, resId: RES_ID, text },
    });
    return { status: res.status(), body: await res.json() };
  } finally {
    await ctx.dispose();
  }
}

test('booking intake: activation, mapping, dashboard line, fiche filled and reconciled, second view, proposal', async ({ page }) => {
  setPublicUrl(CLIENT_URL);
  const property = await createProperty({ name: 'E2E booking-intake Granja', maxGuests: 12, singleBeds: 4, doubleBeds: 4 });
  const client = await createClient({ firstName: 'C', lastName: 'G' });
  const reservation = await createReservation({
    propertyId: property.id, clientId: client.id, startDate: START, endDate: END, adults: 1, platform: 'Lodgify',
  });
  markIcalImported(reservation.id, 'lodgify');

  // Rule 1 — inactive: no card, no route.
  await setActive(page, false);
  expect((await page.request.get('/api/booking-intake/pending')).status()).toBe(404);
  await page.goto('/settings/integrations');
  await expect(page.getByRole('heading', { name: 'Intégrations' }).first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('N° d’établissement Booking de chaque logement')).toHaveCount(0);

  // Rules 2, 12 — switched on, the card shows; the property is tied to the establishment id.
  await setActive(page, true);
  await page.goto('/settings/integrations');
  await expect(page.getByText('N° d’établissement Booking de chaque logement')).toBeVisible({ timeout: 10_000 });
  // Rule 25 — the secret is created by an explicit action; until then the script is refused.
  const secretAction = page.getByRole('button', { name: /^(Créer|Régénérer) le secret$/ });
  await expect(secretAction).toBeVisible({ timeout: 10_000 });
  if ((await secretAction.textContent()) === 'Créer le secret') {
    expect((await page.request.get('/api/booking-intake/userscript.user.js')).status()).toBe(409);
    await secretAction.click();
  }
  await expect(page.getByRole('link', { name: 'Installer le script' })).toHaveAttribute('href', '/api/booking-intake/userscript.user.js');
  // Scoped to the Booking card: another plugin's card (Gîtes de France, run in parallel) lists the same properties.
  const card = page.locator('.MuiCard-root', { has: page.getByText('N° d’établissement Booking de chaque logement') });
  await card.getByLabel('E2E booking-intake Granja').fill(HOTEL_ID);
  await page.getByRole('button', { name: 'Enregistrer' }).first().click();
  await expect(page.getByRole('button', { name: 'Enregistrer' }).first()).toBeDisabled({ timeout: 10_000 });

  const script = await (await page.request.get('/api/booking-intake/userscript.user.js')).text();
  expect(script).toContain('// ==UserScript==');
  const secret = (script.match(/var KEY = "([^"]+)"/) || [])[1];
  expect(secret).toBeTruthy();

  // Rules 21–22 — the fiche waits on the dashboard, with a link into the extranet list.
  await page.goto('/');
  // The subject waits in « À traiter » (specs/shell-and-home-day-first.md rule 10): unfold its row.
  await page.getByRole('button', { name: /Réservations Booking à compléter/ }).first().click({ timeout: 10_000 });
  const line = page.getByText(/E2E booking-intake Granja · .* → /);
  await expect(line).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('link', { name: 'Ouvrir dans Booking' }).first()).toHaveAttribute('href', new RegExp(`hotel_id=${HOTEL_ID}&date_type=arrival&date_from=${START}`));

  // Rule 7 — a wrong secret is a bare 401.
  expect((await sendPage('not-the-secret')).status).toBe(401);

  // Rules 13–15 — the right one fills the fiche.
  const applied = await sendPage(secret);
  expect(applied.status, JSON.stringify(applied.body)).toBe(200);
  expect(applied.body, JSON.stringify(applied.body)).toMatchObject({ status: 'applied', reservationId: reservation.id });

  await page.goto('/');
  await expect(page.getByText(/E2E booking-intake Granja · .* → /)).toHaveCount(0);

  await page.goto(`/reservations/${reservation.id}`);
  await expect(page.getByText(/Rempli depuis l’extranet Booking le \d{2}\/\d{2} à \d{2}:\d{2}\./)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/cohérent avec le virement/i)).toBeVisible();
  const stored = await (await page.request.get(`/api/reservations/${reservation.id}`)).json();
  expect(stored).toMatchObject({
    platform: 'Booking', reservationNumber: RES_ID, firstName: 'Camille', lastName: 'Garnier', adults: 10, checkInTime: '20:00',
    platformGrossAmount: 721.82, platformTouristTaxAmount: 20.02, platformPayoutAmount: 606.44, platformCommissionAmount: 95.36,
  });

  // Rule 18 — Masquer hides the banner for good.
  await page.getByRole('button', { name: /close/i }).first().click();
  await expect(page.getByText(/Rempli depuis l’extranet Booking/)).toHaveCount(0);
  await page.reload();
  await expect(page.getByText('Paiements', { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/Rempli depuis l’extranet Booking/)).toHaveCount(0);

  // Rule 17 — a second view is « déjà à jour »; a figure edited since becomes a proposal.
  expect((await sendPage(secret)).body.status).toBe('same');
  setPlatformPayout(reservation.id, 600);
  const proposed = await sendPage(secret);
  expect(proposed.body).toMatchObject({ status: 'proposed' });
  await page.reload();
  await expect(page.getByText('La page Booking propose 1 valeur différente de la fiche.')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Virement reçu : 600 → 606.44')).toBeVisible();
  await page.getByRole('button', { name: 'Appliquer' }).click();
  await expect(page.getByText('La page Booking propose')).toHaveCount(0, { timeout: 10_000 });
  const after = await (await page.request.get(`/api/reservations/${reservation.id}`)).json();
  expect(after.platformPayoutAmount).toBe(606.44);

  // Rule 1 — switched off, the door is a 404 again, even with the right secret.
  await setActive(page, false);
  expect((await sendPage(secret)).status).toBe(404);
  await setActive(page, true);
});

test('booking intake on a phone: the dashboard line and the settings card do not overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/settings/integrations');
  await expect(page.getByText('N° d’établissement Booking de chaque logement')).toBeVisible({ timeout: 10_000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  await page.goto('/');
  await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 10_000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
});
