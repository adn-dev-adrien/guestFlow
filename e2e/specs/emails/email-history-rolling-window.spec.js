// @ts-check
// specs/email-history-rolling-window.md — the email history is a rolling window: it shows sends only
// for reservations whose stay hasn't passed arrival + 3 days, and is reachable from the sidebar.
import { test, expect } from '@playwright/test';
import { createClient, createProperty, createReservation } from '../../fixtures/apiSeed.js';
import { seedEmailLog, setReservationDates } from '../../fixtures/dbSeed.js';

// Dates relative to "now" so the window assertion is deterministic whenever the suite runs.
function isoOffset(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

test('history shows current-stay sends, hides past-stay sends, and is reachable from the menu', async ({ page }) => {
  const property = await createProperty({ name: 'E2E history villa' });
  const client = await createClient({ firstName: 'Hist', lastName: 'Window' });

  // Current stay: arrives in 10 days → well within the window.
  const current = await createReservation({
    propertyId: property.id, clientId: client.id,
    startDate: isoOffset(10), endDate: isoOffset(12), adults: 2,
  });
  // Past stay: created in the future (the API forbids past dates), then pushed into the past directly so
  // arrival + 3 is long gone → out of the window.
  const past = await createReservation({
    propertyId: property.id, clientId: client.id,
    startDate: isoOffset(20), endDate: isoOffset(22), adults: 2,
  });
  setReservationDates(past.id, isoOffset(-10), isoOffset(-8));

  seedEmailLog({ reservationId: current.id, renderedSubject: 'CURRENT-STAY-EMAIL', recipientEmail: 'hist@test.fr' });
  seedEmailLog({ reservationId: past.id, renderedSubject: 'PAST-STAY-EMAIL', recipientEmail: 'hist@test.fr' });

  // Reach the history from the sidebar: on /emails the "Emails" submenu auto-expands → click "Historique".
  await page.goto('/emails');
  // Exact: the sidebar child is "Historique"; the page also has a "Voir l'historique" button.
  await page.getByRole('link', { name: 'Historique', exact: true }).click();
  await expect(page).toHaveURL(/\/emails\/historique/);
  await expect(page.getByRole('heading', { name: 'Historique des emails' })).toBeVisible({ timeout: 10_000 });

  // Rolling-window caption present.
  await expect(page.getByText(/retirés 3 jours après la date d.arrivée/i)).toBeVisible();

  // The current-stay send shows; the past-stay send is filtered out.
  await expect(page.getByText('CURRENT-STAY-EMAIL')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('PAST-STAY-EMAIL')).toHaveCount(0);
});
