// @ts-check
// specs/reservation-payment-ledger.md §3.8 rules 50, 57, 62 — the stored amounts look like the usual
// summary (no notice), and a platform stay sold far from the grid raises one alert.
import { test, expect } from '@playwright/test';
import { createClient, createProperty, createReservation } from '../../fixtures/apiSeed.js';
import { seedPlatformChannel, setReservationAmounts } from '../../fixtures/dbSeed.js';

async function platformStay({ tag, gross }) {
  const property = await createProperty({ name: `E2E grille ${tag}` });
  seedPlatformChannel({ propertyId: property.id, platform: 'Booking', commissionPercent: 15, pricePerNight: 100 });
  const client = await createClient({ firstName: 'Nora', lastName: `Grille${tag}` });
  const reservation = await createReservation({
    propertyId: property.id, clientId: client.id, startDate: '2099-10-05', endDate: '2099-10-08', adults: 2, platform: 'Booking',
  });
  setReservationAmounts(reservation.id, { platformGrossAmount: gross });
  return { property, reservation };
}

test.use({ viewport: { width: 1280, height: 900 } });

test('a drifted direct stay opens with the usual summary: no notice about the calculation', async ({ page }) => {
  const property = await createProperty({ name: 'E2E résumé enregistré' });
  const client = await createClient({ firstName: 'Lena', lastName: 'Resume' });
  const reservation = await createReservation({
    propertyId: property.id, clientId: client.id, startDate: '2099-11-05', endDate: '2099-11-08', adults: 2,
  });
  setReservationAmounts(reservation.id, { finalPrice: 333, balanceAmount: 333 });
  await page.goto(`/reservations/${reservation.id}`);
  await expect(page.getByText('Résumé tarifaire').first()).toBeVisible({ timeout: 15_000 });
  const card = page.locator('.MuiCard-root').filter({ hasText: 'Résumé tarifaire' }).last();
  await expect(card.getByText('Prix hébergement', { exact: true })).toBeVisible();
  await expect(card.getByText('(3 nuits)')).toBeVisible();
  await expect(card.getByText('333,00 €').first()).toBeVisible();
  await expect(page.getByText(/Montants enregistrés|calcul actuel/)).toHaveCount(0);
  await expect(page.getByTestId('platform-price-alert')).toHaveCount(0);
});

test('a Booking stay listed at the grid raises no alert', async ({ page }) => {
  const { reservation } = await platformStay({ tag: `A${Date.now()}`, gross: 354 });
  await page.goto(`/reservations/${reservation.id}`);
  await expect(page.getByText('Résumé tarifaire').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Prix hébergement', { exact: true }).first()).toBeVisible();
  await expect(page.getByTestId('platform-price-alert')).toHaveCount(0);
});

test('a Booking stay 30 % under the grid shows « Prix Booking à vérifier »; « Voir la grille » opens the seasons', async ({ page }) => {
  const { property, reservation } = await platformStay({ tag: `B${Date.now()}`, gross: 248 });
  await page.goto(`/reservations/${reservation.id}`);
  const alert = page.getByTestId('platform-price-alert');
  await expect(alert).toBeVisible({ timeout: 15_000 });
  await expect(alert).toContainText('Prix Booking à vérifier');
  await expect(alert).toContainText('248,00 € payés · 354,00 € selon la grille (−30 %)');
  await alert.getByRole('link', { name: 'Voir la grille' }).click();
  await expect(page).toHaveURL(new RegExp(`/properties/${property.id}/pricing-seasons`));
});

test.describe('phone (390 px)', () => {
  test.use({ viewport: { width: 390, height: 860 }, hasTouch: true, isMobile: true });

  test('the summary sheet opens with the alert, and nothing scrolls sideways', async ({ page }) => {
    const { reservation } = await platformStay({ tag: `C${Date.now()}`, gross: 248 });
    await page.goto(`/reservations/${reservation.id}`);
    await page.getByTestId('sticky-total-bar').click({ timeout: 15_000 });
    const sheet = page.getByRole('dialog', { name: 'Résumé tarifaire' });
    await expect(sheet.getByTestId('platform-price-alert')).toContainText('Prix Booking à vérifier');
    const link = await sheet.getByRole('link', { name: 'Voir la grille' }).boundingBox();
    expect(link && link.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });
});
