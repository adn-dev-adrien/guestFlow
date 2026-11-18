// specs/arrival-departure-sas.md §3.0 reading of 2026-11-18 (stabilisation loop t22, owner decision: lost focus is a defect on every path) —
// every step change of the SAS, forward and back, puts the focus on the new step's title: never on the document body, never on a footer
// button React kept for the next page with another meaning (« Suivant » turned « Valider et terminer »).
// The pages are enumerated from the code (the `case` keys of the footer's `renderActions`); the walks below go through the arrival and the
// departure, forward with the control the operator used focused, then back with « Précédent », and must visit every enumerated page.
//
// One file per subject (CLAUDE.md §9). Fixtures used by more than one subject live in ./sasFixtures.
import fs from 'fs';
import path from 'path';
import { screen, fireEvent, act, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

import api from '../../../api';
import { sasPayload, stayDue, BREAKFAST_OFFER, MEAL_OFFER, salesPayload, renderDialog } from './sasFixtures';
import { previewLikeTheServer, departurePreviewLikeTheServer } from './sasPreviewFake';

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
const actions = SOURCE.slice(SOURCE.indexOf('function renderActions()'), SOURCE.indexOf('function renderBody()'));
const PAGES = [...new Set([...actions.matchAll(/case '([a-zA-Z]+)':/g)].map((m) => m[1]))].sort();

// The control that moves each walk on, first found wins: the answers that open a conditional page come before the plain ones.
const FORWARD = ['Continuer', 'Commencer', 'Caution perçue', 'Ajouter le petit déjeuner', 'Oui, proposer', 'Pas OK', 'Rendue', 'Non', 'Oui', 'Non merci', 'Suivant'];

const ARRIVAL = sasPayload({
  reservation: { cautionAmount: 500, cautionReceived: 0, adults: 2, bedLinenAlert: 1, options: [{ optionId: 9, title: 'Panier', inComplement: 0, offered: 0, totalPrice: 20, unitPrice: 20, quantity: 1, billedUnits: 1 }] },
  portalCode: '1234',
  stayPayment: stayDue(),
  cleaning: { included: false, price: 80 },
  bathLinen: { available: true, unitPrice: 6, priceType: 'per_person', persons: 2, nights: 2, amount: 12, label: 'Linge de toilette' },
  sasSales: salesPayload({ breakfast: BREAKFAST_OFFER, catering: { available: true, options: [MEAL_OFFER] } }),
});
const DEPARTURE = sasPayload({
  reservation: { cautionAmount: 500, cautionReceived: 1 },
  cleaning: { included: false, price: 80 },
  repairAmounts: [{ id: 1, repairKey: 'extinguisher_seal', label: 'Plomb manquant', price: 30 }],
});

const stepOf = () => screen.getByTestId('sas-step-title').getAttribute('data-step');
const focusLost = () => document.activeElement === null || document.activeElement === document.body;

async function walk(mode, payload) {
  api.getReservationSas.mockResolvedValue(payload);
  renderDialog({ mode });
  await screen.findByText('Commencer');
  const visited = [stepOf()];
  for (let i = 0; i < 40 && stepOf() !== 'recap'; i += 1) {
    const before = stepOf();
    const label = FORWARD.find((name) => screen.queryAllByRole('button', { name }).some((b) => !b.disabled));
    expect(label, `no way forward on « ${before} »`).toBeDefined();
    const button = screen.getAllByRole('button', { name: label }).filter((b) => !b.disabled).at(-1);
    button.focus();
    await act(async () => { fireEvent.click(button); });
    await waitFor(() => expect(stepOf() !== before || screen.queryByRole('button', { name: 'Continuer' })).toBeTruthy());
    // A confirmation (« Quantités ≠ personnes ») answered: wait until it has left, so the wizard is not hidden behind it.
    if (label === 'Continuer') await waitFor(() => expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1));
    if (stepOf() === before) continue;
    visited.push(stepOf());
    expect(focusLost(), `focus on the page after « ${label} » (${before} → ${stepOf()})`).toBe(false);
    expect(document.activeElement, `focus not on the new title after « ${label} » (${before} → ${stepOf()})`).toBe(screen.getByTestId('sas-step-title'));
  }
  expect(stepOf()).toBe('recap');
  for (let i = 0; i < 40 && screen.queryByRole('button', { name: 'Précédent' }); i += 1) {
    const before = stepOf();
    const back = screen.getByRole('button', { name: 'Précédent' });
    back.focus();
    await act(async () => { fireEvent.click(back); });
    await waitFor(() => expect(stepOf()).not.toBe(before));
    expect(focusLost(), `focus on the page after « Précédent » (${before} → ${stepOf()})`).toBe(false);
    expect(document.activeElement, `focus not on the new title after « Précédent » (${before} → ${stepOf()})`).toBe(screen.getByTestId('sas-step-title'));
  }
  expect(stepOf()).toBe('intro');
  // Back on the first page « Précédent » is gone: the focus it held is on the step's title.
  expect(document.activeElement).toBe(screen.getByTestId('sas-step-title'));
  return visited;
}

beforeEach(() => {
  vi.clearAllMocks();
  api.getReservationWeatherAlerts.mockResolvedValue({ configured: false, resolved: false, department: null, alerts: [] });
  api.previewArrivalSas.mockImplementation(previewLikeTheServer(api));
  api.previewDepartureSas.mockImplementation(departurePreviewLikeTheServer(api));
});

const visitedPages = new Set();

test('arrival: every step change, forward and back, keeps the focus off the page', async () => {
  (await walk('arrival', ARRIVAL)).forEach((key) => visitedPages.add(key));
});

test('departure: every step change, forward and back, keeps the focus off the page', async () => {
  (await walk('departure', DEPARTURE)).forEach((key) => visitedPages.add(key));
});

test('the walks went through every page of the footer, read from the code', () => {
  expect(PAGES.length).toBeGreaterThanOrEqual(20);
  expect(PAGES.filter((key) => !visitedPages.has(key))).toEqual([]);
});
