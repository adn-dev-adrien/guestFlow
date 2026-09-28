import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
  const { container } = render(<GateKeysAlert />);
  await waitFor(() => expect(api.getGateKeysAlerts).toHaveBeenCalled());
  expect(container).toBeEmptyDOMElement();
});

test('renders nothing either when the server does not answer', async () => {
  api.getGateKeysAlerts.mockRejectedValue(new Error('403'));
  const { container } = render(<GateKeysAlert />);
  await waitFor(() => expect(api.getGateKeysAlerts).toHaveBeenCalled());
  expect(container).toBeEmptyDOMElement();
});

// specs/gate-access-sowel-connector.md §3.3 rule 13
test('a failed key shows the number, the first name and the reason, and opens the reservation', async () => {
  api.getGateKeysAlerts.mockResolvedValue({ failures: [failure()], stale: false, lastReadAt: null });
  render(<GateKeysAlert />);

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
  render(<GateKeysAlert />);
  expect(await screen.findByText(/Clé portail non révoquée/)).toBeInTheDocument();
  expect(screen.queryByRole('button')).toBeNull();
});

// specs/gate-access-sowel-connector.md §3.3 rule 17
test('a Sowel that stopped reading shows since when, in Paris time', async () => {
  api.getGateKeysAlerts.mockResolvedValue({ failures: [], stale: true, lastReadAt: '2026-09-27T12:05:00.000Z' });
  render(<GateKeysAlert />);
  expect(await screen.findByText(/Sowel ne lit plus les clés depuis le 27 septembre à 14:05/)).toBeInTheDocument();
});
