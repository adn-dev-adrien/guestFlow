// @ts-check
// specs/ds-components.md rules 19-21 — review #8 (m-7 + the systemic touch targets), measured in a
// real browser. On a phone the settings bars read « Syst… » with Save over Cancel; at 900 px the
// title of a bar with a centre node shrank to « P. »; 370 icon buttons were under 44 px. Review of
// PR #700: six 39 px toggles on « Suivi financier », « Planning ressou… » with 120 px free.
import { test, expect } from '@playwright/test';
import { createHourlyResource } from '../../fixtures/apiSeed';

/** Visible controls under 44 × 44, outside text fields (their field is the target). */
const smallTargets = (page) => page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll('main .MuiIconButton-root, main .MuiButton-root, main .MuiCheckbox-root, main .MuiRadio-root, main .MuiToggleButton-root')) {
    if (el.closest('.MuiInputAdornment-root, .MuiAutocomplete-endAdornment')) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || getComputedStyle(el).visibility === 'hidden') continue;
    if (r.width < 43.5 || r.height < 43.5) out.push(`${el.getAttribute('aria-label') || el.textContent.trim()} ${Math.round(r.width)}x${Math.round(r.height)}`);
  }
  return out;
});

test.describe('phone (390 px, touch)', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('rules 19-20 — a settings bar keeps its title readable and Save beside Cancel, both 44 × 44', async ({ page }) => {
    await page.goto('/settings/systeme');
    const title = page.getByRole('heading', { name: 'Système', exact: true });
    await expect(title).toBeVisible({ timeout: 10_000 });
    const truncated = await title.evaluate((el) => el.scrollWidth > el.clientWidth);
    expect(truncated).toBe(false);
    const save = await page.getByRole('button', { name: 'Enregistrer' }).boundingBox();
    const cancel = await page.getByRole('button', { name: 'Annuler' }).boundingBox();
    expect([save.width, save.height, cancel.width, cancel.height]).toEqual([44, 44, 44, 44]);
    expect(Math.abs(save.y - cancel.y)).toBeLessThan(1);
  });

  test('rule 21 — no tap target under 44 px on the dashboard, the planning and the finance page', async ({ page }) => {
    for (const url of ['/', '/planning', '/finance']) {
      await page.goto(url);
      // On a phone the page heading is the top bar's — the wordmark on the home
      // (specs/shell-and-home-day-first.md rule 15); wait for it, then for the page's data.
      await expect(page.locator('header h1')).toBeVisible({ timeout: 10_000 });
      await page.waitForLoadState('networkidle');
      expect([url, await smallTargets(page)]).toEqual([url, []]);
    }
  });

  test('rule 19 — a bar with a hidden centre leaves its title the room: « Planning ressources » whole', async ({ page }) => {
    await createHourlyResource({ name: 'Bain nordique barre étroite' });
    await page.goto('/resource-planning');
    const title = page.getByRole('heading', { name: 'Planning ressources' });
    await expect(title).toBeVisible({ timeout: 10_000 });
    expect(await title.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(false);
    // The actions box is as wide as its buttons: the rest of the row is the title's.
    const slack = await page.getByTestId('page-action-bar-actions').first().evaluate((box) => {
      const kids = [...box.children].map((c) => c.getBoundingClientRect()).filter((r) => r.width);
      const used = Math.max(...kids.map((r) => r.right)) - Math.min(...kids.map((r) => r.left));
      return box.getBoundingClientRect().width - used;
    });
    expect(slack).toBeLessThan(2);
  });
});

test.describe('tablet (900 px)', () => {
  test.use({ viewport: { width: 900, height: 1000 } });

  test('rule 19 — the calendar\'s centre node takes a second row instead of crushing the page title', async ({ page }) => {
    await page.goto('/calendar');
    const title = page.getByRole('heading', { name: 'Calendrier' });
    await expect(title).toBeVisible({ timeout: 10_000 });
    expect(await title.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(false);
    const titleBox = await title.boundingBox();
    const centre = await page.getByTestId('page-action-bar-center').first().boundingBox();
    expect(centre.y).toBeGreaterThan(titleBox.y + titleBox.height - 1);
  });
});
