// specs/gift-voucher-campaigns.md rules 37-38 — the terms of the activity the cart holds: a checkbox « J'accepte les conditions générales — … »
// with a link to the text before « Commander »; the order carries `acceptedTerms`; once accepted for the version the quote says so and the
// checkbox is no longer asked; nothing is asked when the server names nothing.
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { baseRoutes, renderApp, stubApi } from './guestFixtures';

const LINE = { kind: 'option', id: 11, title: 'Cidre', quantity: 2, total: 9, totalLabel: '9 €' };
const REQUIRED = [{
  activity: 'resource', label: 'Bain nordique et activités', version: 3, versionId: 31, url: '/terms/resource',
}];
const QUOTE = { lines: [LINE], total: 9, totalLabel: '9 €', needsDelivery: false };

function seedCart() {
  window.localStorage.setItem('gf-guest', JSON.stringify({ 'cart:1:2099-07-06T16:00:00+02:00': { lines: [{ kind: 'option', id: 11, quantity: 2 }], meta: { 'option:11': { title: 'Cidre', max: 10 } } } }));
}

describe('cart — the terms of the activity', () => {
  it('rule 37: the box is asked, « Payer » waits for it, and the order carries the version accepted', async () => {
    seedCart();
    const { calls } = stubApi(baseRoutes({
      'POST /orders/quote': { ...QUOTE, termsRequired: REQUIRED },
      'POST /orders': { orderId: 7, status: 'confirmed' },
      'GET /orders/7': { id: 7, createdAt: '2099-07-07T10:00:00.000Z', lines: [], totalLabel: '9 €', payment: 'card', status: 'confirmed', statusLabel: 'Confirmée', promise: '' },
    }));
    renderApp('/panier');
    const box = await screen.findByRole('checkbox', { name: /J'accepte les conditions générales — Bain nordique et activités/ });
    expect(box).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Payer 9 €' })).toBeDisabled();
    expect(screen.getByText('Acceptez les conditions générales pour commander.')).toBeInTheDocument();
    fireEvent.click(box);
    const pay = screen.getByRole('button', { name: 'Payer 9 €' });
    await waitFor(() => expect(pay).toBeEnabled());
    fireEvent.click(screen.getByRole('radio', { name: /Ajouter à ma note/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Ajouter à ma note · 9 €' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/orders')).toBe(true));
    expect(calls.find((c) => c.method === 'POST' && c.path === '/orders').body.acceptedTerms).toEqual([{ activity: 'resource', versionId: 31 }]);
  });

  it('rule 37: « Lire » shows the text of the activity', async () => {
    seedCart();
    stubApi(baseRoutes({
      'POST /orders/quote': { ...QUOTE, termsRequired: REQUIRED },
      'GET /terms/resource': { activity: 'resource', label: 'Bain nordique et activités', version: 3, html: '<h2>1. Objet</h2><p>Les présentes conditions…</p>' },
    }));
    renderApp('/panier');
    fireEvent.click(await screen.findByRole('button', { name: 'Lire' }));
    expect(await screen.findByText('Les présentes conditions…')).toBeInTheDocument();
  });

  it('rule 37: accepted for this version → no box, a small dated note, nothing sent', async () => {
    seedCart();
    const { calls } = stubApi(baseRoutes({
      'POST /orders/quote': { ...QUOTE, termsAccepted: [{ activity: 'resource', label: 'Bain nordique et activités', version: 3, acceptedAtLabel: '18/11/2026' }] },
      'POST /orders': { orderId: 8, status: 'confirmed' },
      'GET /orders/8': { id: 8, createdAt: '2099-07-07T10:00:00.000Z', lines: [], totalLabel: '9 €', payment: 'note', status: 'confirmed', statusLabel: 'Sur votre note', promise: '' },
    }));
    renderApp('/panier');
    expect(await screen.findByText('Conditions acceptées le 18/11/2026')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: /Ajouter à ma note/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Ajouter à ma note · 9 €' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/orders')).toBe(true));
    expect(calls.find((c) => c.method === 'POST' && c.path === '/orders').body.acceptedTerms).toBeUndefined();
  });

  it('rule 37: nothing named by the server (nothing published) → nothing asked', async () => {
    seedCart();
    stubApi(baseRoutes({ 'POST /orders/quote': QUOTE }));
    renderApp('/panier');
    expect(await screen.findByRole('button', { name: 'Payer 9 €' })).toBeEnabled();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('rule 37: a version changed under the cart (TERMS_OUTDATED) → the quote is asked again and the new version is ticked afresh', async () => {
    seedCart();
    let quotes = 0;
    stubApi(baseRoutes({
      'POST /orders/quote': () => { quotes += 1; return { ...QUOTE, termsRequired: [{ ...REQUIRED[0], versionId: quotes > 1 ? 32 : 31 }] }; },
      'POST /orders': { status: 409, error: { code: 'TERMS_OUTDATED', message: 'Les conditions générales ont changé : relisez-les et acceptez-les pour commander.' } },
    }));
    renderApp('/panier');
    fireEvent.click(await screen.findByRole('checkbox', { name: /J'accepte/ }));
    fireEvent.click(screen.getByRole('radio', { name: /Ajouter à ma note/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Ajouter à ma note · 9 €' }));
    expect(await screen.findByText(/Les conditions générales ont changé/)).toBeInTheDocument();
    await waitFor(() => expect(quotes).toBeGreaterThan(1));
    await waitFor(() => expect(screen.getByRole('checkbox', { name: /J'accepte/ })).not.toBeChecked());
  });
});
