// @ts-check
// specs/hosting-h2-account-security.md §7 E2E — the forgotten password through the dev mail
// catcher (rules 1-4), turning on the authenticator app and logging in with a computed code
// (rules 6-7, 32-33, 38-45), changing the app (rules 47-48), and the support flow with a locally signed link (rules 12-16).
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

// Activates through the dialog and returns { secret, backupCodes }. Rules 38-45: one dialog, the QR code
// with the key folded, a wrong code that says the tries left, the code sent at its 6th digit, and
// backup codes that must be saved before « Terminé ».
async function activate(page, account) {
  await page.goto('/mon-compte');
  await expect(page.getByText('Désactivée')).toBeVisible();
  await expect(page.getByLabel(/^Mot de passe \(confirmation\)/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Activer' }).click();
  await expect(page.getByText('Étape 1 sur 3', { exact: true })).toBeVisible();
  await page.getByLabel(/^Mot de passe \(confirmation\)/).fill('not-the-password');
  await page.getByRole('button', { name: 'Continuer' }).click();
  await expect(page.getByText('Mot de passe incorrect.')).toBeVisible();
  await page.getByLabel(/^Mot de passe \(confirmation\)/).fill(account.password);
  await page.getByRole('button', { name: 'Continuer' }).click();
  await expect(page.getByText('Étape 2 sur 3', { exact: true })).toBeVisible();
  await expect(page.getByAltText('QR code de l’appli d’authentification')).toBeVisible();
  await page.getByRole('button', { name: 'Saisie manuelle de la clé' }).click();
  const secret = (await page.getByTestId('setup-key').textContent()).trim();
  await page.getByLabel('Code à 6 chiffres').fill('000000');
  await expect(page.getByRole('alert').filter({ hasText: 'Code incorrect : 4 essais restants.' })).toBeVisible();
  await page.getByLabel('Code à 6 chiffres').fill(codeFor(secret));
  await expect(page.getByText('Étape 3 sur 3', { exact: true })).toBeVisible();
  await expect(page.getByTestId('backup-codes')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Terminé' })).toBeDisabled();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Télécharger' }).click();
  expect((await download).suggestedFilename()).toMatch(/^guestflow-codes-de-secours-\d{4}-\d{2}-\d{2}\.txt$/);
  const backupCodes = (await page.getByTestId('backup-codes').innerText()).split(/\s+/).filter(Boolean);
  await page.getByRole('button', { name: 'Terminé' }).click();
  await expect(page.getByText('Activée', { exact: true })).toBeVisible();
  return { secret: secret.replace(/\s/g, ''), backupCodes };
}

test('rules 6-7, 38-45 — turn on the validation in the dialog, then log in with a computed code', async ({ page, context }) => {
  const account = seedAccount('totp');
  await login(page, account);
  await expect(page.getByRole('heading', { name: 'Tableau de bord' })).toBeVisible();
  const { secret } = await activate(page, account);
  await expect(page.getByText('10 codes de secours sur 10')).toBeVisible();

  await context.clearCookies();
  await login(page, account);
  await expect(page.getByText('Code à 6 chiffres de l’appli d’authentification.')).toBeVisible();
  await page.getByRole('button', { name: 'Utiliser un code de secours' }).click();
  await expect(page.getByLabel('Code de secours')).toHaveAttribute('inputmode', 'text');
  await page.getByRole('button', { name: 'Utiliser le code de l’application' }).click();
  // Rule 24: the enrolment code is spent, so the login takes the next 30 s step's code.
  await expect(page.getByRole('heading', { name: 'Vérification' })).toBeVisible();
  // Rule 33: a wrong code is said under the cells and the digits stay.
  await page.getByLabel('Code à 6 chiffres').fill('000000');
  await expect(page.getByRole('alert').filter({ hasText: 'Code incorrect.' })).toBeVisible();
  await expect(page.getByLabel('Code à 6 chiffres')).toHaveValue('000000');
  // Rule 32: the code is sent at its 6th digit, with no « Valider ».
  await page.getByLabel('Code à 6 chiffres').fill(codeFor(secret, new Date(Date.now() + 30_000)));
  await expect(page.getByRole('heading', { name: 'Tableau de bord' })).toBeVisible();
});

test('rules 47-48 — « Changer d’appli » asks the password and a code, and the new app replaces the old one when confirmed', async ({ page }) => {
  const account = seedAccount('replace');
  await login(page, account);
  await expect(page.getByRole('heading', { name: 'Tableau de bord' })).toBeVisible();
  const first = await activate(page, account);

  await page.getByRole('button', { name: 'Changer d’appli' }).click();
  await page.getByLabel(/^Mot de passe \(confirmation\)/).fill(account.password);
  // Rule 47: the code is sent at its 6th digit once the password is filled, and the refusal says the tries left.
  await page.getByLabel('Code à 6 chiffres').fill('000000');
  await expect(page.getByRole('alert').filter({ hasText: 'Code incorrect : 4 essais restants.' })).toBeVisible();
  // Rule 24: the enrolment code is spent, so the re-authentication takes the next step's code.
  await page.getByLabel('Code à 6 chiffres').fill(codeFor(first.secret, new Date(Date.now() + 30_000)));
  await expect(page.getByText('Étape 1 sur 2', { exact: true })).toBeVisible();
  await expect(page.locator('.MuiDialog-root')).toHaveCount(1);
  await page.getByRole('button', { name: 'Saisie manuelle de la clé' }).click();
  const next = (await page.getByTestId('setup-key').textContent()).replace(/\s/g, '');
  expect(next).not.toBe(first.secret);
  await expect(page.getByRole('checkbox', { name: 'Oublier les appareils de confiance' })).toBeChecked();
  await page.getByLabel('Code à 6 chiffres').fill(codeFor(next));
  await expect(page.getByText('Étape 2 sur 2', { exact: true })).toBeVisible();
  await page.getByRole('checkbox', { name: 'Codes enregistrés en lieu sûr' }).check();
  await page.getByRole('button', { name: 'Terminé' }).click();
  await page.getByRole('button', { name: /^Historique/ }).click();
  await expect(page.getByText('Appli d’authentification changée')).toBeVisible();

  await page.getByRole('button', { name: 'Désactiver' }).click();
  await page.getByLabel(/^Mot de passe \(confirmation\)/).fill(account.password);
  await page.getByLabel('Code à 6 chiffres').fill(codeFor(next, new Date(Date.now() + 30_000)));
  await expect(page.getByText('Désactivée', { exact: true })).toBeVisible();
  await expect(page.getByText('Validation en deux étapes désactivée.')).toBeVisible();
});

test('rules 12-16 + 20 — the support asks, the admin accepts, a signed link opens a traced support session', async ({ page, browser }) => {
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
  // Rule 23: the minute's reads, the page included, read as one « Consultation : … » line.
  await expect(page.getByText(/^Consultation : .*Planning/).first()).toBeVisible();
  await expect(page.getByText('/api/', { exact: false })).toHaveCount(0);
  await page.getByRole('button', { name: 'Révoquer' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Révoquer' }).click();
  await expect(page.getByText('Accès révoqué.')).toBeVisible();
  await supportContext.close();
});
