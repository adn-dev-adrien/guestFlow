// specs/deposit-blocks-the-dates.md rule 19 (D23, audit R33-M-L1) — the live quote of a devis not saved yet is asked as
// a devis (`kind: 'devis'`), so the server prices it with the validity date its create writes: the summary's deadlines
// are the ones « Enregistrer » stores. A saved devis sends its id instead, a reservation sends neither.
// One case per call site (audit R33 N2): the opening and live quote, the change of logement, « Actualiser tarifs »
// and the quote « Enregistrer le devis » asks before the create.
import React from 'react';
import { vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';

vi.setConfig({ testTimeout: 30000 });

const dialogs = { alert: vi.fn(async () => {}), confirm: vi.fn(async () => false), prompt: vi.fn() };

vi.mock('../../api', () => {
  const calls = {};
  const handler = {
    get(_t, name) {
      if (name === '__esModule') return false;
      if (!calls[name]) calls[name] = vi.fn(async () => ([]));
      return calls[name];
    },
  };
  return { __esModule: true, default: new Proxy({}, handler) };
});
vi.mock('../../components/DialogProvider', () => ({
  __esModule: true,
  useAppDialogs: () => dialogs,
  useToast: () => ({ showSuccess: vi.fn(), showError: vi.fn() }),
}));
vi.mock('../../hooks/useAuth', () => ({
  __esModule: true,
  default: () => ({ user: { id: 1, roles: ['admin'] } }),
  useAuth: () => ({ user: { id: 1, roles: ['admin'] } }),
}));
vi.mock('../../hooks/usePlugins', () => ({ usePlugin: () => false, usePlugins: () => ({ plugins: [], isActive: () => false }) }));

import api from '../../api';
import { STAY, arrivalField, dayIn, openPage, seedFiche } from './reservationPageHarness';

const RANGE = `propertyId=1&startDate=${dayIn(35)}&endDate=${dayIn(37)}`;
const quoteBodies = () => api.calculatePrice.mock.calls.map(([body]) => body);

const TWO_PROPERTIES = [
  { id: 1, name: 'Granja', singleBeds: 2, doubleBeds: 2, defaultCheckIn: '16:00', defaultCheckOut: '10:00' },
  { id: 2, name: 'Estiva', singleBeds: 2, doubleBeds: 1, defaultCheckIn: '16:00', defaultCheckOut: '10:00' },
];

beforeEach(() => {
  vi.clearAllMocks();
  dialogs.confirm.mockImplementation(async () => false);
  seedFiche(api);
});

// The quotes asked after `since` calls: each one must carry the marker, and `pick` names the call site's own quote.
function expectMarkedSince(since, pick) {
  const after = quoteBodies().slice(since);
  const own = after.filter(pick);
  expect(own.length).toBeGreaterThan(0);
  expect(own.every((body) => body.kind === 'devis' && !body.devisId && !body.reservationId)).toBe(true);
}

async function openNewDevis() {
  openPage(`/reservations/new?mode=devis&${RANGE}`);
  await arrivalField(dayIn(35));
  await waitFor(() => expect(api.calculatePrice).toHaveBeenCalled());
  await new Promise((resolve) => { setTimeout(resolve, 300); });
}

test('R33-M-L1 — « Nouveau devis » asks every live quote as a devis', async () => {
  openPage(`/reservations/new?mode=devis&${RANGE}`);
  await arrivalField(dayIn(35));
  await waitFor(() => expect(api.calculatePrice).toHaveBeenCalled());
  expect(quoteBodies().every((body) => body.kind === 'devis' && !body.devisId && !body.reservationId)).toBe(true);
});

test('R33-M-L1 — a new reservation and a saved devis do not send the marker', async () => {
  openPage(`/reservations/new?${RANGE}`);
  await arrivalField(dayIn(35));
  await waitFor(() => expect(api.calculatePrice).toHaveBeenCalled());
  expect(quoteBodies().some((body) => body.kind === 'devis')).toBe(false);
});

test('R33-M-L1 — an existing devis is quoted by its id, without the marker', async () => {
  api.getDevisById.mockResolvedValue({ ...STAY, id: 77, kind: 'devis', status: 'sent', validUntil: dayIn(15), expired: false });
  openPage('/reservations/new?mode=devis&devisId=77');
  await arrivalField(STAY.startDate);
  await waitFor(() => expect(api.calculatePrice).toHaveBeenCalled());
  expect(quoteBodies().every((body) => body.devisId === 77 && body.kind === undefined)).toBe(true);
});

test('R33 N2 — the change of logement on a new devis quotes it as a devis', async () => {
  api.getProperties.mockResolvedValue(TWO_PROPERTIES);
  await openNewDevis();
  const since = api.calculatePrice.mock.calls.length;
  const select = screen.getByRole('combobox', { name: 'Logement' });
  fireEvent.mouseDown(select);
  fireEvent.click(await screen.findByRole('option', { name: 'Estiva' }));
  await waitFor(() => expect(quoteBodies().slice(since).some((body) => body.propertyId === 2)).toBe(true));
  // The handler's own quote: the logement's new id, without the line payloads the live quote sends.
  expectMarkedSince(since, (body) => body.propertyId === 2 && !('selectedOptions' in body));
});

test('R33 N2 — « Actualiser tarifs » on a new devis quotes it as a devis', async () => {
  dialogs.confirm.mockImplementation(async () => true);
  await openNewDevis();
  const since = api.calculatePrice.mock.calls.length;
  fireEvent.click(screen.getByRole('button', { name: 'Actualiser tarifs' }));
  await waitFor(() => expect(quoteBodies().slice(since).some((body) => body.forceCurrentPricing === true)).toBe(true));
  expectMarkedSince(since, (body) => body.forceCurrentPricing === true && body.customPrice === '');
});

test('R33 N2 — « Enregistrer le devis » asks its last quote as a devis before the create', async () => {
  api.createDevis.mockResolvedValue({});
  await openNewDevis();
  fireEvent.click(screen.getAllByText('+ Créer un nouveau client')[0]);
  fireEvent.change(await screen.findByLabelText(/^Nom/), { target: { value: 'Testeur' } });
  fireEvent.change(screen.getByLabelText(/^Prénom/), { target: { value: 'Alex' } });
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => expect(screen.queryByText('Créer un nouveau client', { selector: 'h2' })).not.toBeInTheDocument());
  await waitFor(() => expect(screen.getAllByText(/Testeur/).length).toBeGreaterThan(0));
  const since = api.calculatePrice.mock.calls.length;
  const save = screen.getByRole('button', { name: 'Enregistrer le devis' });
  await waitFor(() => expect(save).toBeEnabled());
  fireEvent.click(save);
  await waitFor(() => expect(api.createDevis).toHaveBeenCalledTimes(1));
  // The save's own quote: it alone sends the locked units of the stored lines.
  expectMarkedSince(since, (body) => 'lockedOptionUnits' in body);
});
