// specs/guest-app.md rules 71, 87 (audit of the J-7 branch, items 3-5) — the « Commandes Mon séjour » page of the arrival SAS, hosted
// by the real dialog: the recap recalls the orders' line the server words, an amendment makes the dialog read the SAS data again
// (the page and the recap never keep the pre-amendment payload), and a page whose last order was removed hands over to the recap.
//
// One file per subject (CLAUDE.md §9). Fixtures used by more than one subject live in ./sasFixtures.
import { screen, waitFor, fireEvent, within } from '@testing-library/react';
import { vi } from 'vitest';

import api from '../../../api';
import guestAppApi from '../../guest-app/guestAppApi';
import { sasPayload, renderDialog, clickBtn } from './sasFixtures';
import { previewLikeTheServer } from './sasPreviewFake';

vi.mock('../../../hooks/usePlugins', () => ({ usePlugin: () => true }));
vi.mock('../../../api', () => ({
  default: {
    getReservationSas: vi.fn(),
    previewArrivalSas: vi.fn(),
    commitArrivalSas: vi.fn().mockResolvedValue({ ok: true }),
    commitDepartureSas: vi.fn().mockResolvedValue({ ok: true }),
    getReservationWeatherAlerts: vi.fn().mockResolvedValue({ configured: false, resolved: false, department: null, alerts: [] }),
  },
}));
vi.mock('../../guest-app/guestAppApi', () => ({ default: { amendOrder: vi.fn() } }));

beforeEach(() => {
  vi.clearAllMocks();
  api.previewArrivalSas.mockImplementation(previewLikeTheServer(api));
});

const line = { key: 'opt:1', label: 'Cidre fermier', quantity: 2, unitLabel: '2 × 6 €', amountLabel: '12 €', editable: true, removable: true, maxQuantity: 5 };
const order = {
  id: 7, number: 7, deliveryLabel: 'ven. 13 nov., 18 h', statusLabel: 'À régler à l’arrivée', paid: false, editable: true, totalLabel: '12 €', lines: [line],
};
const ORDERS = {
  orders: [order], summaryLabel: '1 commande · 12 € à percevoir', toCollect: 12, toCollectLabel: '12 €', paid: 0, paidLabel: null, recapNote: 'Commandes Mon séjour : 12 € (dans le complément d’arrivée)', changed: false,
};
const payload = (ordersAtArrival) => sasPayload({
  cleaning: { included: true, price: null },
  reservation: { cautionAmount: 0 },
  pluginData: { 'guest-app': { available: false, ...(ordersAtArrival ? { ordersAtArrival } : {}) } },
});

async function openOrdersPage() {
  await screen.findByText('Commencer');
  clickBtn('Commencer');
  return screen.findByRole('button', { name: /1 commande · 12 € à percevoir/ });
}

test('rule 71 (item 4): the recap recalls « Commandes Mon séjour : 12 € (dans le complément d\'arrivée) » in the server\'s words', async () => {
  api.getReservationSas.mockResolvedValue(payload(ORDERS));
  renderDialog({ mode: 'arrival' });
  await openOrdersPage();
  clickBtn('Suivant');
  await screen.findByText(/Récapitulatif —/);
  expect(await screen.findByText('Commandes Mon séjour : 12 € (dans le complément d’arrivée)')).toBeTruthy();
});

test('rule 87 (item 3): an amendment reads the SAS data again — the page shows the fresh payload and the next visit never the old one', async () => {
  const lowered = { ...ORDERS, orders: [{ ...order, totalLabel: '6 €', lines: [{ ...line, quantity: 1, amountLabel: '6 €', unitLabel: '1 × 6 €' }] }], summaryLabel: '1 commande · 6 € à percevoir', toCollect: 6, toCollectLabel: '6 €', recapNote: 'Commandes Mon séjour : 6 € (dans le complément d’arrivée)' };
  api.getReservationSas.mockResolvedValueOnce(payload(ORDERS)).mockResolvedValue(payload(lowered));
  guestAppApi.amendOrder.mockResolvedValue({ ordersAtArrival: lowered });
  renderDialog({ mode: 'arrival' });
  await openOrdersPage();
  clickBtn('Suivant');
  await screen.findByText(/Récapitulatif —/);
  await waitFor(() => expect(api.previewArrivalSas).toHaveBeenCalled());
  const askedBefore = api.previewArrivalSas.mock.calls.length;
  clickBtn('Précédent');
  await screen.findByRole('button', { name: /1 commande · 12 € à percevoir/ });
  fireEvent.click(screen.getByRole('button', { name: 'Moins de Cidre fermier' }));
  await waitFor(() => expect(api.getReservationSas).toHaveBeenCalledTimes(2));
  expect(guestAppApi.amendOrder).toHaveBeenCalledWith(7, { lines: [{ key: 'opt:1', quantity: 1 }] });
  await screen.findByRole('button', { name: /1 commande · 6 € à percevoir/ });
  clickBtn('Suivant');
  await screen.findByText(/Récapitulatif —/);
  expect(await screen.findByText('Commandes Mon séjour : 6 € (dans le complément d’arrivée)')).toBeTruthy();
  await waitFor(() => expect(api.previewArrivalSas.mock.calls.length).toBeGreaterThan(askedBefore));
  clickBtn('Précédent');
  const toggle = await screen.findByRole('button', { name: /1 commande · 6 € à percevoir/ });
  expect(within(toggle.closest('div').parentElement).getAllByText('6 €').length).toBeGreaterThan(0);
  expect(screen.queryByText('2 × 6 €')).toBeNull();
});

test('rule 87 (items 3, 5): the last order removed — no stale page, the dialog hands over to the recap, which recalls nothing', async () => {
  api.getReservationSas.mockResolvedValueOnce(payload(ORDERS)).mockResolvedValue(payload(null));
  guestAppApi.amendOrder.mockResolvedValue({ ordersAtArrival: null });
  renderDialog({ mode: 'arrival' });
  await openOrdersPage();
  fireEvent.click(screen.getByRole('button', { name: 'Retirer la commande' }));
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Retirer la commande' }));
  await screen.findByText(/Récapitulatif —/);
  expect(screen.queryByText(/Commandes Mon séjour :/)).toBeNull();
});

test('rule 87 (item 4 of the third pass): a failed reload after an amendment says so and keeps the step usable', async () => {
  const lowered = { ...ORDERS, orders: [{ ...order, totalLabel: '6 €', lines: [{ ...line, quantity: 1, amountLabel: '6 €', unitLabel: '1 × 6 €' }] }], summaryLabel: '1 commande · 6 € à percevoir', toCollect: 6, toCollectLabel: '6 €' };
  api.getReservationSas.mockResolvedValueOnce(payload(ORDERS)).mockRejectedValue(new Error('réseau'));
  guestAppApi.amendOrder.mockResolvedValue({ ordersAtArrival: lowered });
  renderDialog({ mode: 'arrival' });
  await openOrdersPage();
  fireEvent.click(screen.getByRole('button', { name: 'Moins de Cidre fermier' }));
  expect(await screen.findByText(/Données du sas non rechargées/)).toBeTruthy();
  expect(screen.getByRole('button', { name: /1 commande · 6 € à percevoir/ })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Plus de Cidre fermier' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Suivant' })).toBeTruthy();
});
