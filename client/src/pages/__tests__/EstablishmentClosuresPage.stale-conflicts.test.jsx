// specs/payment-link-lifecycle.md rule 62 (audit R10-C1) — a « conflicts » answer that comes back after the
// dialog was closed, reopened, or its range made invalid is dropped: the lines only ever describe the
// dates the dialog shows now.
import React from 'react';
import { vi } from 'vitest';
import { render, screen, within, waitFor, fireEvent, act } from '@testing-library/react';
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
import { CLOSURE, NONE, media } from './establishmentClosuresFixtures';

const RESA = { id: 7, label: '22341 · Cy Test', detail: 'Gîte', url: '/reservations/7' };
const REQUEST = { reservationId: 12, linkId: 41, kind: 'devis', label: 'Devis D-2026-118 · Ana Test', detail: '840,00 €', url: '/reservations/new?mode=devis&devisId=12' };
const DEVIS = { reservationId: 13, label: 'Devis D-2026-121 · Bo Test', detail: 'Gîte', url: '/reservations/new?mode=devis&devisId=13' };
const LATE = { reservations: [RESA], requests: [REQUEST], devis: [DEVIS] };

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

let orig;
beforeEach(() => {
  vi.clearAllMocks();
  orig = window.matchMedia;
  window.matchMedia = media(false);
  api.getEstablishmentClosures.mockResolvedValue([CLOSURE]);
  api.getProperties.mockResolvedValue([{ id: 1, name: 'Gîte' }]);
});
afterEach(() => { window.matchMedia = orig; });

async function openClosurePending() {
  const late = deferred();
  api.getClosureConflicts.mockReturnValueOnce(late.promise).mockResolvedValue(NONE);
  render(<MemoryRouter><DialogProvider><EstablishmentClosuresPage /></DialogProvider></MemoryRouter>);
  fireEvent.click(await screen.findByText('Travaux'));
  const dialog = await screen.findByRole('dialog');
  await waitFor(() => expect(api.getClosureConflicts).toHaveBeenCalledTimes(1));
  return { dialog, late };
}

test('rule 62: closed then reopened as « Ajouter une fermeture », the late answer of the old closure is dropped', async () => {
  const { dialog, late } = await openClosurePending();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Annuler' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await userEvent.click(screen.getByRole('button', { name: /Ajouter/ }));
  const fresh = await screen.findByRole('dialog');
  expect(within(fresh).getByText('Ajouter une fermeture')).toBeInTheDocument();
  await act(async () => { late.resolve(LATE); await late.promise; });
  expect(within(fresh).queryByRole('alert')).toBeNull();
  expect(within(fresh).queryByRole('status')).toBeNull();
  expect(within(fresh).queryByText('Réservation sur ces dates : fermeture impossible.')).toBeNull();
});

test('rule 62: the range made invalid while the look is in flight, the late answer is dropped', async () => {
  const { dialog, late } = await openClosurePending();
  const end = within(dialog).getByRole('group', { name: 'Réouverture' });
  const year = within(end).getByRole('spinbutton', { name: 'Année' });
  act(() => year.focus());
  fireEvent.keyDown(year, { key: 'ArrowDown' });
  expect(year).toHaveTextContent(String(dayjs(CLOSURE.endDate).year() - 1));
  await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Enregistrer' })).toBeDisabled());
  await act(async () => { late.resolve(LATE); await late.promise; });
  expect(within(dialog).queryByRole('alert')).toBeNull();
  expect(within(dialog).queryByRole('status')).toBeNull();
  expect(api.getClosureConflicts).toHaveBeenCalledTimes(1);
});
