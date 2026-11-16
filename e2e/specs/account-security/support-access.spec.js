// @ts-check
// specs/hosting-h2-account-security.md §7 E2E — the support flow with a locally signed link (rules 12-16, 20). The access request it files is
// global state: every admin page shows its banner until it is answered, which pushes the page down under any spec measuring the layout
// (mobile/page-tabs saw its tab strip 238 px lower). It runs in the project « support-access », never beside the main one
// (specs/e2e-playwright-smoke-suite.md rule 20).
import { test, expect } from '@playwright/test';
import fixtures from '../../fixtures/accountSecurity.js';

const { seedAccount, writeSupportRequest, openAccessId, supportLinkPath } = fixtures;

test.use({ storageState: { cookies: [], origins: [] } });

async function login(page, { email, password }) {
  await page.goto('/login');
  await page.getByLabel(/^Email/).fill(email);
  await page.getByLabel(/^Mot de passe/).fill(password);
  await page.getByRole('button', { name: 'Se connecter' }).click();
}

test('rules 12-16 + 20 — the support asks, the admin accepts, a signed link opens a traced support session', async ({ page, browser }) => {
  const account = seedAccount('support');
  writeSupportRequest('Vérifier la synchronisation Booking');
  await login(page, account);
  await expect(page.getByText('Le support demande l’accès : Vérifier la synchronisation Booking')).toBeVisible({ timeout: 15_000 });
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
