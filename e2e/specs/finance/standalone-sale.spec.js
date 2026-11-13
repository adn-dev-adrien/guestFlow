// @ts-check
// « Vente hors séjour » (specs/pricing-components.md rule 53; specs/outside-booking-sas.md rule 8a; owner M4), at 1280 and 390 px: the icon of the Suivi financier bar opens the counter dialog,
// articles marked « Vendable hors séjour » are added with a quantity (one offered), the VAT of the external customer is shown, an invalid e-mail refuses, a partial card payment keeps a
// « Reste à percevoir », the saved screen offers « Nouvelle vente » and the day's list shows the sale. The link needs a connected provider: absent here.
import { test, expect } from '@playwright/test';
import { createCounterArticle } from '../../fixtures/apiSeed';

test.describe.configure({ mode: 'serial' });

const TAG = Date.now().toString(36);
const flat = (text) => text.replace(/ | /g, ' ');

/** @type {{ id: number, title: string }} */
let beer;
/** @type {{ id: number, title: string }} */
let lemonade;

test.beforeAll(async () => {
  beer = await createCounterArticle({ title: `Bière comptoir ${TAG}`, price: 6.5 });
  lemonade = await createCounterArticle({ title: `Limonade comptoir ${TAG}`, price: 4 });
});

for (const [label, viewport] of [['desktop', { width: 1280, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
  test.describe(`vente hors séjour · ${label}`, () => {
    test.use({ viewport });

    test('a counter sale with a partial card payment, then a new one; the day\'s list shows it', async ({ page, request }) => {
      await page.goto('/finance');
      await page.getByRole('button', { name: 'Vente hors séjour' }).first().click();
      const dialog = page.getByRole('dialog', { name: 'Vente hors séjour' });
      await expect(dialog).toBeVisible({ timeout: 15_000 });
      await expect(dialog.getByRole('button', { name: new RegExp(beer.title) })).toBeVisible({ timeout: 15_000 });
      await expect(dialog.getByText('Aucun article ajouté.')).toBeVisible();

      await dialog.getByRole('button', { name: new RegExp(beer.title) }).click();
      await dialog.getByRole('button', { name: new RegExp(beer.title) }).click();
      await dialog.getByRole('button', { name: new RegExp(lemonade.title) }).click();
      const quote = await (await request.post('/api/standalone-sales/quote', {
        data: { lines: [{ articleRef: `option:${beer.id}`, quantity: 2 }, { articleRef: `option:${lemonade.id}`, quantity: 1, offered: true }] },
      })).json();
      expect(quote.document.totals.totalCents).toBe(1300);
      await expect(dialog.getByTestId('sale-total')).toHaveText('17,00 €');
      await dialog.getByRole('listitem').filter({ hasText: lemonade.title }).getByRole('button', { name: 'Offrir' }).click();
      await expect(dialog.getByTestId('sale-total')).toHaveText('13,00 €');
      await expect(dialog.getByText(/^dont TVA 20 % \(client extérieur\) : /)).toBeVisible();

      // The bound of a quantity is the server's refusal, shown under its line; the sale waits for a good quantity.
      const quantity = dialog.getByRole('textbox', { name: `Quantité ${beer.title}` });
      await quantity.fill('100');
      await expect(dialog.getByText('Quantité : 1 à 99.')).toBeVisible();
      await expect(dialog.getByRole('button', { name: /Enregistrer la vente/ })).toBeDisabled();
      await quantity.fill('2');
      await expect(dialog.getByText('Quantité : 1 à 99.')).toHaveCount(0);

      // An invalid e-mail refuses before anything is asked of the server.
      await dialog.getByLabel('E-mail').fill('pas-une-adresse');
      await expect(dialog.getByText('Adresse e-mail invalide.')).toBeVisible();
      await expect(dialog.getByRole('button', { name: /Enregistrer la vente/ })).toBeDisabled();
      await dialog.getByLabel('E-mail').fill('');
      await expect(dialog.getByText('Vente sans client nommé.')).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Envoyer un lien' })).toHaveCount(0);

      await dialog.getByRole('textbox', { name: 'Montant CB' }).fill('5');
      await expect(dialog.getByText('Geste commercial')).toHaveCount(0);
      await dialog.getByRole('button', { name: /Reste à percevoir/ }).click();
      if (label === 'phone') expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await dialog.getByRole('button', { name: /Enregistrer la vente · encaisser/ }).click();

      await expect(dialog.getByText(/^Vente n° \d+ enregistrée · Passage$/)).toBeVisible({ timeout: 15_000 });
      await expect(dialog.getByText('Reste 8,00 €')).toBeVisible();
      await dialog.getByRole('button', { name: 'Nouvelle vente' }).click();
      await expect(dialog.getByText('Aucun article ajouté.')).toBeVisible();
      await dialog.getByRole('button', { name: 'Annuler' }).click();
      await expect(dialog).toBeHidden();

      const list = await (await request.get('/api/standalone-sales')).json();
      const sale = list.sales.find((s) => s.lines.some((l) => l.startsWith(beer.title)));
      expect(sale).toMatchObject({ clientLabel: 'Passage', totalCents: 1300, remainingCents: 800, statusLabel: flat('Reste 8,00 €'), tone: 'due' });
      await page.reload();
      await expect(page.getByRole('region', { name: 'Ventes hors séjour · aujourd’hui' }).getByText(`Vente n° ${sale.id} · Passage`)).toBeVisible({ timeout: 15_000 });
    });
  });
}
