// @ts-check
// specs/reception-role-checkin-only.md — the « Accueil » account reaches ONLY the finance-free home
// and the Planning, and never receives a financial figure. That spec shipped without any E2E cover;
// this is the browser-level guard for it (the unit tests only pin the middleware allowlist and the
// serializer in isolation).
import { test, expect } from '@playwright/test';
import { createClient, createProperty, createReservation } from '../../fixtures/apiSeed.js';
import { RECEPTION_STORAGE_STATE } from '../../fixtures/authState.js';

test.use({ storageState: RECEPTION_STORAGE_STATE });

test('a forbidden route redirects the reception user home instead of rendering', async ({ page }) => {
  for (const forbidden of ['/finance', '/clients', '/reservations/upcoming', '/settings']) {
    await page.goto(forbidden);
    // The confinement guard sends them to `/`; the reduced home is the only thing that renders.
    await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
    await expect(page.getByRole('heading', { name: 'Tableau de bord' })).toBeVisible({ timeout: 15_000 });
  }
});

test('the reduced home offers Planning and never names a forbidden surface', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Tableau de bord' })).toBeVisible({ timeout: 15_000 });

  // Asserted page-wide rather than inside a nav container: on the reduced home these words can only
  // come from the sidebar, so their absence is the stronger claim (nothing anywhere offers the route).
  await expect(page.getByText('Planning', { exact: true }).first()).toBeVisible();
  for (const hidden of ['Finance', 'Suivi financier', 'Comptabilité', 'Clients', 'Devis', 'Emails']) {
    await expect(page.getByText(hidden, { exact: true })).toHaveCount(0);
  }
});

test('the reservation payload carries the door money but no revenue, balance or client PII', async ({ request }) => {
  // Seeded through the ADMIN session (reception may not create anything), then read back as reception.
  const property = await createProperty({ name: 'E2E accueil Finance', basePrice: 250 });
  const client = await createClient({
    firstName: 'Sophie', lastName: 'Confine', email: 'sophie.confine@example.test', phone: '+33600000042',
  });
  const reservation = await createReservation({
    propertyId: property.id, clientId: client.id, startDate: '2099-09-10', endDate: '2099-09-14', adults: 2,
  });

  const res = await request.get(`/api/reservations/${reservation.id}`);
  expect(res.ok()).toBeTruthy();
  const view = await res.json();

  // Kept: the money collected at the door + the operational fields.
  expect(view).toHaveProperty('cautionAmount');
  expect(view).toHaveProperty('complementAmount');
  expect(view).toHaveProperty('checkInReady');

  // Dropped: every revenue / settlement figure, and the guest's contact details.
  for (const leaked of [
    'totalPrice', 'customPrice', 'depositAmount', 'depositPaid', 'balanceAmount', 'balancePaid',
    'remainingDue', 'paymentComplete', 'touristTax', 'commissionAmount', 'contribs',
    'email', 'phone', 'address',
  ]) {
    expect(view, `${leaked} leaked to the reception payload`).not.toHaveProperty(leaked);
  }

  // The property list is stripped the same way (no pricing config).
  const props = await request.get('/api/properties');
  const seen = (await props.json()).find((p) => p.id === property.id);
  expect(seen).toBeTruthy();
  for (const leaked of ['basePrice', 'defaultCautionAmount', 'cleaningPrice']) {
    expect(seen, `${leaked} leaked to the reception property view`).not.toHaveProperty(leaked);
  }
});

test('write endpoints outside the reception allowlist are refused server-side', async ({ request }) => {
  // A crafted call (the UI never offers these) must fail closed, not merely be hidden.
  const clients = await request.get('/api/clients');
  expect(clients.status()).toBe(403);
  expect((await clients.json()).error).toBe('FORBIDDEN_ROLE');

  const create = await request.post('/api/reservations', { data: { propertyId: 1, clientId: 1 } });
  expect(create.status()).toBe(403);

  const finance = await request.get('/api/finance/overview');
  expect(finance.status()).toBe(403);
});
