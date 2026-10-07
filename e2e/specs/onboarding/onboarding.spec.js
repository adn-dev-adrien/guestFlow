// @ts-check
// specs/plugins-phase-p-productisation.md §3.D rules 20–23 — the start assistant, end to end: an
// admin with the assistant open lands on it, goes through the four steps, the server refuses an
// invalid step, and the dashboard opens with the property created.
//
// The E2E database is shared by specs running in parallel, so the assistant is opened for THIS page
// only: `/api/auth/me` answers `onboardingOpen` until the page closes it. The company it shows is
// the suite's own, put back as it was. The forced password change before it is covered by the auth
// specs.
import { test, expect } from '@playwright/test';
import { onboardingProperty } from '../../fixtures/dbSeed.js';

const NAME = 'E2E Grange onboarding';

async function openAssistant(page) {
  let open = true;
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/api/onboarding/done')) open = false;
  });
  await page.route('**/api/auth/me', async (route) => {
    const response = await route.fetch();
    const json = await response.json();
    await route.fulfill({ response, json: { ...json, onboardingOpen: open } });
  });
}

test('an admin goes through the four steps and lands on the dashboard', async ({ page }) => {
  await openAssistant(page);
  await page.goto('/');
  await expect(page.getByText('Étape 1 sur 4')).toBeVisible({ timeout: 10_000 });
  await expect(page).toHaveURL(/\/demarrage$/);

  // Step 1 — the server refuses an empty company; the suite's company is put back.
  const name = page.getByLabel(/Nom de l’entreprise/);
  const email = page.getByLabel(/^Email/);
  const [savedName, savedEmail] = [await name.inputValue(), await email.inputValue()];
  await name.fill('');
  await email.fill('');
  await page.getByRole('button', { name: 'Suivant' }).click();
  await expect(page.getByText('Nom obligatoire')).toBeVisible();
  await expect(page.getByText('Étape 1 sur 4')).toBeVisible();
  await name.fill(savedName || 'GuestFlow E2E');
  await email.fill(savedEmail || 'e2e@guestflow.test');
  await page.getByRole('button', { name: 'Suivant' }).click();

  // Step 2 — beds drive the capacity; more guests than sleeping places are refused.
  await expect(page.getByText('Étape 2 sur 4')).toBeVisible();
  await page.getByLabel('Nom du logement').fill(NAME);
  await page.getByLabel('Lits doubles').fill('2');
  await page.getByLabel('Lits simples').fill('1');
  await expect(page.getByLabel('Capacité')).toHaveValue('5');
  await page.getByLabel('Capacité').fill('9');
  await page.getByLabel('Prix par nuit (€)').fill('95');
  await page.getByRole('button', { name: 'Suivant' }).click();
  await expect(page.getByText(/Seulement 5 couchages/)).toBeVisible();
  await page.getByLabel('Capacité').fill('5');
  await page.getByRole('button', { name: 'Suivant' }).click();

  // Step 3 — the recommended plugins are ticked.
  await expect(page.getByText('Étape 3 sur 4')).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /Réservation depuis le site/ })).toBeChecked();
  await page.getByRole('button', { name: 'Suivant' }).click();

  // Step 4 — the dashboard.
  await expect(page.getByText('Étape 4 sur 4')).toBeVisible();
  await page.getByRole('button', { name: 'Ouvrir le tableau de bord' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText('Étape 1 sur 4')).toHaveCount(0);

  expect(onboardingProperty(NAME)).toMatchObject({ maxGuests: 5, doubleBeds: 2, singleBeds: 1, pricePerNight: 95 });
});

test('mobile: one step per screen, the primary action full width, no sideways scroll; « Plus tard »', async ({ page }) => {
  await openAssistant(page);
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/');
  await expect(page.getByText('Étape 1 sur 4')).toBeVisible({ timeout: 10_000 });
  const next = await page.getByRole('button', { name: 'Suivant' }).boundingBox();
  expect(next?.width ?? 0).toBeGreaterThan(300);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
  await page.getByRole('button', { name: 'Plus tard' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText('Étape 1 sur 4')).toHaveCount(0);
});
