// specs/pricing-components.md rule 117 (reading 2026-11-18, loop t22 UI22-3), specs/sas-arrival-total-server-side.md rule 21,
// specs/sas-departure-recap-server-side.md rule 20 — every SAS page that shows the preview's money says when that preview FAILED: the
// reason and « Réessayer » (or the way back to the refusing step), never « — » for ever; the buttons that act on the amount wait for a
// fresh answer; « Réessayer » brings the figures back and leaves the focus in the page, never on the document body.
// The pages are enumerated from the code (`previewShown` of each end): a page added there fails here until it has its row.
//
// One file per subject (CLAUDE.md §9). Fixtures used by more than one subject live in ./sasFixtures.
import fs from 'fs';
import path from 'path';
import { screen, waitFor, act, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';

import api from '../../../api';
import { sasPayload, stayDue, BREAKFAST_OFFER, MEAL_OFFER, salesPayload, renderDialog, clickBtn } from './sasFixtures';
import { recapFor, departureRecapFor } from './sasPreviewFake';

vi.mock('../../../hooks/usePlugins', () => ({ usePlugin: () => true }));
vi.mock('../../../api', () => ({
  default: {
    getReservationSas: vi.fn(),
    previewArrivalSas: vi.fn(),
    previewDepartureSas: vi.fn(),
    commitArrivalSas: vi.fn(),
    commitDepartureSas: vi.fn(),
    getReservationWeatherAlerts: vi.fn(),
  },
}));

const SOURCE = fs.readFileSync(path.resolve(__dirname, '..', 'ReservationSasDialog.jsx'), 'utf8');
const shown = /const previewShown = mode === 'arrival'\s*\?\s*\[([^\]]*)\]\.includes\(stepKey\)\s*:\s*\[([^\]]*)\]\.includes\(stepKey\)/.exec(SOURCE);
const keysOf = (list) => list.split(',').map((k) => k.trim().replace(/'/g, '')).filter(Boolean);
const ENUMERATED = shown ? [...keysOf(shown[1]).map((k) => `arrival:${k}`), ...keysOf(shown[2]).map((k) => `departure:${k}`)].sort() : [];

const OFFLINE = () => Promise.reject(Object.assign(new Error('Service indisponible'), { status: 503 }));
const UNAVAILABLE = 'Montant indisponible';
const TOTAL_UNAVAILABLE = 'Total indisponible : pas de réponse du serveur.';

const STAY = sasPayload({
  reservation: { cautionAmount: 0 }, cleaning: { included: true, price: 80 }, stayPayment: stayDue(),
});
const SALES = (sales) => sasPayload({ reservation: { cautionReceived: 1, adults: 2 }, cleaning: { included: true, price: 80 }, sasSales: salesPayload(sales) });
const RECAP = sasPayload({
  reservation: {
    cautionAmount: 0,
    complementAmount: 20,
    options: [{ optionId: 5, title: 'Panier gourmand', inComplement: 1, offered: 0, totalPrice: 20, originalTotalPrice: 20, unitPrice: 20, billedUnits: 1, quantity: 1 }],
  },
  cleaning: { included: true, price: null },
});
const DEPARTURE = sasPayload({
  reservation: { cautionAmount: 0 },
  cleaning: { included: false, price: 80 },
  linenItems: [{ id: 4, label: 'Serviette', price: 6.5, category: 'bath' }],
  repairAmounts: [{ id: 1, repairKey: 'extinguisher_seal', label: 'Plomb manquant', price: 30 }],
});

async function begin(mode) {
  renderDialog({ mode });
  await screen.findByText('Commencer');
  clickBtn('Commencer');
}
async function departureToExtinguisher(cleaning = 'OK') {
  await begin('departure');
  await screen.findByText(/fait correctement/);
  clickBtn(cleaning);
  await screen.findByText(/serviettes et les draps sont-ils tous là/);
  clickBtn('Oui');
  await screen.findByText(/Clés du logement récupérées/);
  clickBtn('Oui');
  await screen.findByText(/bon état/i);
}

// One row per page: the payload, how to reach the page, what says the failure, the buttons that act on the amount, the figure a fresh answer shows.
const PAGES = {
  'arrival:stayPayment': {
    payload: STAY,
    preview: 'previewArrivalSas',
    answer: (draft) => recapFor(STAY, draft),
    reach: async () => { await begin('arrival'); await screen.findByText('Séjour à régler :'); },
    reason: UNAVAILABLE,
    placeholder: () => expect(screen.getByText('—')).toBeInTheDocument(),
    money: ['CB / Chèque', 'Payé en liquide', 'Pas maintenant'],
    figure: () => screen.findByText('480,00 €'),
  },
  'arrival:breakfastMornings': {
    payload: SALES({ breakfast: BREAKFAST_OFFER }),
    preview: 'previewArrivalSas',
    answer: (draft) => recapFor(SALES({ breakfast: BREAKFAST_OFFER }), draft),
    reach: async () => {
      await begin('arrival');
      await screen.findByText(/n'a pas pris le petit déjeuner/);
      clickBtn('Ajouter le petit déjeuner');
      await screen.findByText('Quels matins ?');
    },
    reason: UNAVAILABLE,
    placeholder: () => expect(screen.getAllByText('—').length).toBeGreaterThan(0),
    money: [],
    figure: () => screen.findByText(/4 petits déjeuners — 32,00 €/),
  },
  'arrival:cateringItems': {
    payload: SALES({ catering: { available: true, options: [MEAL_OFFER] } }),
    preview: 'previewArrivalSas',
    answer: (draft) => recapFor(SALES({ catering: { available: true, options: [MEAL_OFFER] } }), draft),
    reach: async () => {
      await begin('arrival');
      await screen.findByText(/souhaite-t-il de la restauration/);
      clickBtn('Oui, proposer');
      await screen.findByText(/Total restauration/);
    },
    reason: UNAVAILABLE,
    placeholder: () => expect(screen.getByText(/Total restauration : —/)).toBeInTheDocument(),
    money: [],
    figure: () => screen.findByText(/Total restauration : \d/),
  },
  'arrival:recap': {
    payload: RECAP,
    preview: 'previewArrivalSas',
    answer: (draft) => recapFor(RECAP, draft),
    reach: async () => { await begin('arrival'); await screen.findByText('Prestations réservées'); clickBtn('Suivant'); },
    reason: TOTAL_UNAVAILABLE,
    placeholder: () => {},
    money: ['Valider et terminer'],
    figure: () => screen.findByText(/Total : 20,00 €/),
  },
  'departure:extinguisherItems': {
    payload: DEPARTURE,
    preview: 'previewDepartureSas',
    answer: (draft) => departureRecapFor(DEPARTURE, draft),
    reach: async () => {
      await departureToExtinguisher();
      clickBtn('Non');
      await screen.findByText('Frais extincteur à facturer');
      fireEvent.click(screen.getAllByRole('button', { name: '+' })[0]);
    },
    reason: UNAVAILABLE,
    placeholder: () => expect(screen.getByText('Sous-total : —')).toBeInTheDocument(),
    money: [],
    figure: () => screen.findByText('Sous-total : 30,00 €'),
  },
  'departure:recap': {
    payload: DEPARTURE,
    preview: 'previewDepartureSas',
    answer: (draft) => departureRecapFor(DEPARTURE, draft),
    reach: async () => { await departureToExtinguisher('Pas OK'); clickBtn('Oui'); },
    reason: TOTAL_UNAVAILABLE,
    placeholder: () => {},
    money: ['Valider et terminer'],
    figure: () => screen.findByText(/Total à percevoir : 80,00 €/),
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  api.getReservationWeatherAlerts.mockResolvedValue({ configured: false, resolved: false, department: null, alerts: [] });
});

test('the pages that show the preview\'s money, read from the code, are exactly the table', () => {
  expect(ENUMERATED.length).toBeGreaterThanOrEqual(6);
  expect(ENUMERATED).toEqual(Object.keys(PAGES).sort());
});

test.each(Object.keys(PAGES))('%s: a failed preview says why with its way out, nothing acts on « — », « Réessayer » brings the figures back', async (key) => {
  const page = PAGES[key];
  api.getReservationSas.mockResolvedValue(page.payload);
  api[page.preview].mockImplementation(OFFLINE);
  await page.reach();

  const alert = await screen.findByText(page.reason);
  expect(alert.closest('[role="alert"]')).not.toBeNull();
  page.placeholder();
  for (const name of page.money) expect(screen.getByRole('button', { name })).toBeDisabled();

  api[page.preview].mockImplementation(async (id, draft) => page.answer(draft));
  const retry = screen.getByRole('button', { name: 'Réessayer' });
  retry.focus();
  await act(async () => { fireEvent.click(retry); });
  await page.figure();
  await waitFor(() => expect(screen.queryByText(page.reason)).toBeNull());
  for (const name of page.money) await waitFor(() => expect(screen.getByRole('button', { name })).toBeEnabled());
  // « Réessayer » is gone with the failure: the focus stays in the dialog, never on the page.
  await waitFor(() => expect(document.activeElement).not.toBe(document.body));
  expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
});
