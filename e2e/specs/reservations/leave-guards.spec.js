// @ts-check
// specs/ui-review-2026-10-19-operations.md rules 40-43 — every way out of a dirty page asks first, at 1280 and at
// 390 touch: the browser « Retour » (fiche, logement), a reload, the top-bar search, the « Retour » arrow of a
// settings page, the CGV draft, « Se déconnecter ». An unknown logement says so.
import { test, expect } from '@playwright/test';
import { createClient, createProperty, createReservation } from '../../fixtures/apiSeed.js';
import { FAR_YEAR } from '../../fixtures/farYear.js';
import fixtures from '../../fixtures/accountSecurity.js';

const { seedAccount } = fixtures;
const PROMPT = 'Modifications non enregistrées';

const spaGoTo = (page, url) => page.evaluate((target) => {
  window.history.pushState({ idx: 1, key: 'spa', usr: null }, '', target);
  window.dispatchEvent(new PopStateEvent('popstate'));
}, url);

async function seedStay(tag) {
  const property = await createProperty({ name: `E2E garde ${tag}` });
  property.name = `E2E garde ${tag}`;
  const client = await createClient({ firstName: 'Garde', lastName: `Sortie${tag}` });
  const stay = await createReservation({ propertyId: property.id, clientId: client.id, startDate: `${FAR_YEAR}-05-10`, endDate: `${FAR_YEAR}-05-13` });
  return { property, client, stay };
}

const SIZES = [
  { name: '1280', use: { viewport: { width: 1280, height: 800 } }, phone: false },
  { name: '390 touch', use: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }, phone: true },
];

for (const size of SIZES) {
  test.describe(size.name, () => {
    test.use(size.use);

    const searchFor = async (page, term) => {
      if (size.phone) await page.getByRole('button', { name: /Rechercher/ }).first().click();
      const box = page.getByPlaceholder(/Rechercher une réservation/);
      await box.fill(term);
      await page.getByRole('option').first().click();
    };

    const dirtyNotes = async (page) => {
      const notes = page.getByLabel(/^Notes/i).first();
      await expect(notes).toBeEditable({ timeout: 15_000 });
      await notes.fill('brouillon');
      await expect(page.getByRole('button', { name: 'Annuler' }).first()).toBeEnabled();
      return notes;
    };

    test('rule 40 — Back on a dirty fiche asks, staying keeps the draft, leaving goes back once', async ({ page }) => {
      const tag = `B${Date.now()}`;
      const { stay } = await seedStay(tag);
      await page.goto('/clients');
      await searchFor(page, `Sortie${tag}`);
      await expect(page).toHaveURL(new RegExp(`/reservations/${stay.id}`));
      const notes = await dirtyNotes(page);
      const entries = await page.evaluate(() => window.history.length);

      await page.goBack();
      await expect(page.getByText(PROMPT)).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`/reservations/${stay.id}`));
      await page.getByRole('button', { name: 'Rester sur la page' }).click();
      await expect(page.getByText(PROMPT)).toBeHidden();
      await expect(notes).toHaveValue('brouillon');

      await page.goBack();
      await expect(page.getByText(PROMPT)).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`/reservations/${stay.id}`));
      expect(await page.evaluate(() => window.history.length)).toBe(entries);
      await page.getByRole('button', { name: 'Quitter sans enregistrer' }).click();
      await expect(page).toHaveURL(/\/clients$/);
    });

    test('rule 40 — Back on a dirty logement asks; a clean one goes straight back', async ({ page }) => {
      const tag = `L${Date.now()}`;
      const { property } = await seedStay(tag);
      await page.goto('/properties');
      await page.getByText(property.name).first().click();
      await expect(page).toHaveURL(new RegExp(`/properties/${property.id}`));
      const name = page.getByLabel(/^Nom du logement|^Nom/).first();
      await expect(name).toHaveValue(property.name, { timeout: 15_000 });

      await name.fill(`${property.name} bis`);
      await page.goBack();
      await expect(page.getByText(PROMPT)).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`/properties/${property.id}`));
      await page.getByRole('button', { name: 'Rester sur la page' }).click();
      await expect(page.getByText(PROMPT)).toBeHidden();
      await expect(name).toHaveValue(`${property.name} bis`);
      await page.goBack();
      await page.getByRole('button', { name: 'Quitter sans enregistrer' }).click();
      await expect(page).toHaveURL(/\/properties$/);

      await page.getByText(property.name).first().click();
      await expect(name).toHaveValue(property.name, { timeout: 15_000 });
      await page.goBack();
      await expect(page).toHaveURL(/\/properties$/);
    });

    test('rule 41 — a reload warns on a dirty fiche', async ({ page }) => {
      const { stay } = await seedStay(`R${Date.now()}`);
      await page.goto(`/reservations/${stay.id}`);
      const notes = page.getByLabel(/^Notes/i).first();
      await expect(notes).toBeEditable({ timeout: 15_000 });
      await notes.click();
      await page.keyboard.type('brouillon');
      let kind = null;
      page.once('dialog', async (dialog) => { kind = dialog.type(); await dialog.accept(); });
      await page.reload();
      expect(kind).toBe('beforeunload');
    });

    test('rule 42 — the top-bar search asks on a dirty fiche', async ({ page }) => {
      const tag = `S${Date.now()}`;
      const { stay } = await seedStay(tag);
      const other = await seedStay(`${tag}X`);
      await page.goto(`/reservations/${stay.id}`);
      const notes = await dirtyNotes(page);
      await searchFor(page, `Sortie${tag}X`);
      await expect(page.getByText(PROMPT)).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`/reservations/${stay.id}`));
      await page.getByRole('button', { name: 'Rester sur la page' }).click();
      await expect(notes).toHaveValue('brouillon');
      await searchFor(page, `Sortie${tag}X`);
      await page.getByRole('button', { name: 'Quitter sans enregistrer' }).click();
      await expect(page).toHaveURL(new RegExp(`/reservations/${other.stay.id}`));
    });

    test('rule 42 — the « Retour » arrow of a settings page asks when dirty', async ({ page }) => {
      await page.goto('/settings/etablissement');
      const field = page.getByLabel('Raison sociale');
      await expect(field).toBeEditable({ timeout: 15_000 });
      await field.fill(`${await field.inputValue()} x`);
      await page.getByRole('button', { name: 'Retour' }).click();
      await expect(page.getByText(PROMPT).last()).toBeVisible();
      await expect(page).toHaveURL(/\/settings\/etablissement/);
      await page.getByRole('button', { name: 'Quitter sans enregistrer' }).click();
      await expect(page).toHaveURL(/\/settings$/);
    });

    test('rule 42 — the CGV draft asks before Back', async ({ page }) => {
      await page.goto('/clients');
      await spaGoTo(page, '/parametres/conditions-generales');
      const field = page.getByLabel('Texte en français (Markdown)');
      await expect(field).toBeEditable({ timeout: 15_000 });
      await field.fill(`${await field.inputValue()}\nx`);
      await page.goBack();
      await expect(page.getByText(PROMPT)).toBeVisible();
      await expect(field).toHaveValue(/\nx$/);
    });

    test('rule 43 — an unknown logement says so and leads back to the list', async ({ page }) => {
      await page.goto('/properties/999999');
      await expect(page.getByText('Logement introuvable.')).toBeVisible();
      await expect(page.getByRole('button', { name: /Réessayer/ })).toHaveCount(0);
      await page.getByRole('button', { name: 'Retour aux logements' }).click();
      await expect(page).toHaveURL(/\/properties$/);
    });
  });

  test.describe(`${size.name}, own session`, () => {
    test.use({ ...size.use, storageState: { cookies: [], origins: [] } });

    test('rule 42 — « Se déconnecter » on a dirty page asks; « Quitter » signs out', async ({ page }) => {
      const account = seedAccount(`leave${size.phone ? 'm' : 'd'}${Date.now()}`);
      await page.goto('/login');
      await page.getByLabel(/^Email/).fill(account.email);
      await page.getByLabel(/^Mot de passe/).fill(account.password);
      await page.getByRole('button', { name: 'Se connecter' }).click();
      await expect(page.getByRole('button', { name: 'Se connecter' })).toBeHidden({ timeout: 15_000 });
      await page.goto('/parametres/conditions-generales');
      const field = page.getByLabel('Texte en français (Markdown)');
      await expect(field).toBeEditable({ timeout: 15_000 });
      await field.fill(`${await field.inputValue()}\nx`);

      if (size.phone) await page.getByRole('button', { name: 'Ouvrir le menu' }).click();
      await page.getByText('Se déconnecter').click();
      await expect(page.getByText(PROMPT)).toBeVisible();
      await page.getByRole('button', { name: 'Rester sur la page' }).click();
      await expect(page.getByText(PROMPT)).toBeHidden();
      await expect(field).toHaveValue(/\nx$/);

      await page.getByText('Se déconnecter').click();
      await page.getByRole('button', { name: 'Quitter sans enregistrer' }).click();
      await expect(page.getByRole('button', { name: 'Se connecter' })).toBeVisible();
      await page.reload();
      await expect(page.getByRole('button', { name: 'Se connecter' })).toBeVisible();
    });
  });
}
