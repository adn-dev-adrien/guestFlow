// specs/payment-link-lifecycle.md rules 40, 41 and 49 — the closure dialog asks the server what the closure
// would meet as soon as the logement and both dates are set, shows the red and amber lines with « Ouvrir »,
// keeps Save enabled, and renders the lists a refused save answers.
import React from 'react';
import { vi } from 'vitest';
import { render, screen, within, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import dayjs from 'dayjs';
import DialogProvider from '../../components/DialogProvider';

vi.mock('../../api', () => ({
  __esModule: true,
  default: {
    getEstablishmentClosures: vi.fn(),
    getProperties: vi.fn(),
    getClosureConflicts: vi.fn(),
    updateEstablishmentClosure: vi.fn(),
    createEstablishmentClosure: vi.fn(),
  },
}));

import api from '../../api';
import EstablishmentClosuresPage from '../EstablishmentClosuresPage';

const inDays = (n) => dayjs().add(n, 'day').format('YYYY-MM-DD');
const CLOSURE = { id: 5, propertyId: 1, propertyName: 'Gîte', label: 'Travaux', startDate: inDays(30), endDate: inDays(33) };
const REQUEST = { reservationId: 12, linkId: 41, kind: 'devis', label: 'Devis D-2026-118 · Ana Test', detail: '840,00 € · lien valable jusqu’au 01/11 à 06:00', url: '/reservations/new?mode=devis&devisId=12' };
const DEVIS = { reservationId: 13, label: 'Devis D-2026-121 · Bo Test', detail: 'Gîte · 14/11 → 16/11 · aucun lien en cours', url: '/reservations/new?mode=devis&devisId=13' };
const RESA = { id: 7, label: '22341 · Cy Test · 02/11 → 05/11', detail: 'Gîte', url: '/reservations/7' };
const NONE = { reservations: [], requests: [], devis: [] };

const media = (matches) => (query) => ({
  matches, media: query, onchange: null,
  addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false; },
});
let orig;
beforeEach(() => {
  vi.clearAllMocks();
  orig = window.matchMedia;
  window.matchMedia = media(false);
  api.getEstablishmentClosures.mockResolvedValue([CLOSURE]);
  api.getProperties.mockResolvedValue([{ id: 1, name: 'Gîte' }]);
});
afterEach(() => { window.matchMedia = orig; });

async function openClosure() {
  render(<MemoryRouter><DialogProvider><EstablishmentClosuresPage /></DialogProvider></MemoryRouter>);
  fireEvent.click(await screen.findByText('Travaux'));
  return screen.findByRole('dialog');
}

test('rules 41, 49: logement and dates set → the server is asked; amber lines with « Ouvrir », Save enabled', async () => {
  api.getClosureConflicts.mockResolvedValue({ ...NONE, requests: [REQUEST], devis: [DEVIS] });
  const dialog = await openClosure();
  await waitFor(() => expect(api.getClosureConflicts).toHaveBeenCalledWith({ propertyId: 1, startDate: CLOSURE.startDate, endDate: CLOSURE.endDate }));
  const amber = await within(dialog).findByRole('status');
  expect(within(amber).getByText('Demande de paiement en cours sur ces dates.')).toBeInTheDocument();
  expect(within(amber).getByText('Devis en cours sur ces dates.')).toBeInTheDocument();
  expect(within(amber).getByText(REQUEST.detail)).toBeInTheDocument();
  const open = within(amber).getByRole('link', { name: `Ouvrir : ${REQUEST.label}` });
  expect(open).toHaveAttribute('href', REQUEST.url);
  expect(open).toHaveAttribute('target', '_blank');
  expect(within(amber).getByRole('link', { name: `Ouvrir : ${DEVIS.label}` })).toHaveAttribute('href', DEVIS.url);
  expect(within(dialog).getByRole('button', { name: 'Enregistrer' })).toBeEnabled();
});

test('rule 40: a reservation on the dates is a red line, each stay linked', async () => {
  api.getClosureConflicts.mockResolvedValue({ ...NONE, reservations: [RESA] });
  const dialog = await openClosure();
  const red = await within(dialog).findByRole('alert');
  expect(within(red).getByText('Réservation sur ces dates : fermeture impossible.')).toBeInTheDocument();
  expect(within(red).getByRole('link', { name: `Ouvrir : ${RESA.label}` })).toHaveAttribute('href', '/reservations/7');
});

test('rule 41: a save refused for open requests shows the refusal on their line, and the dialog stays open', async () => {
  api.getClosureConflicts.mockResolvedValue(NONE);
  api.updateEstablishmentClosure.mockRejectedValue(Object.assign(new Error('x'), {
    code: 'OPEN_PAYMENT_REQUEST',
    error: 'Demande de paiement en cours sur ces dates : la retirer avant d’enregistrer la fermeture.',
    requests: [REQUEST],
  }));
  const dialog = await openClosure();
  await waitFor(() => expect(api.getClosureConflicts).toHaveBeenCalled());
  await userEvent.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
  const amber = await within(dialog).findByRole('status');
  expect(within(amber).getByText('Demande de paiement en cours sur ces dates : la retirer avant d’enregistrer la fermeture.')).toBeInTheDocument();
  expect(within(amber).getByRole('link', { name: `Ouvrir : ${REQUEST.label}` })).toBeInTheDocument();
  expect(screen.getByRole('dialog')).toBeInTheDocument();
});

test('rule 40: a save refused over a reservation renders its list', async () => {
  api.getClosureConflicts.mockResolvedValue(NONE);
  api.updateEstablishmentClosure.mockRejectedValue(Object.assign(new Error('x'), {
    code: 'RESERVATION_OVERLAP', error: 'Réservation sur ces dates : fermeture impossible.', reservations: [RESA],
  }));
  const dialog = await openClosure();
  await waitFor(() => expect(api.getClosureConflicts).toHaveBeenCalled());
  await userEvent.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
  const red = await within(dialog).findByRole('alert');
  expect(within(red).getAllByText('Réservation sur ces dates : fermeture impossible.')).toHaveLength(1);
  expect(within(red).getByRole('link', { name: `Ouvrir : ${RESA.label}` })).toBeInTheDocument();
});

test('rule 41: back on the tab the lines are asked again (a request withdrawn meanwhile disappears)', async () => {
  api.getClosureConflicts.mockResolvedValueOnce({ ...NONE, requests: [REQUEST] }).mockResolvedValue(NONE);
  const dialog = await openClosure();
  await within(dialog).findByRole('status');
  fireEvent(window, new Event('focus'));
  await waitFor(() => expect(within(dialog).queryByRole('status')).toBeNull());
  expect(api.getClosureConflicts).toHaveBeenCalledTimes(2);
});

test('phone: « Ouvrir » stays in the same tab', async () => {
  window.matchMedia = media(true);
  api.getClosureConflicts.mockResolvedValue({ ...NONE, devis: [DEVIS] });
  const dialog = await openClosure();
  const link = await within(dialog).findByRole('link', { name: `Ouvrir : ${DEVIS.label}` });
  expect(link).not.toHaveAttribute('target');
});
