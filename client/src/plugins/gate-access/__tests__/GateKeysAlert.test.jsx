// server-test-isolation.md rule 11 — a « nothing shown » check first waits for the answer that could show it.
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { vi } from 'vitest';

// specs/gate-access-sowel-connector.md §3.3 rules 13 + 17 — the dashboard alert of the Sowel
// gate-keys connector: the keys Sowel could not make, and a Sowel that stopped reading the list.
// Rule 16: it renders nothing when there is nothing to say.

const navigate = vi.fn();
vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useNavigate: () => navigate };
});
vi.mock('../../../api', () => ({
  __esModule: true,
  default: { getGateKeysAlerts: vi.fn() },
}));

import api from '../../../api';
import GateKeysAlert from '../GateKeysAlert';

// The home's subject this card draws (specs/shell-and-home-day-first.md rule 6 — server-made).
const ATTENTION = { key: 'gate-keys', severity: 'urgent', count: 1, title: 'Clés portail', detail: '' };

const failure = (over = {}) => ({
  reservationId: 123,
  reservationNumber: 'R-2026-041',
  guestFirstName: 'Marie',
  name: 'R-2026-041 · Marie',
  action: 'create',
  title: 'Clé portail non créée',
  reason: "le profil par défaut n'est pas accordé au plugin",
  exists: true,
  ...over,
});

beforeEach(() => { vi.clearAllMocks(); });

// specs/gate-access-sowel-connector.md §3.3 rule 16
test('renders nothing when no key failed and Sowel reads', async () => {
  api.getGateKeysAlerts.mockResolvedValue({ failures: [], stale: false, lastReadAt: '2026-09-27T16:00:00.000Z' });
  const { container } = render(<GateKeysAlert attention={ATTENTION} />);
  await act(() => api.getGateKeysAlerts.mock.results.at(-1).value);
  expect(container).toBeEmptyDOMElement();
});

// specs/shell-and-home-day-first.md rule 20 — an unreadable list is said, not hidden.
test('when the list cannot be read, the pinned card says so with the server words', async () => {
  api.getGateKeysAlerts.mockRejectedValue(new Error('503'));
  render(<GateKeysAlert attention={{ ...ATTENTION, detail: 'Lecture des clés impossible' }} />);
  expect(await screen.findByText('Lecture des clés impossible')).toBeInTheDocument();
  expect(screen.getByText('Clés portail')).toBeInTheDocument();
});

// specs/gate-access-sowel-connector.md §3.3 rule 13
test('a failed key shows the number, the first name and the reason, and opens the reservation', async () => {
  api.getGateKeysAlerts.mockResolvedValue({ failures: [failure()], stale: false, lastReadAt: null });
  render(<GateKeysAlert attention={ATTENTION} />);

  expect(await screen.findByText('Clés portail')).toBeInTheDocument();
  expect(screen.getByText('R-2026-041 · Marie — Clé portail non créée')).toBeInTheDocument();
  expect(screen.getByText("le profil par défaut n'est pas accordé au plugin")).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button'));
  expect(navigate).toHaveBeenCalledWith('/reservations/123');
});

test('a failure on a deleted reservation is listed but opens nothing', async () => {
  api.getGateKeysAlerts.mockResolvedValue({
    failures: [failure({ exists: false, action: 'revoke', title: 'Clé portail non révoquée' })],
    stale: false,
  });
  render(<GateKeysAlert attention={ATTENTION} />);
  expect(await screen.findByText(/Clé portail non révoquée/)).toBeInTheDocument();
  expect(screen.queryByRole('button')).toBeNull();
});

// specs/gate-access-sowel-connector.md §3.3 rule 17
test('a Sowel that stopped reading shows since when, in Paris time', async () => {
  api.getGateKeysAlerts.mockResolvedValue({ failures: [], stale: true, lastReadAt: '2026-09-27T12:05:00.000Z' });
  render(<GateKeysAlert attention={ATTENTION} />);
  expect(await screen.findByText(/Sowel ne lit plus les clés depuis le 27 septembre à 14:05/)).toBeInTheDocument();
});
