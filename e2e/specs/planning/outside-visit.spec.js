// @ts-check
// specs/outside-booking-sas.md §7 — the mini SAS of an outside client, at 1280 and 390 px: a walk-in session booked for today, « Arrivée » from the resource planning, two
// drinks added from « Proposés à l'arrivée » (one offered), a partial card payment with « Reste à percevoir », the card reading « Reste », the reopened visit paying the reste, the invoice
// block saying Qonto is not connected. The Qonto link cannot be exercised here (the E2E database never connects a provider): the block must be absent, and nothing is e-mailed.
import { test, expect } from '@playwright/test';
import { createHourlyResource, createCounterArticle } from '../../fixtures/apiSeed';

test.describe.configure({ mode: 'serial' });

const TAG = Date.now().toString(36);
const todayParis = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());
const euros = (cents) => `${(cents / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`.replace(/ | /g, ' ');
const flat = (text) => text.replace(/ | /g, ' ');

/** @type {{ beer: { id: number, title: string }, lemonade: { id: number, title: string } }} */
let drinks;

test.beforeAll(async () => {
  drinks = {
    beer: await createCounterArticle({ title: `Bière visite ${TAG}`, price: 6.5 }),
    lemonade: await createCounterArticle({ title: `Limonade visite ${TAG}`, price: 4 }),
  };
});

// One visit per viewport: a bath of its own (one slot per resource), the suggested list set through the settings route, a walk-in booked on today.
async function seedVisit(request, label) {
  const bath = await createHourlyResource({ name: `Bain visite ${label} ${TAG}` });
  const listed = await request.put(`/api/settings/suggested-articles/resource/${bath.id}`, { data: { articleRefs: [`option:${drinks.beer.id}`, `option:${drinks.lemonade.id}`] } });
  expect(listed.status()).toBe(200);
  const booked = await request.post('/api/resource-bookings', {
    data: { resourceId: bath.id, date: todayParis(), startTime: '12:00', endTime: '13:00', clientName: `Visiteur ${label} ${TAG}`, notes: '' },
  });
  expect(booked.ok()).toBeTruthy();
  const { id } = await booked.json();
  return { bath, id, name: `Visiteur ${label} ${TAG}` };
}

for (const [label, viewport] of [['desktop', { width: 1280, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
  test.describe(`mini SAS · ${label}`, () => {
    test.use({ viewport });

    test('the visit: two drinks (one offered), a partial card payment with a reste, the card says « Reste », the reopened visit pays it', async ({ page, request }) => {
      const { id, name } = await seedVisit(request, label);
      await page.goto(`/resource-planning?arrival=${id}`);
      const dialog = page.getByRole('dialog', { name: new RegExp(`Arrivée · ${name}`) });
      await expect(dialog).toBeVisible({ timeout: 15_000 });
      await expect(dialog.getByText('Sa séance')).toBeVisible();
      await expect(dialog.getByRole('button', { name: new RegExp(drinks.beer.title) })).toBeVisible();
      // The Qonto link needs a connected provider: none here, so no such block (outside rules 39).
      await expect(dialog.getByRole('button', { name: 'Envoyer un lien' })).toHaveCount(0);

      await dialog.getByRole('button', { name: new RegExp(drinks.beer.title) }).click();
      await dialog.getByRole('button', { name: new RegExp(drinks.beer.title) }).click();
      await dialog.getByRole('button', { name: new RegExp(drinks.lemonade.title) }).click();
      const list = dialog.getByRole('list', { name: 'Proposés à l’arrivée' });
      await expect(list.getByText('2 × 6,50 €')).toBeVisible();
      await list.getByRole('listitem').filter({ hasText: drinks.lemonade.title }).getByRole('button', { name: 'Offrir' }).click();
      await expect(list.locator('del', { hasText: '4,00 €' })).toBeVisible();

      // The figures are the server's: the reste on screen is the quote's.
      const quoted = await (await request.post(`/api/resource-bookings/${id}/visit/quote`, {
        data: { extras: [{ articleRef: `option:${drinks.beer.id}`, quantity: 2, offered: false }, { articleRef: `option:${drinks.lemonade.id}`, quantity: 1, offered: true }] },
      })).json();
      await expect(dialog.getByTestId('remaining')).toHaveText(euros(quoted.totals.remainingCents));
      await expect(dialog.getByText(/^dont TVA 20 % : /)).toBeVisible();

      // Qonto is not connected: the payment is taken, the invoice block says so.
      await expect(dialog.getByText(/Facturation Qonto non connectée/)).toBeVisible();

      // A card payment of 10 € only: the gap is a « Reste à percevoir », « Geste commercial » is not offered here.
      await dialog.getByRole('textbox', { name: 'Montant CB' }).fill('10');
      await expect(dialog.getByRole('button', { name: /Reste à percevoir/ })).toBeVisible();
      await expect(dialog.getByText('Geste commercial')).toHaveCount(0);
      await dialog.getByRole('button', { name: /Reste à percevoir/ }).click();

      if (label === 'phone') {
        await expect(dialog.getByTestId('sticky-remaining')).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        const buttons = await dialog.locator('button').all();
        await expect(buttons[buttons.length - 1]).toHaveText('Valider l’arrivée');
        const box = await buttons[buttons.length - 1].boundingBox();
        expect(box && box.height >= 44).toBeTruthy();
      }

      await dialog.getByRole('button', { name: 'Valider l’arrivée' }).click();
      await expect(dialog).toBeHidden({ timeout: 15_000 });

      const booking = await (await request.get(`/api/resource-bookings/${id}`)).json();
      expect(booking.cardState.state).toBe('remaining');
      expect(booking.cardState.label).toBe(`Reste ${euros(quoted.totals.remainingCents - 1000)}`);
      await page.goto('/planning');
      await expect(page.getByText(booking.cardState.label, { exact: true }).first()).toBeVisible({ timeout: 15_000 });

      // Reopened: it starts on « Pas maintenant », « Déjà payé » is the 10 €, and the reste is collected.
      await page.goto(`/resource-planning?arrival=${id}`);
      const again = page.getByRole('dialog', { name: new RegExp(`Arrivée · ${name}`) });
      await expect(again.getByText('Déjà payé')).toBeVisible({ timeout: 15_000 });
      await expect(again.getByRole('button', { name: 'Pas maintenant' })).toHaveAttribute('aria-pressed', 'true');
      await again.getByRole('button', { name: 'Encaisser', exact: true }).click();
      await again.getByRole('button', { name: 'Enregistrer', exact: true }).click();
      await expect(again).toBeHidden({ timeout: 15_000 });
      const paid = await (await request.get(`/api/resource-bookings/${id}`)).json();
      expect(paid.cardState.state).toBe('paid');
      const visit = await (await request.get(`/api/resource-bookings/${id}/visit`)).json();
      expect(visit.totals.remainingCents).toBe(0);
      expect(flat(JSON.stringify(visit.history))).toContain('encaissés');
    });

    test('« Client absent » closes a visit with no arrival: the card reads « Absent » and the mini SAS is read-only', async ({ page, request }) => {
      const { id, name } = await seedVisit(request, `${label}-absent`);
      await page.goto('/resource-planning');
      const res = await request.post(`/api/resource-bookings/${id}/no-show`);
      expect(res.status()).toBe(200);
      const booking = await (await request.get(`/api/resource-bookings/${id}`)).json();
      expect(booking.cardState).toMatchObject({ state: 'absent', label: 'Absent' });
      await page.goto(`/resource-planning?arrival=${id}`);
      const dialog = page.getByRole('dialog', { name: new RegExp(`Arrivée · ${name}`) });
      await expect(dialog.getByText('Client absent : la visite est close.')).toBeVisible({ timeout: 15_000 });
      await expect(dialog.getByRole('button', { name: 'Valider l’arrivée' })).toHaveCount(0);
      await expect(dialog.getByRole('button', { name: 'Fermer' })).toBeEnabled();
    });
  });
}
