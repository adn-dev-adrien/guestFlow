// specs/payment-link-lifecycle.md rules 43 and 66 — the dashboard card « Dates prises »: the server's rows, told or not,
// the stay that took the dates as a link, « Ouvrir » opens the stay, « Vu » takes the row off; nothing at all when the
// list is empty or unreadable.
import React from 'react';
import { render as rtlRender, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import DatesTakenAlert from '../DatesTakenAlert';
import api from '../../api';

const ATTENTION = { key: 'dates-taken', severity: 'todo', count: 2, title: 'Dates prises', detail: '2 séjours · 1 client non prévenu' };

const mockNavigate = vi.fn();
vi.mock('react-router', async (importOriginal) => ({ ...(await importOriginal()), useNavigate: () => mockNavigate }));
vi.mock('../../api', () => ({ __esModule: true, default: { getDatesTakenAlerts: vi.fn(), acknowledgeDatesTaken: vi.fn() } }));

const TOLD = {
  id: 7, reservationId: 42, url: '/reservations/42', title: 'Paul Martin · La Granja · 08/11 → 12/11',
  notice: { sent: true, label: 'client prévenu' }, detail: null,
  takenBy: { id: 9, url: '/reservations/9', label: 'Prises par la réservation 22341 · Marie Dupont' },
};
const NOT_TOLD = {
  id: 8, reservationId: 43, url: '/reservations/43', title: 'Ana Ruiz · Estiva · 10/11 → 12/11',
  notice: { sent: false, label: 'client non prévenu' }, detail: 'Raison : pas d’adresse e-mail.',
  takenBy: { id: null, url: null, label: 'Prises par une autre réservation' },
};

const render = (ui) => rtlRender(<MemoryRouter>{ui}</MemoryRouter>);

beforeEach(() => { vi.clearAllMocks(); });

test('rule 43 — each stay with its words: told or not, and why', async () => {
  api.getDatesTakenAlerts.mockResolvedValue({ alerts: [TOLD, NOT_TOLD] });
  render(<DatesTakenAlert attention={ATTENTION} />);
  expect(await screen.findByText('Paul Martin · La Granja · 08/11 → 12/11')).toBeInTheDocument();
  expect(screen.getByText('client prévenu')).toBeInTheDocument();
  expect(screen.getByText('client non prévenu')).toBeInTheDocument();
  expect(screen.getByText('Raison : pas d’adresse e-mail.')).toBeInTheDocument();
  expect(screen.queryByText(/Client non prévenu :/)).toBeNull();
});

test('rule 66 (review of #912, n2) — the stay that took the dates opens from the card; an unknown one is plain text', async () => {
  api.getDatesTakenAlerts.mockResolvedValue({ alerts: [TOLD, NOT_TOLD] });
  render(<DatesTakenAlert attention={ATTENTION} />);
  const link = await screen.findByRole('link', { name: 'Prises par la réservation 22341 · Marie Dupont' });
  expect(link).toHaveAttribute('href', '/reservations/9');
  expect(screen.getByText('Prises par une autre réservation').closest('a')).toBeNull();
});

test('rule 43 — « Ouvrir » opens the stay; « Vu » acknowledges and drops the row', async () => {
  api.getDatesTakenAlerts.mockResolvedValue({ alerts: [TOLD, NOT_TOLD] });
  api.acknowledgeDatesTaken.mockResolvedValue({ ok: true });
  render(<DatesTakenAlert attention={ATTENTION} />);
  await screen.findByText(TOLD.title);
  await userEvent.click(screen.getAllByRole('button', { name: 'Ouvrir' })[1]);
  expect(mockNavigate).toHaveBeenCalledWith('/reservations/43');
  await userEvent.click(screen.getByRole('button', { name: `Vu : ${TOLD.title}` }));
  expect(api.acknowledgeDatesTaken).toHaveBeenCalledWith(7);
  await waitFor(() => expect(screen.queryByText(TOLD.title)).not.toBeInTheDocument());
  expect(screen.getByText(NOT_TOLD.title)).toBeInTheDocument();
});

test('rule 43 — a refused « Vu » reads the list again', async () => {
  api.getDatesTakenAlerts.mockResolvedValue({ alerts: [TOLD] });
  api.acknowledgeDatesTaken.mockRejectedValue(new Error('boom'));
  render(<DatesTakenAlert attention={ATTENTION} />);
  await userEvent.click(await screen.findByRole('button', { name: `Vu : ${TOLD.title}` }));
  await waitFor(() => expect(api.getDatesTakenAlerts).toHaveBeenCalledTimes(2));
  expect(screen.getByText(TOLD.title)).toBeInTheDocument();
});

test('rule 43 — nothing to show, or a failed read: no card', async () => {
  api.getDatesTakenAlerts.mockResolvedValue({ alerts: [] });
  const { container, unmount } = render(<DatesTakenAlert attention={ATTENTION} />);
  await waitFor(() => expect(api.getDatesTakenAlerts).toHaveBeenCalled());
  expect(container).toBeEmptyDOMElement();
  unmount();
  api.getDatesTakenAlerts.mockRejectedValue(new Error('boom'));
  const second = render(<DatesTakenAlert attention={ATTENTION} />);
  await waitFor(() => expect(api.getDatesTakenAlerts).toHaveBeenCalledTimes(2));
  expect(second.container).toBeEmptyDOMElement();
});
