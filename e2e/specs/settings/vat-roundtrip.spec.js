// @ts-check
// Test 4/24 — settings/vat-roundtrip (spec §3.4 row 3). Open Settings → General, change
// the VAT rate, save, reload, assert the change persisted. Pins `single-vat-rate` +
// `settings`.
import { test, expect } from '@playwright/test';

test('VAT rate round-trip via Settings → General', async ({ page }) => {
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Paramètres', exact: true })).toBeVisible();

  // The "Taux de TVA (%)" field lives in the VAT section (specs/single-vat-rate.md §6.1).
  // After PR #105 there is only ONE such field (single editable rate).
  const vatField = page.getByLabel(/Taux de TVA/i).first();
  await expect(vatField).toBeVisible({ timeout: 10_000 });

  // Read current, write a distinct value (1 unit higher), save, reload, assert.
  const current = Number(await vatField.inputValue()) || 10;
  const next = current === 12 ? 11 : 12; // never accidentally a no-op
  await vatField.fill(String(next));
  // PageActionBar Save button — icon-only with French tooltip "Enregistrer".
  await page.getByRole('button', { name: /Enregistrer/i }).first().click();

  // Reload and assert persistence.
  await page.reload();
  await expect(page.getByLabel(/Taux de TVA/i).first()).toHaveValue(String(next), { timeout: 10_000 });
});
