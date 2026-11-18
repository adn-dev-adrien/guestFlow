// specs/mixed-method-payments.md rule 59 (loop t24, 2026-11-18) — the SAS « Plusieurs moyens » lines the operator typed are kept
// when the block reappears: after a failed recompute and its recovery, after a step back and the return to the recap (arrival), and when
// the departure's due comes back from 0. A line typed is never rewritten; the untyped last line still shows what the others leave of the
// new due, and a line that no longer fits is left as typed for the meter to say.
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import api from '../../../api';
import { sasPayload, stayDue, renderDialog, clickBtn, stayPageReady } from './sasFixtures';
import { recapFor, departurePreviewLikeTheServer } from './sasPreviewFake';

vi.mock('../../../hooks/usePlugins', () => ({ usePlugin: () => true }));
vi.mock('../../../api', () => ({
  default: {
    getReservationSas: vi.fn(),
    previewArrivalSas: vi.fn(),
    previewDepartureSas: vi.fn(),
    commitArrivalSas: vi.fn().mockResolvedValue({ ok: true, complementAmount: 0 }),
    commitDepartureSas: vi.fn().mockResolvedValue({ ok: true }),
    getReservationWeatherAlerts: vi.fn().mockResolvedValue({ configured: false, resolved: false, department: null, alerts: [] }),
  },
}));

const offline = () => Object.assign(new Error('Service indisponible'), { status: 503 });
const pause = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const LINE = (optionId, title, price) => ({ optionId, title, inComplement: 1, offered: 0, totalPrice: price, originalTotalPrice: price, unitPrice: price, billedUnits: 1, quantity: 1 });
const ARRIVAL_STAY = sasPayload({
  reservation: { cautionAmount: 0, complementAmount: 30, options: [LINE(5, 'Panier gourmand', 20), LINE(6, 'Vin local', 10)] },
  cleaning: { included: true, price: 80 },
  stayPayment: stayDue(),
});
const firstAmount = () => document.querySelector('[data-tender-amount="0"]');
const tenderReady = () => waitFor(() => expect(firstAmount()).not.toBeNull(), { timeout: 5000 });
const type10 = async () => {
  await tenderReady();
  fireEvent.change(firstAmount(), { target: { value: '10' } });
  await waitFor(() => expect(firstAmount()).toHaveValue('10'));
};
const offerButtons = () => screen.getAllByRole('button', { name: /^Offrir$/ });

async function arrivalRecap(state) {
  api.getReservationSas.mockResolvedValue(ARRIVAL_STAY);
  api.previewArrivalSas.mockImplementation(async (id, draft) => { if (state.fail) throw offline(); return recapFor(ARRIVAL_STAY, draft); });
  renderDialog({ mode: 'arrival' });
  await screen.findByText('Commencer');
  clickBtn('Commencer');
  await toRecap();
  fireEvent.click(document.querySelector('[data-split-toggle="arrival"]'));
}
async function toRecap() {
  for (let i = 0; i < 12 && !screen.queryByText(/Récapitulatif — /); i += 1) {
    if (screen.queryByText('Séjour à régler :')) await stayPageReady();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Suivant' })).toBeEnabled());
    clickBtn('Suivant');
    await pause(50);
  }
  await screen.findByText(/Récapitulatif — /);
}
async function departureRecap(state) {
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
async function failThenRecover(state, edit) {
  state.fail = true;
  edit();
  await screen.findByText(/Total indisponible/);
  await waitFor(() => expect(firstAmount()).toBeNull());
  state.fail = false;
  fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
  await waitFor(() => expect(document.body.textContent).not.toMatch(/Total indisponible/));
}

const ROWS = {
  'arrival — a failed recompute, then « Réessayer »': async () => {
    const state = {};
    await arrivalRecap(state);
    await type10();
    await failThenRecover(state, () => fireEvent.click(offerButtons()[1]));
  },
  'arrival — a step back, then the return to the recap': async () => {
    const state = {};
    await arrivalRecap(state);
    await type10();
    clickBtn('Précédent');
    await waitFor(() => expect(screen.queryByText(/Récapitulatif — /)).toBeNull());
    await toRecap();
  },
  'departure — a failed recompute, then « Réessayer »': async () => {
    const state = {};
    await departureRecap(state);
    await type10();
    // The only line offered fails; « Réessayer » brings a due of 0 (no lines), and un-offering it brings the lines back.
    await failThenRecover(state, () => fireEvent.click(offerButtons()[0]));
    fireEvent.click(screen.getAllByRole('button', { name: /Offert$/ })[0]);
  },
  'departure — the due down to 0, then back': async () => {
    const state = {};
    await departureRecap(state);
    await type10();
    fireEvent.click(offerButtons()[0]);
    await waitFor(() => expect(firstAmount()).toBeNull());
    fireEvent.click(screen.getAllByRole('button', { name: /Offert$/ })[0]);
  },
};

beforeEach(() => { vi.clearAllMocks(); });

test.each(Object.keys(ROWS))('%s: the line typed comes back as typed', async (name) => {
  await ROWS[name]();
  await tenderReady();
  expect(firstAmount()).toHaveValue('10');
});
