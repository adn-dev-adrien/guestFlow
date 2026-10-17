// @ts-check
// specs/guest-email-texts-made-simple.md §7 E2E — fill a property's arrival facts and see them in the
// J-2 preview, export the texts then re-import them (one changed row, one refused row), and run a
// test send that lands in the dev mail catcher.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { createClient, createProperty, createReservation } from '../../fixtures/apiSeed.js';
import { setCompanySetting } from '../../fixtures/dbSeed.js';
import { OUTBOX } from '../../fixtures/accountSecurity.js';

const isoOffset = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
const COMPANY_EMAIL = 'textes-e2e@guestflow.test';

test.describe('Textes des emails', () => {
  let property;
  let previousEmail;

  // A stay far enough ahead that no sequence email of it is due: it must not reach the shared
  // « Emails à envoyer » queue other specs read.
  test.beforeAll(async () => {
    property = await createProperty({ name: 'E2E Textes Gîte' });
    const client = await createClient({ firstName: 'Textes', lastName: 'Voyageur', email: 'textes@test.fr' });
    await createReservation({ propertyId: property.id, clientId: client.id, startDate: isoOffset(40), endDate: isoOffset(42), doubleBeds: 1 });
    previousEmail = setCompanySetting('companyEmail', COMPANY_EMAIL);
  });

  test.afterAll(() => {
    setCompanySetting('companyEmail', previousEmail || '');
  });

  test('rules 1–3, 13, 15: the arrival facts show in the J-2 preview, and a test reaches the mail catcher', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/properties/${property.id}?tab=sejour`);
    await page.getByLabel('Adresse', { exact: true }).fill('12 chemin des Prés E2E');
    await page.getByLabel('Accès (français)').fill('La clé est dans la boîte bleue.');
    const saved = page.waitForResponse((r) => r.url().includes('/arrival-facts') && r.request().method() === 'PUT');
    await page.getByRole('button', { name: 'Enregistrer l’arrivée' }).click();
    expect((await saved).ok()).toBe(true);

    await page.goto(`/settings/emails/textes?propertyId=${property.id}#j2`);
    const preview = page.getByTestId('email-preview');
    await expect(preview).toContainText('Bonjour Textes,', { timeout: 10_000 });
    await expect(preview).toContainText('- Adresse : 12 chemin des Prés E2E');
    await expect(preview).toContainText('- La clé est dans la boîte bleue.');

    const before = fs.existsSync(OUTBOX) ? fs.readdirSync(OUTBOX).length : 0;
    await page.getByRole('button', { name: 'M’envoyer un test' }).click();
    await expect(page.getByText(`Envoyé à ${COMPANY_EMAIL}`)).toBeVisible();
    const mails = fs.readdirSync(OUTBOX).sort().slice(before).map((f) => JSON.parse(fs.readFileSync(path.join(OUTBOX, f), 'utf8')));
    const sent = mails.find((m) => m.to === COMPANY_EMAIL);
    expect(sent.subject).toMatch(/^\[Test\] /);
    expect(sent.text).toContain('12 chemin des Prés E2E');
  });

  test('rules 16–17: export, then re-import with one changed row and one refused row', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/settings/emails/textes?propertyId=${property.id}#j2`);
    await expect(page.getByTestId('email-preview')).toContainText('Bonjour', { timeout: 10_000 });

    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Exporter les textes' }).click();
    const file = testInfo.outputPath('textes.csv');
    await (await download).saveAs(file);
    const csv = fs.readFileSync(file, 'utf8');
    expect(csv.startsWith('﻿email;clé;description;français;english;texte par défaut (FR)')).toBe(true);

    const lines = csv.split('\r\n');
    const house = lines.findIndex((l) => l.startsWith('J-2;text:house;'));
    const cleaning = lines.findIndex((l) => l.startsWith('J-2;text:cleaning.included;'));
    lines[house] = 'J-2;text:house;Dans le logement;Thé offert E2E.;;';
    lines[cleaning] = 'J-2;text:cleaning.included;Ménage compris;Bonjour {{prenon}};;';
    const edited = testInfo.outputPath('textes-modifies.csv');
    fs.writeFileSync(edited, lines.join('\r\n'));

    await page.getByTestId('email-texts-file').setInputFiles(edited);
    const dialog = page.getByRole('dialog', { name: 'Importer les textes' });
    await expect(dialog.getByText('1 texte modifié, 1 refusé')).toBeVisible();
    await expect(dialog.getByText('Variable inconnue : {{prenon}}')).toBeVisible();
    await expect(dialog.getByRole('cell', { name: String(cleaning + 1), exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Enregistrer 1' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByLabel('Français').and(page.locator('#text\\:house-fr'))).toHaveValue('Thé offert E2E.');
    await expect(page.getByTestId('email-preview')).toContainText('Thé offert E2E.');
  });
});
