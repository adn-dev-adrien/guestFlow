// specs/mixed-method-payments.md rule 59 (loop t24, 2026-11-18) — the SAS « Plusieurs moyens » lines the operator typed are kept
// when the block reappears: after a failed recompute and its recovery, after a step back and the return to the recap (arrival), and when
// the departure's due comes back from 0. A line typed is never rewritten; the untyped last line still shows what the others leave of the
// new due, and a line that no longer fits is left as typed for the meter to say.
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import api from '../../../api';
import { clickBtn, renderDialog, sasPayload } from './sasFixtures';
import { departurePreviewLikeTheServer } from './sasPreviewFake';
import {
  arrivalRecap, departureRecap, failThenRecover, firstAmount, offerButtons, offline, pause, tenderReady, toRecap, type10,
} from './sasTenderLinesFixtures';

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

// Loop t25 B25-1 (rule 59, reading of 2026-11-19) — the shortfall choice comes back with the lines only for the same due. 10 + 5 typed
// short, « Geste commercial » chosen: back on the same due « Encaisser » can go; on another due the lines are as typed but the choice is
// asked again and « Encaisser » waits (before: a gesture chosen for one gap was recorded for another, never re-asked).
const collectButton = () => screen.getAllByRole('button').find((b) => /^Encaisser/.test(b.textContent));
async function typeShortWithGesture() {
  await tenderReady();
  fireEvent.change(firstAmount(), { target: { value: '10' } });
  fireEvent.change(document.querySelector('[data-tender-amount="1"]'), { target: { value: '5' } });
  fireEvent.click(await screen.findByText('Geste commercial'));
  await waitFor(() => expect(collectButton()).toBeEnabled());
}
const LINEN_STAY = sasPayload({
  reservation: {
    cautionAmount: 0,
    endOfStayComplementDetail: JSON.stringify([{ label: 'Linge de toilette', qty: 3, unitPrice: 8, amount: 24, source: 'arrivalBathLinen' }]),
  },
  cleaning: { included: false, price: 80 },
});
async function departureLinenRecap(state) {
  const real = departurePreviewLikeTheServer(api);
  api.previewDepartureSas.mockImplementation(async (...a) => { if (state.fail) throw offline(); return real(...a); });
  api.getReservationSas.mockResolvedValue(LINEN_STAY);
  renderDialog({ mode: 'departure' });
  await screen.findByText('Commencer'); clickBtn('Commencer');
  await screen.findByText(/fait correctement/); clickBtn('Pas OK');
  await screen.findByText(/serviettes et les draps sont-ils tous là/); clickBtn('Oui');
  await screen.findByText(/Clés du logement récupérées/); clickBtn('Oui');
  await screen.findByText(/bon état/i); clickBtn('Oui');
  await screen.findByText(/Total à percevoir : 104,00 €/);
  fireEvent.click(document.querySelector('[data-split-toggle="departure"]'));
}
const SHORTFALL_ROWS = {
  'arrival, same due (a step back, then the recap)': {
    sameDue: true,
    async run() {
      const state = {};
      await arrivalRecap(state);
      await typeShortWithGesture();
      clickBtn('Précédent');
      await waitFor(() => expect(screen.queryByText(/Récapitulatif — /)).toBeNull());
      await toRecap();
    },
  },
  'arrival, another due (a failed « Offrir », then « Réessayer »)': {
    sameDue: false,
    async run() {
      const state = {};
      await arrivalRecap(state);
      await typeShortWithGesture();
      await failThenRecover(state, () => fireEvent.click(offerButtons()[1]));
    },
  },
  'departure, same due (down to 0, then back)': {
    sameDue: true,
    async run() {
      const state = {};
      await departureRecap(state);
      await typeShortWithGesture();
      fireEvent.click(offerButtons()[0]);
      await waitFor(() => expect(firstAmount()).toBeNull());
      fireEvent.click(screen.getAllByRole('button', { name: /Offert$/ })[0]);
    },
  },
  'departure, another due (a failed « Offrir » on one line, then « Réessayer »)': {
    sameDue: false,
    async run() {
      const state = {};
      await departureLinenRecap(state);
      await typeShortWithGesture();
      await failThenRecover(state, () => fireEvent.click(offerButtons()[1]));
    },
  },
};
test.each(Object.keys(SHORTFALL_ROWS))('%s: the lines as typed; the shortfall choice kept only for the same due', async (name) => {
  const row = SHORTFALL_ROWS[name];
  await row.run();
  await tenderReady();
  expect(firstAmount()).toHaveValue('10');
  expect(document.querySelector('[data-tender-amount="1"]')).toHaveValue('5');
  await pause(100);
  if (row.sameDue) expect(collectButton()).toBeEnabled();
  else expect(collectButton()).toBeDisabled();
});
