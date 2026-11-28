// specs/guest-app/guest-app-bath-home-scheduling.md (terms at 0 €) and specs/gift-vouchers/gift-voucher-campaigns.md rules 37-38 — scheduling
// at 0 € skips the cart, so the page itself shows the terms the quote says are owed: « Programmer » waits for the tick, the order carries
// `acceptedTerms`, a version changed under the page asks again, and a stay that already accepted is not asked.
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { baseRoutes, renderApp, stubApi } from './guestFixtures';
import {
  BLOCKS, SHOP_BATH, SLOTS, card, meWith, quoteOf,
} from './bathPlanFixtures';

const REQUIRED = [{
  activity: 'resource', label: 'Bain nordique et activités', version: 3, versionId: 31, url: '/terms/resource',
}];
const free = quoteOf(0, [{ key: 'offered', label: 'Offerte · 1 h', amount: 0, amountLabel: '0 €' }]);
const withTerms = (extra) => (body) => ({ ...free(body), ...extra });

const routes = (quote, over = {}) => baseRoutes({
  'GET /me': meWith([card()]),
  'GET /shop': SHOP_BATH,
  'GET /shop/resources/5/slots': SLOTS,
  'GET /shop/resources/5/blocks': BLOCKS,
  'POST /orders/quote': quote,
  'GET /orders/*': { id: 41, lines: [], total: 0, totalLabel: '0 €', status: 'confirmed', statusLabel: 'Confirmée', payment: 'none', collectAt: 'arrival', fulfilment: 'delivery' },
  ...over,
});

const pickSlot = async () => fireEvent.click(await screen.findByText('16 h – 17 h'));
const posted = (calls) => calls.find((c) => c.method === 'POST' && c.path === '/orders');

describe('bath scheduling at 0 € — the terms', () => {
  it('the terms are shown, the button waits for the tick, and the order carries the version accepted', async () => {
    const { calls } = stubApi(routes(withTerms({ termsRequired: REQUIRED }), { 'POST /orders': { orderId: 41, status: 'confirmed' } }));
    renderApp('/bain/programmer/5');
    await pickSlot();
    const box = await screen.findByRole('checkbox', { name: /J'accepte les conditions générales — Bain nordique et activités/ });
    expect(box).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Lire' })).toBeInTheDocument();
    expect(screen.getByText('Acceptez les conditions générales pour commander.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirmer mes séances' })).toBeDisabled();
    fireEvent.click(box);
    const confirm = screen.getByRole('button', { name: 'Confirmer mes séances' });
    await waitFor(() => expect(confirm).toBeEnabled());
    fireEvent.click(confirm);
    await waitFor(() => expect(posted(calls)).toBeTruthy());
    expect(posted(calls).body.acceptedTerms).toEqual([{ activity: 'resource', versionId: 31 }]);
    expect(posted(calls).body.payment).toBe('none');
  });

  it('« Lire » shows the text of the terms', async () => {
    stubApi(routes(withTerms({ termsRequired: REQUIRED }), {
      'GET /terms/resource': { activity: 'resource', label: 'Bain nordique et activités', version: 3, html: '<p>Les présentes conditions…</p>' },
    }));
    renderApp('/bain/programmer/5');
    await pickSlot();
    fireEvent.click(await screen.findByRole('button', { name: 'Lire' }));
    expect(await screen.findByText('Les présentes conditions…')).toBeInTheDocument();
  });

  it('nothing owed: no checkbox, the order carries no acceptedTerms, and an acceptance already given is said', async () => {
    const { calls } = stubApi(routes(withTerms({ termsRequired: [], termsAccepted: [{ activity: 'resource', label: 'Bain nordique et activités', acceptedAtLabel: '3 juillet 2099' }] }), {
      'POST /orders': { orderId: 41, status: 'confirmed' },
    }));
    renderApp('/bain/programmer/5');
    await pickSlot();
    const confirm = await screen.findByRole('button', { name: 'Confirmer mes séances' });
    await waitFor(() => expect(confirm).toBeEnabled());
    expect(screen.queryByRole('checkbox')).toBeNull();
    fireEvent.click(confirm);
    await waitFor(() => expect(posted(calls)).toBeTruthy());
    expect(posted(calls).body).not.toHaveProperty('acceptedTerms');
  });

  it('a version changed under the page (TERMS_OUTDATED): the quote is asked again and the new version is ticked afresh', async () => {
    let quotes = 0;
    stubApi(routes((body) => {
      quotes += 1;
      return { ...free(body), termsRequired: [{ ...REQUIRED[0], versionId: quotes > 1 ? 32 : 31 }] };
    }, {
      'POST /orders': { status: 409, error: { code: 'TERMS_OUTDATED', message: 'Les conditions générales ont changé : relisez-les et acceptez-les pour commander.' } },
    }));
    renderApp('/bain/programmer/5');
    await pickSlot();
    fireEvent.click(await screen.findByRole('checkbox', { name: /J'accepte/ }));
    const confirm = screen.getByRole('button', { name: 'Confirmer mes séances' });
    await waitFor(() => expect(confirm).toBeEnabled());
    fireEvent.click(confirm);
    expect(await screen.findByText(/Les conditions générales ont changé/)).toBeInTheDocument();
    await waitFor(() => expect(quotes).toBeGreaterThan(1));
    await waitFor(() => expect(screen.getByRole('checkbox', { name: /J'accepte/ })).not.toBeChecked());
  });

  it('above 0 € the page asks nothing: the cart does', async () => {
    stubApi(routes(quoteOf(20, [{ key: 'evening', label: 'Supplément soirée', amount: 20, amountLabel: '20 €' }])));
    renderApp('/bain/programmer/5');
    fireEvent.click(await screen.findByText('20 h – 21 h'));
    await screen.findByRole('button', { name: 'Confirmer · 20 €' });
    expect(screen.queryByRole('checkbox')).toBeNull();
  });
});
