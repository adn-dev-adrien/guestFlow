// The breakfast offer and mornings pages render the server's figures — specs/breakfast-offer-price-server-side.md
// rules 4, 6, 7, 9, 10, 11: no price, quantity or ceiling is computed in the dialog.
//
// One file per subject (CLAUDE.md §9). Fixtures shared with other subjects live in ./sasFixtures.
import { screen, fireEvent, waitFor, act } from '@testing-library/react';
import { vi } from 'vitest';

import api from '../../../api';
import { sasPayload, BREAKFAST_OFFER, salesPayload, renderDialog, clickBtn } from './sasFixtures';
import { recapFor } from './sasPreviewFake';

vi.mock('../../../hooks/usePlugins', () => ({ usePlugin: () => true }));
vi.mock('../../../api', () => ({
  default: {
    getReservationSas: vi.fn(),
    previewArrivalSas: vi.fn(),
    commitArrivalSas: vi.fn().mockResolvedValue({ ok: true, complementAmount: 0 }),
    commitDepartureSas: vi.fn().mockResolvedValue({ ok: true }),
    getReservationWeatherAlerts: vi.fn().mockResolvedValue({ configured: false, resolved: false, department: null, alerts: [] }),
  },
}));

const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

function payload(offer = {}) {
  return sasPayload({
    reservation: { cautionReceived: 1, adults: 2 },
    cleaning: { included: true, price: 80 },
    sasSales: salesPayload({ breakfast: { ...BREAKFAST_OFFER, ...offer } }),
  });
}

// What the server answers for a breakfast sale, figures chosen by the test, not derived from the draft.
const breakfastAnswer = (base, sale) => ({
  ...base,
  sales: { ...base.sales, breakfast: { optionId: 6, unitPrice: 8, ...sale } },
});

async function openMornings(p) {
  api.getReservationSas.mockResolvedValue(p);
  renderDialog({ mode: 'arrival' });
  await screen.findByText('Commencer');
  clickBtn('Commencer');
  await screen.findByText(/n'a pas pris le petit déjeuner/);
  return p;
}

beforeEach(() => {
  vi.clearAllMocks();
});

test('rule 4 — the offer page prints the per-morning figure the server sent, not unit price × party', async () => {
  await openMornings(payload({ perMorning: { persons: 2, amount: 15.9 } }));
  expect(screen.getByText(/15,90 € le matin pour 2 pers\./)).toBeInTheDocument();
});

test('rule 4 — a breakfast that is not per person shows no « le matin pour » clause', async () => {
  await openMornings(payload({ perPerson: false, perMorning: { persons: null, amount: 12 }, unitPrice: 12 }));
  expect(screen.queryByText(/le matin pour/)).toBeNull();
});

test('rule 6 — the mornings page shows the quantity and the amount of the preview verbatim', async () => {
  const p = await openMornings(payload());
  api.previewArrivalSas.mockImplementation(async (id, draft) => breakfastAnswer(recapFor(p, draft), {
    moments: 2, servedPersons: 3, units: 6, amount: 48,
  }));
  clickBtn('Ajouter le petit déjeuner');
  await screen.findByText('Quels matins ?');
  expect(await screen.findByText(/\(2 × 3 pers\. servies\)/)).toBeInTheDocument();
  expect(screen.getByText(/6 petits déjeuners — 48,00 €/)).toBeInTheDocument();
  const [, draft] = api.previewArrivalSas.mock.calls[0];
  expect(JSON.stringify(draft)).not.toMatch(/"units"/);
});

test('rules 7, 9 — a stepper tap moves the number at once; the old figures stay dimmed until the answer', async () => {
  const p = await openMornings(payload({ defaultPersons: 4, selectedPersons: 4, maxPersons: 5 }));
  api.previewArrivalSas.mockImplementation(async (id, draft) => {
    const persons = draft.soldOptions?.[0]?.persons || 2;
    if (persons === 3) await wait(400);
    return breakfastAnswer(recapFor(p, draft), {
      moments: 2, servedPersons: persons, units: 2 * persons, amount: 16 * persons,
    });
  });
  clickBtn('Ajouter le petit déjeuner');
  await screen.findByText(/8 petits déjeuners — 64,00 €/);

  const minus = screen.getAllByRole('button', { name: '−' });
  fireEvent.click(minus[minus.length - 1]);
  await waitFor(() => expect(screen.getByText(/8 petits déjeuners — 64,00 €/)).toHaveStyle({ opacity: '0.55' }));
  expect(await screen.findByText(/6 petits déjeuners — 48,00 €/)).toBeInTheDocument();
  expect(screen.getByText(/6 petits déjeuners — 48,00 €/)).toHaveStyle({ opacity: '1' });
});

test('rule 10 — a failed preview hides the figures, says « Montant indisponible » and keeps the controls live', async () => {
  const p = await openMornings(payload());
  api.previewArrivalSas.mockRejectedValue(Object.assign(new Error('offline'), { status: 0 }));
  clickBtn('Ajouter le petit déjeuner');
  await screen.findByText('Quels matins ?');
  expect(await screen.findByText('Montant indisponible')).toBeInTheDocument();
  expect(screen.queryByText(/petits déjeuners — /)).toBeNull();
  const plus = screen.getAllByRole('button', { name: '+' });
  expect(plus[plus.length - 1]).not.toBeDisabled();
  expect(screen.getByRole('button', { name: 'Suivant' })).not.toBeDisabled();

  api.previewArrivalSas.mockImplementation(async (id, draft) => recapFor(p, draft));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Réessayer' })); });
  expect(await screen.findByText(/4 petits déjeuners — 32,00 €/)).toBeInTheDocument();
});

test('rule 8 — two quick taps make one preview request, and only the latest answer is shown', async () => {
  const p = await openMornings(payload({ defaultPersons: 4, selectedPersons: 4, maxPersons: 5 }));
  api.previewArrivalSas.mockImplementation(async (id, draft) => {
    const persons = draft.soldOptions?.[0]?.persons || 4;
    return breakfastAnswer(recapFor(p, draft), {
      moments: 2, servedPersons: persons, units: 2 * persons, amount: 16 * persons,
    });
  });
  clickBtn('Ajouter le petit déjeuner');
  await screen.findByText(/8 petits déjeuners — 64,00 €/);
  const before = api.previewArrivalSas.mock.calls.length;
  const minus = screen.getAllByRole('button', { name: '−' });
  fireEvent.click(minus[minus.length - 1]);
  fireEvent.click(minus[minus.length - 1]);
  expect(await screen.findByText(/4 petits déjeuners — 32,00 €/)).toBeInTheDocument();
  expect(api.previewArrivalSas.mock.calls.length - before).toBe(1);
});

test('rule 11 — covers typed above what the server serves are reset to the server’s number', async () => {
  const p = await openMornings(payload({ defaultPersons: 2, selectedPersons: 2, maxPersons: 5 }));
  api.previewArrivalSas.mockImplementation(async (id, draft) => breakfastAnswer(recapFor(p, draft), {
    moments: 2, servedPersons: 2, units: 4, amount: 32,
  }));
  clickBtn('Ajouter le petit déjeuner');
  await screen.findByText(/4 petits déjeuners — 32,00 €/);
  const plus = screen.getAllByRole('button', { name: '+' });
  fireEvent.click(plus[plus.length - 1]);
  await screen.findByText(/\(2 × 2 pers\. servies\)/);
  await waitFor(() => {
    const draftPersons = api.previewArrivalSas.mock.calls.at(-1)[1].soldOptions[0].persons;
    expect(draftPersons).toBe(2);
  });
});
