// @ts-check
// plugins/online-payment — specs/plugins-phase-3a-online-payment.md rules 5, 15, 17, 18.
// The payment buttons follow the server, not the plugin switch: with the plugin installed but Qonto
// not connected (the E2E database never connects it), the fiche offers no payment request and the
// endpoints refuse. Switched off, the Paiements page and its menu entry go too. The public site's
// address lives with the CGV and survives the plugin.
import { test, expect } from '@playwright/test';
import { createClient, createProperty, createReservation } from '../../fixtures/apiSeed.js';

test.describe.configure({ mode: 'serial' });

test('without a connected provider the fiche offers no payment request and the endpoint refuses', async ({ page, request }) => {
  const property = await createProperty({ name: 'E2E paiement villa' });
  const client = await createClient({ firstName: 'Paul', lastName: 'Paiement', email: 'paul@example.com' });
  const resa = await createReservation({ propertyId: property.id, clientId: client.id, startDate: '2027-03-10', endDate: '2027-03-13' });
  const id = resa.id || resa.reservationId;

  const fiche = await (await request.get(`/api/reservations/${id}`)).json();
  expect(fiche.onlinePayment).toBeNull();
  const refused = await request.post(`/api/payments/reservations/${id}/payment-emails`, { data: { type: 'balance' } });
  expect(refused.status()).toBe(409);
  expect((await refused.json()).error).toBe('NO_PAYMENT_PROVIDER');

  await page.goto(`/reservations/${id}`);
  await expect(page.getByRole('button', { name: 'Enregistrer' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Envoyer la demande de solde' })).toHaveCount(0);
});

test('switched off, the Paiements page and its menu entry go; switched on, they come back', async ({ page, request }) => {
  await page.goto('/parametres/paiements');
  await expect(page.getByText('Connexion bancaire').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('link', { name: 'Paiements en ligne' }).first()).toBeVisible();

  expect((await request.post('/api/plugins/online-payment/deactivate')).status()).toBe(200);
  try {
    expect((await request.get('/api/payments/settings')).status()).toBe(404);
    await page.goto('/parametres/paiements');
    await expect(page.getByText('Connexion bancaire')).toHaveCount(0);
    await page.goto('/parametres/conditions-generales');
    await expect(page.getByRole('heading', { name: 'Conditions générales' }).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('link', { name: 'Paiements en ligne' })).toHaveCount(0);
  } finally {
    expect((await request.post('/api/plugins/online-payment/activate')).status()).toBe(200);
  }
});

test('the public site address is saved with the CGV, refused when it carries a path', async ({ page, request }) => {
  const before = (await (await request.get('/api/terms')).json()).publicSiteOrigin;
  try {
    await page.goto('/parametres/conditions-generales');
    const field = page.getByLabel('Adresse du site public');
    await expect(field).toBeVisible({ timeout: 15_000 });
    await field.fill('https://site.example/cgv');
    await page.getByRole('button', { name: 'Enregistrer l’adresse' }).click();
    await expect(page.getByText(/Adresse invalide/)).toBeVisible();

    await field.fill('https://www.site.example/');
    await page.getByRole('button', { name: 'Enregistrer l’adresse' }).click();
    await expect(page.getByText('Adresse du site enregistrée')).toBeVisible();
    expect((await (await request.get('/api/terms')).json()).publicSiteOrigin).toBe('https://www.site.example');
  } finally {
    await request.put('/api/terms/public-site-origin', { data: { publicSiteOrigin: before } });
  }
});
