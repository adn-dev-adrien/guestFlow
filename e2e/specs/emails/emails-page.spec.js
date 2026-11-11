// @ts-check
// Emails page — the reworked /emails view (specs/email-automation.md §6.1 + §6.10).
// Verifies the two-card layout, the template row-click → edit dialog wiring, and the
// "Voir l'historique" navigation. The « Emails à envoyer » queue interactions (row → send,
// client-name → reservation) are covered by the component suite; here we pin the page-level
// routing + the seeded J-7 template surfacing end-to-end, under its one name « Préparation du séjour »
// (specs/guest-email-texts-made-simple.md rule 44).
import { test, expect } from '@playwright/test';

test('Emails page shows the two cards and the seeded J-7 template', async ({ page }) => {
  const errors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', (err) => { errors.push(`pageerror: ${err.message}`); });

  await page.goto('/emails');

  // Page header + the always-visible templates card.
  await expect(page.getByRole('heading', { name: 'Emails', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: "Modèles d'emails" })).toBeVisible();

  // The default registry template seeded on boot.
  await expect(page.getByText('Préparation du séjour', { exact: true })).toBeVisible();
  await expect(page.getByText('7 jours avant l’arrivée', { exact: true })).toBeVisible();

  expect(errors, `console errors:\n${errors.join('\n')}`).toEqual([]);
});

test('a shipped email opens its texts; « ⋯ » opens its template', async ({ page }) => {
  await page.goto('/emails');
  await page.getByRole('button', { name: 'Plus d’actions : Préparation du séjour' }).click();
  await page.getByRole('menuitem', { name: 'Modifier le modèle' }).click();
  await expect(page.getByRole('heading', { name: 'Préparation du séjour' })).toBeVisible();
  await expect(page.getByText('Envoyé 7 jours avant l’arrivée')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Modifier les textes : Préparation du séjour' }).click();
  await expect(page).toHaveURL(/\/settings\/emails\/textes#j7$/);
});

test('"Voir l\'historique" navigates to the history page', async ({ page }) => {
  await page.goto('/emails');
  // Since the phase-3 sweep the action lives in the PageActionBar as an icon button (aria-label).
  await page.getByRole('button', { name: "Voir l'historique" }).click();
  await expect(page).toHaveURL(/\/emails\/historique$/);
  await expect(page.getByRole('heading', { name: 'Historique des emails' })).toBeVisible();
});
