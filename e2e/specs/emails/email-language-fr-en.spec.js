// @ts-check
// specs/email-language-fr-en.md — a reservation set to English gets its reminder emails (template body
// + server-composed strings) rendered in English; the fiche carries the language selector.
import { test, expect } from '@playwright/test';
import { createClient, createProperty, createReservation } from '../../fixtures/apiSeed.js';
import { setEmailLanguage } from '../../fixtures/dbSeed.js';

async function j2TemplateId(request) {
  const res = await request.get('/api/email-templates');
  const list = await res.json();
  const t = list.find((x) => x.stableKey === 'arrival_reminder_1d');
  return t ? t.id : null;
}

test('an English reservation previews the J-2 reminder in English; French stays French', async ({ page, request }) => {
  const property = await createProperty({ name: 'E2E lang villa' });
  const client = await createClient({ firstName: 'John', lastName: 'Langtest' });
  const reservation = await createReservation({
    propertyId: property.id, clientId: client.id,
    startDate: '2099-07-10', endDate: '2099-07-13', adults: 2,
  });
  const templateId = await j2TemplateId(request);
  expect(templateId).toBeTruthy();

  // French by default → French preview.
  const frRes = await request.get(`/api/emails/preview?reservationId=${reservation.id}&templateId=${templateId}`);
  const fr = await frRes.json();
  expect(fr.lang).toBe('fr');
  expect(fr.body).toMatch(/Votre séjour/);
  expect(fr.body).toMatch(/juillet 2099/);

  // Switch the reservation to English → English preview (body + composed date).
  setEmailLanguage(reservation.id, 'en');
  const enRes = await request.get(`/api/emails/preview?reservationId=${reservation.id}&templateId=${templateId}`);
  const en = await enRes.json();
  expect(en.lang).toBe('en');
  expect(en.body).toMatch(/Your stay/);
  expect(en.body).toMatch(/July 2099/);
  expect(en.body).not.toMatch(/Votre séjour/);

  // The fiche surfaces the language selector reflecting the stored value (English).
  await page.goto(`/reservations/${reservation.id}`);
  await expect(page.getByText('Options et ressources', { exact: true })).toBeVisible({ timeout: 10_000 });
  // The email-language selector shows the stored value (its MUI label "Langue des emails" sits beside it).
  await expect(page.getByText('Langue des emails').first()).toBeVisible();
  await expect(page.getByRole('combobox').filter({ hasText: 'English' })).toBeVisible();
});
