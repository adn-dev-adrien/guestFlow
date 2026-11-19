// Shared by the SAS « Plusieurs moyens » suites (specs/mixed-method-payments.md rule 59): the stays, the walks to each recap with the block
// open, and the failed-recompute helper. Not a test file; each suite keeps its own `vi.mock` of the api.
import { screen, fireEvent, waitFor } from '@testing-library/react';
import api from '../../../api';
import { sasPayload, stayDue, renderDialog, clickBtn, stayPageReady } from './sasFixtures';
import { recapFor, departurePreviewLikeTheServer } from './sasPreviewFake';

export const offline = () => Object.assign(new Error('Service indisponible'), { status: 503 });
export const pause = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
export const LINE = (optionId, title, price) => ({ optionId, title, inComplement: 1, offered: 0, totalPrice: price, originalTotalPrice: price, unitPrice: price, billedUnits: 1, quantity: 1 });
export const ARRIVAL_STAY = sasPayload({
  reservation: { cautionAmount: 0, complementAmount: 30, options: [LINE(5, 'Panier gourmand', 20), LINE(6, 'Vin local', 10)] },
  cleaning: { included: true, price: 80 },
  stayPayment: stayDue(),
});
export const firstAmount = () => document.querySelector('[data-tender-amount="0"]');
export const tenderReady = () => waitFor(() => expect(firstAmount()).not.toBeNull(), { timeout: 5000 });
export const type10 = async () => {
  await tenderReady();
  fireEvent.change(firstAmount(), { target: { value: '10' } });
  await waitFor(() => expect(firstAmount()).toHaveValue('10'));
};
export const offerButtons = () => screen.getAllByRole('button', { name: /^Offrir$/ });

export async function arrivalRecap(state) {
  api.getReservationSas.mockResolvedValue(ARRIVAL_STAY);
  api.previewArrivalSas.mockImplementation(async (id, draft) => { if (state.fail) throw offline(); return recapFor(ARRIVAL_STAY, draft); });
  renderDialog({ mode: 'arrival' });
  await screen.findByText('Commencer');
  clickBtn('Commencer');
  await toRecap();
  fireEvent.click(document.querySelector('[data-split-toggle="arrival"]'));
}
export async function toRecap() {
  for (let i = 0; i < 12 && !screen.queryByText(/Récapitulatif — /); i += 1) {
    if (screen.queryByText('Séjour à régler :')) await stayPageReady();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Suivant' })).toBeEnabled());
    clickBtn('Suivant');
    await pause(50);
  }
  await screen.findByText(/Récapitulatif — /);
}
export async function departureRecap(state) {
  const real = departurePreviewLikeTheServer(api);
  api.previewDepartureSas.mockImplementation(async (...a) => { if (state.fail) throw offline(); return real(...a); });
  api.getReservationSas.mockResolvedValue(sasPayload({ reservation: { cautionAmount: 0 }, cleaning: { included: false, price: 80 } }));
  renderDialog({ mode: 'departure' });
  await screen.findByText('Commencer'); clickBtn('Commencer');
  await screen.findByText(/fait correctement/); clickBtn('Pas OK');
  await screen.findByText(/serviettes et les draps sont-ils tous là/); clickBtn('Oui');
  await screen.findByText(/Clés du logement récupérées/); clickBtn('Oui');
  await screen.findByText(/bon état/i); clickBtn('Oui');
  await screen.findByText(/Total à percevoir : 80,00 €/);
  fireEvent.click(document.querySelector('[data-split-toggle="departure"]'));
}
export async function failThenRecover(state, edit) {
  state.fail = true;
  edit();
  await screen.findByText(/Total indisponible/);
  await waitFor(() => expect(firstAmount()).toBeNull());
  state.fail = false;
  fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
  await waitFor(() => expect(document.body.textContent).not.toMatch(/Total indisponible/));
}
