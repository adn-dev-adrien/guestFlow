// specs/guest-app.md rule 102 (fifth pass, 2026-11-10) — the bath picker follows the shop's own judge: when the server answers that
// the stay cannot order yet, no day and no slot is drawn, the server sentence is said instead, and nothing can reach the cart.
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  SHOP, baseRoutes, item, renderApp, stubApi,
} from './guestFixtures';

const BATH = item({ kind: 'resource', id: 5, title: 'Bain nordique', scheduling: 'hourly', priceLabel: '30 €' });

describe('bath picker — shop closed (rule 102)', () => {
  it('says the server sentence and draws no slot', async () => {
    stubApi(baseRoutes({
      'GET /shop': { ...SHOP, categories: [{ name: 'Bien-être', items: [BATH] }], open: false },
      'GET /shop/resources/5/slots': { open: false, closedReason: 'Pour ce séjour, les commandes ouvrent à votre arrivée.', days: [] },
    }));
    renderApp('/boutique/bain/5');
    expect(await screen.findByText('Pour ce séjour, les commandes ouvrent à votre arrivée.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Ajouter/ })).toBeNull();
    expect(document.querySelector('.sticky-cta')).toBeNull();
  });
});
