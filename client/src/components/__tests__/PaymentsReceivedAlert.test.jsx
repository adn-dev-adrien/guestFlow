// server-test-isolation.md rule 11 — a « nothing shown » check first waits for the answer that could show it.
/**
 * PaymentsReceivedAlert — the home card « Paiements reçus »: renders the server's lines as they come, one clickable line
 * per payment, nothing when the list is empty or the call fails. specs/payments/online-payment-notices.md rule 5.
 */
import React from 'react';
import { vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';

vi.mock('../../api', () => ({
  __esModule: true,
  default: { getPaymentsReceived: vi.fn() },
}));

import api from '../../api';
import PaymentsReceivedAlert from '../PaymentsReceivedAlert';

const ATTENTION = { key: 'payments-received', severity: 'info', count: 2, title: 'Paiements reçus', detail: 'Sur les dernières 24 h' };

beforeEach(() => {
  api.getPaymentsReceived.mockReset();
});

const line = (over = {}) => ({
  reservationId: 812, clientName: 'Camille Martin', propertyName: 'Gîte', bucketLabel: 'Acompte',
  amountLabel: '320 €', whenLabel: 'jeudi 26 novembre à 14 h 05', ...over,
});

// specs/payments/online-payment-notices.md rule 5
test('renders nothing while the call is pending, when empty, and on error', async () => {
  api.getPaymentsReceived.mockReturnValue(new Promise(() => {}));
  const pending = render(<PaymentsReceivedAlert attention={ATTENTION} />);
  expect(pending.container.firstChild).toBeNull();
  pending.unmount();

  api.getPaymentsReceived.mockResolvedValue({ alerts: [] });
  const empty = render(<PaymentsReceivedAlert attention={ATTENTION} />);
  await act(() => api.getPaymentsReceived.mock.results.at(-1).value);
  expect(empty.container.firstChild).toBeNull();
  empty.unmount();

  api.getPaymentsReceived.mockRejectedValue(new Error('boom'));
  const failed = render(<PaymentsReceivedAlert attention={ATTENTION} />);
  await act(() => api.getPaymentsReceived.mock.results.at(-1).value.catch(() => {}));
  expect(failed.container.firstChild).toBeNull();
});

// specs/payments/online-payment-notices.md rule 5
test('renders the server lines — guest, bucket, amount, time — each opening its fiche', async () => {
  api.getPaymentsReceived.mockResolvedValue({
    alerts: [line(), line({ reservationId: 813, clientName: 'Marie Durand', bucketLabel: 'Solde', amountLabel: '1 200 €' })],
  });
  render(<PaymentsReceivedAlert attention={ATTENTION} />);
  expect(await screen.findByText('Paiements reçus')).toBeInTheDocument();
  expect(screen.getByText('Camille Martin')).toBeInTheDocument();
  expect(screen.getByText('320 €')).toBeInTheDocument();
  expect(screen.getByText('Acompte · Gîte')).toBeInTheDocument();
  expect(screen.getAllByText('jeudi 26 novembre à 14 h 05')).toHaveLength(2);
  expect(screen.getByRole('link', { name: 'Ouvrir la fiche de Camille Martin' })).toHaveAttribute('href', expect.stringContaining('/reservations/812'));
  expect(screen.getByRole('link', { name: 'Ouvrir la fiche de Marie Durand' })).toHaveAttribute('href', expect.stringContaining('/reservations/813'));
});
