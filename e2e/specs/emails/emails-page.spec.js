// @ts-check
// Emails page — the reworked /emails view (specs/email-automation.md §6.1 + §6.10).
// Verifies the two-card layout, the template row-click → edit dialog wiring, and the
// "Voir l'historique" navigation. The « Emails à envoyer » queue interactions (row → send,
// client-name → reservation) are covered by the component suite; here we pin the page-level
// routing + the seeded "Rappel arrivée — J-7" template surfacing end-to-end.
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
  await expect(page.getByText('Rappel arrivée — J-7')).toBeVisible();

  expect(errors, `console errors:\n${errors.join('\n')}`).toEqual([]);
});

test('clicking a template row opens its edit dialog', async ({ page }) => {
  await page.goto('/emails');
  await page.getByText('Rappel arrivée — J-7').click();
  await expect(page.getByRole('heading', { name: 'Modifier le modèle' })).toBeVisible();
});

test('"Voir l\'historique" navigates to the history page', async ({ page }) => {
  await page.goto('/emails');
  // Since the phase-3 sweep the action lives in the PageActionBar as an icon button (aria-label).
  await page.getByRole('button', { name: "Voir l'historique" }).click();
  await expect(page).toHaveURL(/\/emails\/historique$/);
  await expect(page.getByRole('heading', { name: 'Historique des emails' })).toBeVisible();
});
