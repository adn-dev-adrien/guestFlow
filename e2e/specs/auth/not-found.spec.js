// @ts-check
// DS phase 2 (specs/ds-components.md §3.4) — an unknown URL used to render a BLANK main area
// (no catch-all route). It now shows the shared EmptyState-based « Page introuvable » screen
// with a way back to the dashboard.
import { test, expect } from '@playwright/test';

test('unknown URL renders the « Page introuvable » screen with a dashboard CTA', async ({ page }) => {
  await page.goto('/cette-page-nexiste-pas');
  await expect(page.getByText('Page introuvable')).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Retour au tableau de bord' }).click();
  await expect(page.getByRole('heading', { name: 'Tableau de bord' }).first()).toBeVisible();
});

// specs/plugins-phase-p-productisation.md rule 42 — an unknown address under an active plugin's page
// is a plain « Page introuvable », never « Plugin inactif ».
test('an unknown address under an active plugin page reads « Page introuvable »', async ({ page }) => {
  await page.goto('/comptabilite/zzz');
  await expect(page.getByText('Page introuvable')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Plugin inactif')).toHaveCount(0);
});
