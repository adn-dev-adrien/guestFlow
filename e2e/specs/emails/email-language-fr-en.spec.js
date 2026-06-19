// @ts-check
// specs/email-client-language-and-fiche-polish.md — the email language lives on the CLIENT and drives
// every email for them. A client set to English gets reminder emails (body + composed strings) in English.
// The email-language selector no longer appears on the reservation fiche.
import { test, expect } from '@playwright/test';
import { createClient, createProperty, createReservation } from '../../fixtures/apiSeed.js';
import { setClientEmailLanguage } from '../../fixtures/dbSeed.js';

async function j2TemplateId(request) {
  const res = await request.get('/api/email-templates');
  const list = await res.json();
  const t = list.find((x) => x.stableKey === 'arrival_reminder_1d');
  return t ? t.id : null;
}

test('a client set to English drives the J-2 preview to English; French clients stay French', async ({ page, request }) => {
  const property = await createProperty({ name: 'E2E lang villa' });
  const client = await createClient({ firstName: 'John', lastName: 'Langtest' });
  const reservation = await createReservation({
    propertyId: property.id, clientId: client.id,
    startDate: '2099-07-10', endDate: '2099-07-13', adults: 2,
  });
  const templateId = await j2TemplateId(request);
  expect(templateId).toBeTruthy();

  // French client (default) → French preview.
  const frRes = await request.get(`/api/emails/preview?reservationId=${reservation.id}&templateId=${templateId}`);
  const fr = await frRes.json();
  expect(fr.lang).toBe('fr');
  expect(fr.body).toMatch(/Votre séjour/);
  expect(fr.body).toMatch(/juillet 2099/);

  // Switch the CLIENT to English → English preview (body + composed date), no French leakage.
  setClientEmailLanguage(client.id, 'en');
  const enRes = await request.get(`/api/emails/preview?reservationId=${reservation.id}&templateId=${templateId}`);
  const en = await enRes.json();
  expect(en.lang).toBe('en');
  expect(en.body).toMatch(/Your stay/);
  expect(en.body).toMatch(/July 2099/);
  expect(en.body).not.toMatch(/Votre séjour/);

  // The reservation fiche no longer carries the email-language selector (it moved to the client fiche).
  await page.goto(`/reservations/${reservation.id}`);
  await expect(page.getByText('Options et ressources', { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Langue des emails')).toHaveCount(0);
});
