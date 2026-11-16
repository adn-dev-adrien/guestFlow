// @ts-check
// specs/outside-booking-sas.md rule 37 — Options & ressources › « Proposés à l'arrivée » at 1280 and 390 px: one card per resource sold by the hour, an article added from the catalogue,
// reordered with ↑ / ↓, saved with the bar's « Enregistrer »; the server holds the list in that order; no sideways scroll.
// Reading 2026-11-16 (loop t4 UI4-1, smoke rule 19): a disabled « Enregistrer » is not a save signal (it flips with `saving`, before the PUT
// is answered) — the test waits for the PUT's answer, then reads the server back with its own API budget, polling.
import { test, expect } from '../../fixtures/test.js';
import { createHourlyResource, createCounterArticle } from '../../fixtures/apiSeed';
import { API_TIMEOUT } from '../../clientUrl.js';

test.describe.configure({ mode: 'serial' });

const TAG = Date.now().toString(36);

for (const [label, viewport] of [['desktop', { width: 1280, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
  test.describe(`proposés à l'arrivée · ${label}`, () => {
    test.use({ viewport });

    test('add two articles, reorder them, save: the server keeps the order', async ({ page, request }) => {
      const bath = await createHourlyResource({ name: `Bain proposés ${label} ${TAG}` });
      const first = await createCounterArticle({ title: `Premier ${label} ${TAG}`, price: 5 });
      const second = await createCounterArticle({ title: `Second ${label} ${TAG}`, price: 6 });

      await page.goto('/parametres/options-ressources?tab=suggested');
      const card = page.getByRole('region', { name: new RegExp(`Bain proposés ${label} ${TAG}`) });
      await expect(card).toBeVisible({ timeout: 15_000 });
      await expect(card.getByText('Aucun article proposé.')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Enregistrer' })).toBeDisabled();

      for (const article of [first, second]) {
        await card.getByRole('button', { name: 'Ajouter un article' }).click();
        await card.getByRole('textbox', { name: 'Chercher un article' }).fill(article.title);
        await card.getByRole('button', { name: article.title }).click();
      }
      await card.getByRole('button', { name: `Monter ${second.title}` }).click();
      await expect(card.getByRole('listitem').first()).toContainText(second.title);
      if (label === 'phone') expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

      const [saved] = await Promise.all([
        page.waitForResponse((r) => r.request().method() === 'PUT' && r.url().includes(`/api/settings/suggested-articles/resource/${bath.id}`), { timeout: API_TIMEOUT }),
        page.getByRole('button', { name: 'Enregistrer' }).click(),
      ]);
      expect(saved.ok()).toBe(true);
      await expect(page.getByRole('button', { name: 'Enregistrer' })).toBeDisabled({ timeout: 10_000 });
      const readBack = async () => {
        const settings = await (await request.get('/api/settings/suggested-articles', { timeout: API_TIMEOUT })).json();
        const context = settings.kinds.find((k) => k.kind === 'resource').contexts.find((c) => String(c.id) === String(bath.id));
        return { refs: context.articleRefs, labels: context.articles.map((a) => a.label) };
      };
      await expect.poll(readBack, { timeout: API_TIMEOUT }).toEqual({
        refs: [`option:${second.id}`, `option:${first.id}`],
        labels: [second.title, first.title],
      });
    });
  });
}
