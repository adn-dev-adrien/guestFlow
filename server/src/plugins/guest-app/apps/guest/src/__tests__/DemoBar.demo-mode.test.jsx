// specs/guest-app/guest-app-demo-mode.md rules 12, 16, 17, 18 — the demo bar is shown for a demo session only; its sheet switches the lodging and the
// moment through the switch endpoint and reads the session again; the confirmation of a simulated order says nothing was ordered or paid; the gate
// sheet shows the fictitious keypad code; the words follow the app's language.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
  ME_STAY, baseRoutes, renderApp, stubApi,
} from './guestFixtures';

const LODGINGS = [{ propertyId: 1, name: 'La Granja' }, { propertyId: 2, name: 'L’Estiva' }];
const demoMe = (over = {}) => ({
  ...ME_STAY,
  demo: { moment: 'stay', lodgings: LODGINGS },
  ...over,
});

const barOf = () => screen.getByRole('button', { name: /Démo ·/ });

describe('DemoBar (rules 16, 18)', () => {
  it('is absent for a real session', async () => {
    stubApi(baseRoutes());
    renderApp('/');
    await screen.findByText('Bonjour Marie');
    expect(screen.queryByRole('button', { name: /Démo ·/ })).toBeNull();
  });

  it('shows « Démo · lodging · moment » on a demo session', async () => {
    stubApi(baseRoutes({ 'GET /me': demoMe() }));
    renderApp('/');
    const bar = await screen.findByRole('button', { name: /Démo ·/ });
    expect(bar).toHaveTextContent('Démo · La Granja · Pendant le séjour');
    expect(bar).toHaveAttribute('aria-haspopup', 'dialog');
  });

  it('follows the app’s language', async () => {
    stubApi(baseRoutes({ 'GET /me': demoMe({ language: 'en' }) }));
    renderApp('/');
    expect(await screen.findByRole('button', { name: /Demo ·/ })).toHaveTextContent('Demo · La Granja · During the stay');
  });

  it('opens a sheet with the lodgings and the moments, the current ones checked', async () => {
    stubApi(baseRoutes({ 'GET /me': demoMe() }));
    renderApp('/');
    await userEvent.click(await screen.findByRole('button', { name: /Démo ·/ }));
    const lodgings = within(screen.getByRole('radiogroup', { name: 'Logement' }));
    expect(lodgings.getByRole('radio', { name: 'La Granja' })).toHaveAttribute('aria-checked', 'true');
    expect(lodgings.getByRole('radio', { name: 'L’Estiva' })).toHaveAttribute('aria-checked', 'false');
    const moments = within(screen.getByRole('radiogroup', { name: 'Moment' }));
    expect(moments.getByRole('radio', { name: 'Pendant le séjour' })).toHaveAttribute('aria-checked', 'true');
    expect(moments.getAllByRole('radio').map((r) => r.textContent)).toEqual(['Avant l’arrivée', 'Pendant le séjour', 'Après le départ']);
  });

  it('a lodging choice calls the switch with the current moment, reads the session again and closes the sheet', async () => {
    let current = demoMe();
    const { calls } = stubApi(baseRoutes({
      'GET /me': () => current,
      'POST /sessions/demo/switch': (body) => {
        current = demoMe({ lodging: { id: body.propertyId, name: 'L’Estiva', slug: 'l-estiva' } });
        return current;
      },
    }));
    renderApp('/');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Démo ·/ }));
    await user.click(screen.getByRole('radio', { name: 'L’Estiva' }));
    await waitFor(() => expect(calls.find((c) => c.path === '/sessions/demo/switch').body).toEqual({ propertyId: 2, moment: 'stay' }));
    await waitFor(() => expect(barOf()).toHaveTextContent('Démo · L’Estiva · Pendant le séjour'));
    expect(screen.queryByRole('radiogroup', { name: 'Logement' })).toBeNull();
    expect(calls.filter((c) => c.method === 'GET' && c.path === '/me').length).toBeGreaterThan(1);
  });

  it('a moment choice calls the switch with the current lodging', async () => {
    let current = demoMe();
    const { calls } = stubApi(baseRoutes({
      'GET /me': () => current,
      'POST /sessions/demo/switch': (body) => {
        current = demoMe({ demo: { moment: body.moment, lodgings: LODGINGS } });
        return current;
      },
    }));
    renderApp('/');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Démo ·/ }));
    await user.click(screen.getByRole('radio', { name: 'Après le départ' }));
    await waitFor(() => expect(calls.find((c) => c.path === '/sessions/demo/switch').body).toEqual({ propertyId: 1, moment: 'ended' }));
    await waitFor(() => expect(barOf()).toHaveTextContent('Démo · La Granja · Après le départ'));
  });

  it('a refused switch says so and keeps the sheet open', async () => {
    stubApi(baseRoutes({
      'GET /me': demoMe(),
      'POST /sessions/demo/switch': { status: 400, error: { code: 'INVALID_INPUT', message: 'Choisissez un logement et un moment du séjour.' } },
    }));
    renderApp('/');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Démo ·/ }));
    await user.click(screen.getByRole('radio', { name: 'L’Estiva' }));
    expect(await screen.findByText('Choisissez un logement et un moment du séjour.')).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Logement' })).toBeInTheDocument();
  });
});

describe('demo orders and gate (rules 12, 17)', () => {
  const ORDER = {
    id: 3,
    demo: true,
    status: 'confirmed',
    statusLabel: 'Sur votre note',
    lines: [{ label: '2 × Cidre', totalLabel: '12 €' }],
    total: 12,
    totalLabel: '12 €',
    promise: null,
    createdAt: '2099-07-07T10:00:00Z',
  };

  it('the confirmation says nothing was ordered or paid, and the order chip reads « Démo »', async () => {
    stubApi(baseRoutes({ 'GET /me': demoMe(), 'GET /orders/3': ORDER }));
    renderApp('/commandes/3?confirmation=1');
    expect(await screen.findByText('Démo : rien n’a été commandé ni payé.')).toBeInTheDocument();
    const card = screen.getByRole('article');
    expect(within(card).getByText('Démo')).toBeInTheDocument();
    expect(within(card).queryByText('Sur votre note')).toBeNull();
  });

  it('a real order keeps its own chip and no demo line', async () => {
    stubApi(baseRoutes({ 'GET /orders/3': { ...ORDER, demo: undefined } }));
    renderApp('/commandes/3?confirmation=1');
    expect(await screen.findByText('Sur votre note')).toBeInTheDocument();
    expect(screen.queryByText('Démo : rien n’a été commandé ni payé.')).toBeNull();
  });

  it('the gate tile of a demo opens the in-app sheet with the keypad code, never a window', async () => {
    const me = demoMe({ tiles: ME_STAY.tiles.map((t) => (t.key === 'gate' ? { ...t, state: 'demo', code: '1234' } : t)) });
    stubApi(baseRoutes({ 'GET /me': me }));
    const opened = [];
    window.open = (...args) => { opened.push(args); return null; };
    renderApp('/');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Portail/ }));
    expect(await screen.findByText('Ici, le voyageur ouvre le portail.')).toBeInTheDocument();
    expect(screen.getByLabelText('Code du clavier')).toHaveTextContent('1234');
    expect(screen.getByText('Démo : aucun portail n’est ouvert.')).toBeInTheDocument();
    expect(opened).toEqual([]);
  });
});

describe('the demo link on the device (rules 1, 3, 4)', () => {
  const device = () => JSON.parse(window.localStorage.getItem('gf-guest') || '{}');

  it('/d/:token opens the demo session, keeps the link and shows the bar', async () => {
    const { calls } = stubApi(baseRoutes({ 'GET /me': demoMe(), 'POST /sessions/demo': { mode: 'stay', lodging: ME_STAY.lodging } }));
    renderApp('/d/demo-tok');
    expect(await screen.findByRole('button', { name: /Démo ·/ })).toBeInTheDocument();
    expect(calls.find((c) => c.path === '/sessions/demo').body).toEqual({ demoToken: 'demo-tok' });
    expect(device().demoToken).toBe('demo-tok');
  });

  it('a dead demo session is reopened from the stored demo link, without a new scan', async () => {
    window.localStorage.setItem('gf-guest', JSON.stringify({ demoToken: 'demo-tok' }));
    let dead = true;
    const { calls } = stubApi(baseRoutes({
      'GET /me': () => (dead ? { status: 401, error: { code: 'SESSION_EXPIRED', message: 'expired' } } : demoMe()),
      'POST /sessions/demo': () => { dead = false; return { mode: 'stay', lodging: ME_STAY.lodging }; },
    }));
    renderApp('/');
    expect(await screen.findByRole('button', { name: /Démo ·/ })).toBeInTheDocument();
    expect(calls.filter((c) => c.path === '/sessions/demo')).toHaveLength(1);
  });

  it('a regenerated link is forgotten and the generic screen shows', async () => {
    window.localStorage.setItem('gf-guest', JSON.stringify({ demoToken: 'old' }));
    stubApi(baseRoutes({
      'GET /me': { status: 401, error: { code: 'SESSION_EXPIRED' } },
      'GET /lodging': { status: 401, error: { code: 'SESSION_EXPIRED' } },
      'POST /sessions/demo': { status: 404, error: { code: 'CODE_NOT_FOUND', message: 'Ce code n’est pas reconnu.' } },
    }));
    renderApp('/');
    expect(await screen.findByRole('heading', { name: 'Ce code n’est pas reconnu.' })).toBeInTheDocument();
    await waitFor(() => expect(device().demoToken).toBeUndefined());
  });

  it('no lodging in the app: the demo link says so', async () => {
    stubApi({ 'POST /sessions/demo': { status: 404, error: { code: 'NO_LODGING', message: 'Aucun logement n’est ouvert dans l’application.' } } });
    // The address bar is the demo link, as on a phone: the session does not read `/me` before the link is exchanged.
    window.history.pushState({}, '', '/d/demo-tok');
    try {
      renderApp('/d/demo-tok');
      expect(await screen.findByText('Aucun logement n’est ouvert dans l’application.')).toBeInTheDocument();
    } finally {
      window.history.pushState({}, '', '/');
    }
  });

  it('opening a stay link afterwards drops the demo link from the device', async () => {
    window.localStorage.setItem('gf-guest', JSON.stringify({ demoToken: 'demo-tok' }));
    stubApi(baseRoutes({ 'POST /sessions': { mode: 'stay', lodging: ME_STAY.lodging } }));
    renderApp('/s/tok-123');
    expect(await screen.findByRole('heading', { name: 'Bonjour Marie' })).toBeInTheDocument();
    expect(device().demoToken).toBeUndefined();
    expect(device().stayToken).toBe('tok-123');
  });

  it('a lookup by name and number drops the demo link, so a real guest is never sent back to the demo', async () => {
    window.localStorage.setItem('gf-guest', JSON.stringify({ demoToken: 'demo-tok' }));
    stubApi(baseRoutes({ 'GET /me': demoMe(), 'POST /sessions/lookup': { mode: 'stay', lodging: ME_STAY.lodging } }));
    renderApp('/retrouver');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(/nom/i), 'Durand');
    await user.type(screen.getByLabelText(/numéro/i), 'R-1');
    await user.click(screen.getByRole('button', { name: 'Accéder à mon séjour' }));
    await waitFor(() => expect(device().demoToken).toBeUndefined());
  });
});
