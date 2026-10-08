// @ts-check
// specs/hosting-h2-account-security.md §7 E2E — the forgotten password through the dev mail
// catcher (rules 1-4), turning on the authenticator app and logging in with a computed code
// (rules 6-7), and the support flow with a locally signed link (rules 12-16).
import { test, expect } from '@playwright/test';
import fixtures from '../../fixtures/accountSecurity.js';

const { seedAccount, lastMailTo, codeFor, writeSupportRequest, openAccessId, supportLinkPath } = fixtures;

test.use({ storageState: { cookies: [], origins: [] } });

async function login(page, { email, password }) {
  await page.goto('/login');
  await page.getByLabel(/^Email/).fill(email);
  await page.getByLabel(/^Mot de passe/).fill(password);
  await page.getByRole('button', { name: 'Se connecter' }).click();
}

test('rules 1-4 — a forgotten password is reset through the emailed link', async ({ page }) => {
  const account = seedAccount('forgot');
  await page.goto('/login');
  await page.getByText('Mot de passe oublié ?').click();
  await expect(page.getByRole('button', { name: 'Envoyer le lien' })).toBeVisible();
  await page.getByLabel(/^Email/).fill(account.email);
  await page.getByRole('button', { name: 'Envoyer le lien' }).click();
  await expect(page.getByText('Si un compte existe, un lien vient d’être envoyé.')).toBeVisible();
  await expect.poll(() => lastMailTo(account.email)).not.toBeNull();
  const link = new URL(/https?:\/\/\S+/.exec(lastMailTo(account.email).text)[0]);
  await page.goto(`${link.pathname}${link.search}`);
  await page.getByLabel(/^Nouveau mot de passe/).fill('court');
  await page.getByLabel(/^Confirmer le nouveau mot de passe/).fill('court');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByText('Au moins 10 caractères.', { exact: true }).first()).toBeVisible();
  await page.getByLabel(/^Nouveau mot de passe/).fill('a-new-e2e-password');
  await page.getByLabel(/^Confirmer le nouveau mot de passe/).fill('a-new-e2e-password');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByRole('heading', { name: 'Tableau de bord' })).toBeVisible();
});

test('rules 6-7 — turn on the authenticator app, then log in with a computed code', async ({ page, context }) => {
  const account = seedAccount('totp');
  await login(page, account);
  await expect(page.getByRole('heading', { name: 'Tableau de bord' })).toBeVisible();
  await page.goto('/mon-compte');
  // The « Second code » card loads its status first; only then is its password field the last one.
  await expect(page.getByRole('button', { name: 'Activer' })).toBeVisible();
  await page.getByLabel(/^Mot de passe actuel/).last().fill(account.password);
  await page.getByRole('button', { name: 'Activer' }).click();
  await expect(page.getByAltText('QR code de l’appli d’authentification')).toBeVisible();
  const secret = await page.getByText(/^([A-Z2-7]{4} ?)+$/).textContent();
  await page.getByLabel('Code à 6 chiffres').fill('000000');
  await page.getByRole('button', { name: 'Confirmer' }).click();
  await expect(page.getByText('Code incorrect.')).toBeVisible();
  await page.getByLabel('Code à 6 chiffres').fill(codeFor(secret));
  await page.getByRole('button', { name: 'Confirmer' }).click();
  await expect(page.getByTestId('backup-codes')).toBeVisible();
  await page.getByRole('button', { name: 'Terminé' }).click();

  await context.clearCookies();
  await login(page, account);
  await expect(page.getByText('Code à 6 chiffres de l’appli d’authentification.')).toBeVisible();
  await page.getByLabel('Code à 6 chiffres').fill(codeFor(secret));
  await page.getByRole('button', { name: 'Valider' }).click();
  await expect(page.getByRole('heading', { name: 'Tableau de bord' })).toBeVisible();
});

test('rules 12-16 — the support asks, the admin accepts, a signed link opens a traced support session', async ({ page, browser }) => {
  const account = seedAccount('support');
  writeSupportRequest('Vérifier la synchronisation Booking');
  await login(page, account);
  await expect(page.getByText('Le support demande l’accès : Vérifier la synchronisation Booking')).toBeVisible();
  await page.getByRole('button', { name: 'Autoriser 24 h' }).click();
  await expect(page.getByText('Accès du support autorisé 24 h.')).toBeVisible();

  const supportContext = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const support = await supportContext.newPage();
  const linkPath = supportLinkPath(openAccessId());
  await support.goto(linkPath);
  await expect(support.getByTestId('support-session-bar')).toContainText('Session support — jusqu’au');
  await support.goto('/planning');
  await expect(support.getByTestId('support-session-bar')).toBeVisible();

  const replay = await (await browser.newContext({ storageState: { cookies: [], origins: [] } })).newPage();
  await replay.goto(linkPath);
  await expect(replay.getByText('Lien support invalide ou expiré.')).toBeVisible();

  await page.goto('/parametres/acces-support');
  await page.getByRole('button', { name: /Journal/ }).first().click();
  await expect(page.getByText('Page ouverte : /planning')).toBeVisible();
  await page.getByRole('button', { name: 'Révoquer' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Révoquer' }).click();
  await expect(page.getByText('Accès révoqué.')).toBeVisible();
  await supportContext.close();
});
