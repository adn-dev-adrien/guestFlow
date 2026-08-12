// @ts-check
// settings/fiscal-year-roundtrip — specs/fiscal-year-and-nights-sold.md §7 (E2E). Set the accounting
// closing month, save, reload, assert it persisted, then check /finance reads its exercise from it.
import { test, expect } from '@playwright/test';

test('closing month round-trip via Settings → General, then applied on /finance', async ({ page }) => {
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Paramètres', exact: true })).toBeVisible();

  // « Exercice comptable » card — a Select, not a text field (specs §6.1).
  const monthSelect = page.getByRole('combobox', { name: /Mois de clôture/i });
  await expect(monthSelect).toBeVisible({ timeout: 10_000 });

  // Pick a month distinct from the stored one so the save is never a no-op.
  const current = (await monthSelect.textContent()) || '';
  const next = current.includes('Septembre') ? 'Juin' : 'Septembre';
  await monthSelect.click();
  await page.getByRole('option', { name: next, exact: true }).click();
  // The hint recomputes live from the picked month.
  await expect(page.getByText(/L'exercice ira du 1er /)).toBeVisible();

  // PageActionBar Save button — icon-only with French tooltip "Enregistrer".
  await page.getByRole('button', { name: /Enregistrer/i }).first().click();

  await page.reload();
  await expect(page.getByRole('combobox', { name: /Mois de clôture/i }))
    .toHaveText(next, { timeout: 10_000 });

  // …and the Suivi financier now bounds its exercise on that month: closing September ⇒ 1 Oct → 30 Sep.
  await page.goto('/finance');
  const exerciseSelect = page.getByRole('combobox', { name: 'Exercice' });
  await expect(exerciseSelect).toBeVisible({ timeout: 15_000 });
  const expectedBounds = next === 'Septembre' ? /du 01\/10\/\d{4} au 30\/09\/\d{4}/ : /du 01\/07\/\d{4} au 30\/06\/\d{4}/;
  await expect(page.getByText(expectedBounds)).toBeVisible();
});
