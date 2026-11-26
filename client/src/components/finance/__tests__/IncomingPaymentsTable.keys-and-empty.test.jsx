// specs/payments/mollie-rolling-reserve-and-incoming-payments.md rules 22 and 24 — two blocks without a `clientId` that share a name
// are distinct blocks (unique key, no React warning); the empty state of « Reçus ces 30 derniers jours » does not claim
// that everything expected has arrived.
import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import DialogProvider from '../../DialogProvider';
import IncomingPaymentsTable from '../IncomingPaymentsTable';

const item = (key) => ({
  key, kind: 'mollieTransit', label: 'Mollie en transit', icon: 'hourglass', natureLabel: 'Paiement carte · 80 %', natureDetail: '',
  // date-literal-ok: fixture data drawn as given; nothing compares it with today
  amountCents: 1120, expectedDate: '2026-11-09', receivedDate: null, dateLabel: 'lun. 09/11', state: 'upcoming', stateLabel: 'Dans 2 jours', tone: 'neutral',
  refs: { qonto: null, mollieSettlement: null, molliePayment: null },
});
const block = (saleKey) => ({
  // date-literal-ok: fixture data drawn as given; nothing compares it with today
  clientId: null, name: 'Bain nordique', totalCents: 1120, nextDate: '2026-11-09', nextDateLabel: 'lun. 09/11', late: false,
  stays: [{ reservationId: null, saleKey, label: 'Bain nordique', startDate: null, endDate: null, items: [item(`mollie:${saleKey}`)] }],
});
const render_ = (data, recent = false) => render(
  <DialogProvider><IncomingPaymentsTable data={data} recent={recent} onRecentChange={() => {}} onOpenReservation={() => {}} /></DialogProvider>,
);

test('two sales named alike without a client are two blocks with their own keys', () => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  render_({ totals: { clients: 2 }, kinds: [], clients: [block('resource-booking:41'), block('resource-booking:42')] });
  expect(screen.getAllByRole('region', { name: 'Bain nordique' })).toHaveLength(2);
  const keys = screen.getAllByRole('region').map((el) => el.getAttribute('data-client'));
  expect(new Set(keys).size).toBe(2);
  expect(errors.mock.calls.filter((c) => /same key|unique "key"/.test(String(c[0])))).toHaveLength(0);
  errors.mockRestore();
});

test('rule 24: nothing received in the last 30 days says so, without « tout ce qui était attendu est arrivé »', () => {
  render_({ totals: { clients: 0 }, kinds: [], clients: [] }, true);
  expect(screen.getByText('Rien de reçu ces 30 derniers jours.')).toBeInTheDocument();
  expect(screen.queryByText(/tout ce qui était attendu/)).not.toBeInTheDocument();
});

test('with nothing to come, the empty state keeps its own sentence', () => {
  render_({ totals: { clients: 0 }, kinds: [], clients: [] }, false);
  expect(screen.getByText('Rien à recevoir : tout ce qui était attendu est arrivé.')).toBeInTheDocument();
});
