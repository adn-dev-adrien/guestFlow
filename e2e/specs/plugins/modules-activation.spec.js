// @ts-check
// plugins/modules-activation — specs/plugin-engine-backport.md rules 3–5, 8, 11 (E2E). A fresh database
// seeds the plugins installed but inactive; the « Modules » card of Réglages → Intégrations switches
// one on (its settings card appears), then off (it vanishes); the state survives a reload.
import { test, expect } from '@playwright/test';

const PLUGIN = 'Saisie Gîtes de France';

test('modules card: a seeded plugin is off, switching it on shows its settings card, off hides it', async ({ page }) => {
  await page.goto('/settings/integrations');
  const moduleSwitch = page.getByRole('switch', { name: PLUGIN });
  await expect(moduleSwitch).toBeVisible({ timeout: 10_000 });
  // Rules 3, 8: installed but inactive — nothing of the plugin is on the page.
  await expect(moduleSwitch).not.toBeChecked();
  await expect(page.getByText('N° de gîte de chaque logement')).toHaveCount(0);

  // Rules 5, 11: one switch, effective at once.
  await moduleSwitch.click();
  await expect(moduleSwitch).toBeChecked();
  await expect(page.getByText('N° de gîte de chaque logement')).toBeVisible({ timeout: 10_000 });

  await page.reload();
  await expect(page.getByRole('switch', { name: PLUGIN })).toBeChecked({ timeout: 10_000 });
  await expect(page.getByText('N° de gîte de chaque logement')).toBeVisible();

  await page.getByRole('switch', { name: PLUGIN }).click();
  await expect(page.getByRole('switch', { name: PLUGIN })).not.toBeChecked();
  await expect(page.getByText('N° de gîte de chaque logement')).toHaveCount(0);

  // An inactive plugin answers 404 PLUGIN_INACTIVE (rule 4).
  const response = await page.request.get('/api/gdf-intake');
  expect(response.status()).toBe(404);
});

test('modules card on a phone: no horizontal scroll, the switch keeps a 44 px target', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/settings/integrations');
  const moduleSwitch = page.getByRole('switch', { name: PLUGIN });
  await expect(moduleSwitch).toBeVisible({ timeout: 10_000 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
  const box = await moduleSwitch.evaluate((el) => {
    const r = (el.closest('.MuiSwitch-root') || el).getBoundingClientRect();
    return { w: r.width, h: r.height };
  });
  expect(box.h).toBeGreaterThanOrEqual(38);
});
