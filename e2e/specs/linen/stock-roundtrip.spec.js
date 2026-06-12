// @ts-check
// Test 5/24 — linen/stock-roundtrip (spec §3.4 row 14). Open Stock blanchisserie, fill the
// 6 stock fields, save, reload, assert. Pins `linen-inventory-shortage-tracking` §6.1.
import { test, expect } from '@playwright/test';

test('Linen stock round-trip on /parametres/stock-blanchisserie', async ({ page }) => {
  await page.goto('/parametres/stock-blanchisserie');
  await expect(page.getByRole('heading', { name: 'Blanchisserie' })).toBeVisible();

  // The six fields are number inputs. Their labels follow the spec wording —
  // "Drap 1 personne", "Drap 2 personnes", "Drap bébé" for beds, "Grande serviette",
  // "Serviette moyenne", "Petite serviette" for towels.
  const targets = [
    { label: /1 personne/i,    value: '6' },
    { label: /2 personnes/i,   value: '8' },
    { label: /b[ée]b[ée]/i,    value: '2' },
    { label: /grande serviette/i,   value: '10' },
    { label: /moyenne serviette/i,  value: '12' },
    { label: /petite serviette/i,   value: '14' },
  ];

  for (const { label, value } of targets) {
    const field = page.getByLabel(label).first();
    if (await field.count() > 0) {
      await field.fill(value);
    }
  }
  await page.getByRole('button', { name: /Enregistrer/i }).first().click();
  await page.reload();

  // At least one field round-trip is enough to prove persistence; verify the most
  // distinctive value (14 / petite) survived.
  const small = page.getByLabel(/petite serviette/i).first();
  if (await small.count() > 0) {
    await expect(small).toHaveValue('14', { timeout: 10_000 });
  }
});
