// specs/payment-link-lifecycle.md rule 61 (audit R10-C1) — a « conflicts » answer that comes back after the
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

const inDays = (n) => dayjs().add(n, 'day').format('YYYY-MM-DD');
const CLOSURE = { id: 5, propertyId: 1, propertyName: 'Gîte', label: 'Travaux', startDate: inDays(30), endDate: inDays(33) };
const RESA = { id: 7, label: '22341 · Cy Test', detail: 'Gîte', url: '/reservations/7' };
const NONE = { reservations: [], requests: [], devis: [] };

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

let orig;
beforeEach(() => {
  vi.clearAllMocks();
  orig = window.matchMedia;
  window.matchMedia = (query) => ({
    matches: false, media: query, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false; },
  });
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

test('rule 61: closed then reopened as « Ajouter une fermeture », the late answer of the old closure is dropped', async () => {
  const { dialog, late } = await openClosurePending();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Annuler' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await userEvent.click(screen.getByRole('button', { name: /Ajouter/ }));
  const fresh = await screen.findByRole('dialog');
  expect(within(fresh).getByText('Ajouter une fermeture')).toBeInTheDocument();
  await act(async () => { late.resolve({ ...NONE, reservations: [RESA] }); await late.promise; });
  expect(within(fresh).queryByRole('alert')).toBeNull();
  expect(within(fresh).queryByText('Réservation sur ces dates : fermeture impossible.')).toBeNull();
});

test('rule 61: the range made invalid while the look is in flight, the late answer is dropped', async () => {
  const { dialog, late } = await openClosurePending();
  const end = within(dialog).getByRole('group', { name: 'Réouverture' });
  const year = within(end).getByRole('spinbutton', { name: 'Année' });
  act(() => year.focus());
  fireEvent.keyDown(year, { key: 'ArrowDown' });
  expect(year).toHaveTextContent(String(dayjs(CLOSURE.endDate).year() - 1));
  await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Enregistrer' })).toBeDisabled());
  await act(async () => { late.resolve({ ...NONE, reservations: [RESA] }); await late.promise; });
  expect(within(dialog).queryByRole('alert')).toBeNull();
  expect(api.getClosureConflicts).toHaveBeenCalledTimes(1);
});
