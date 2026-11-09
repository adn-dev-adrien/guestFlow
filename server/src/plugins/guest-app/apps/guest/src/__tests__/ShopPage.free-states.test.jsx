// specs/guest-app.md rules 25, 27, 37quater, 42 — the shop draws the server's free / included / sold-out states and
// never offers what the stay cannot order.
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SHOP, baseRoutes, item, renderApp, stubApi } from './guestFixtures';

const shopWith = (items, over = {}) => ({ ...SHOP, categories: [{ name: 'Boissons', items }], ...over });
const card = (title) => screen.getByText(title).closest('.prod');

describe('shop — free, included, sold out', () => {
  it('rule 25: an item at 0 € reads « Inclus », free units read the server sentence', async () => {
    stubApi(baseRoutes({ 'GET /shop': shopWith([
      item({ id: 1, title: 'Panier', price: 0, priceLabel: 'Inclus', included: true }),
      item({ id: 2, title: 'Jus', freeLeftLabel: '1 offert avec votre séjour' }),
    ]) }));
    renderApp('/boutique');
    await screen.findByText('Panier');
    expect(within(card('Panier')).getByText('Inclus')).toHaveClass('st', 'ok');
    expect(within(card('Jus')).getByText('1 offert avec votre séjour')).toHaveClass('st', 'ok');
  });

  it('rule 37quater: a sold-out article reads « Épuisé » and cannot be added; a low stock says what is left', async () => {
    stubApi(baseRoutes({ 'GET /shop': shopWith([
      item({ id: 1, title: 'Cidre', stock: { soldOut: true, left: 0, leftLabel: null } }),
      item({ id: 2, title: 'Vin', stock: { soldOut: false, left: 2, leftLabel: 'Plus que 2' } }),
    ]) }));
    renderApp('/boutique');
    await screen.findByText('Cidre');
    expect(within(card('Cidre')).getByText('Épuisé')).toBeInTheDocument();
    expect(within(card('Cidre')).queryByRole('button', { name: 'Ajouter Cidre' })).toBeNull();
    expect(within(card('Vin')).getByText('Plus que 2')).toBeInTheDocument();
    expect(within(card('Vin')).getByRole('button', { name: 'Ajouter Vin' })).toBeEnabled();
  });

  it('rule 42: an item the stay can no longer receive says why and has no « + »', async () => {
    stubApi(baseRoutes({ 'GET /shop': shopWith([item({ id: 1, title: 'Plateau', needsStaff: true, unavailableReason: 'Plus disponible pour votre séjour' })]) }));
    renderApp('/boutique');
    await screen.findByText('Plateau');
    expect(within(card('Plateau')).getByText('Plus disponible pour votre séjour')).toBeInTheDocument();
    expect(within(card('Plateau')).queryByRole('button', { name: /Ajouter/ })).toBeNull();
  });

  it('rule 27: a pre-arrival session reads the catalogue only, with the server sentence', async () => {
    stubApi(baseRoutes({ 'GET /shop': shopWith([item({ id: 1, title: 'Cidre' })], { open: false, closedReason: 'Disponible pendant votre séjour', canPayCard: false, canPayNote: false }) }));
    renderApp('/boutique');
    expect(await screen.findByText('Disponible pendant votre séjour')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ajouter Cidre' })).toBeNull();
  });

  it('rule 42: the closed-service banner is the server sentence', async () => {
    stubApi(baseRoutes({ 'GET /shop': shopWith([item()], { service: { openNow: false, nextOpening: '2099-07-08T08:00:00+02:00', bannerLabel: 'Le service reprend demain à 8 h — vous pouvez commander dès maintenant pour plus tard' } }) }));
    renderApp('/boutique');
    expect(await screen.findByText(/Le service reprend demain à 8 h/)).toBeInTheDocument();
  });

  it('rule 32: « + » puts the article in the cart and the bar shows the server total', async () => {
    stubApi(baseRoutes({ 'POST /orders/quote': { lines: [{ kind: 'option', id: 11, title: 'Cidre', quantity: 1, total: 4.5, totalLabel: '4,50 €' }], total: 4.5, totalLabel: '4,50 €', needsDelivery: false } }));
    renderApp('/boutique');
    (await screen.findByRole('button', { name: 'Ajouter Cidre' })).click();
    await waitFor(() => expect(document.querySelector('.cartbar')).toHaveTextContent('4,50 €'));
    expect(document.querySelector('.cartbar .n')).toHaveTextContent('1');
  });
});
