// specs/payments/mollie-rolling-reserve-and-incoming-payments.md rule 30 (and 22) — a clearing-account client that comes from a sale
// outside a stay has `reservationId` null: no link to a fiche, a React key of its own, no collision between two sales.
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import MollieClearingCard from '../MollieClearingCard';

const MOLLIE = {
  // date-literal-ok: fixture data drawn as given; nothing compares it with today
  clearing: { account: '46720000', asOf: '2026-11-30', balance: 50.4, clients: [
    { reservationId: 7, saleKey: null, clientName: 'Claire Martin', balance: 39.36 },
    { reservationId: null, saleKey: 'resource-booking:41', clientName: 'Bain nordique du 05/11', balance: 5.52 },
    { reservationId: null, saleKey: 'resource-booking:42', clientName: 'Bain nordique du 05/11', balance: 5.52 },
  ] },
  unattached: [],
};

test('only the client with a fiche is a link; the sales render as plain text without warnings', async () => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  const onOpen = vi.fn();
  render(<MollieClearingCard mollie={MOLLIE} canOpenReservation onOpenReservation={onOpen} />);
  expect(screen.getAllByText('Bain nordique du 05/11')).toHaveLength(2);
  expect(screen.queryByRole('button', { name: 'Bain nordique du 05/11' })).not.toBeInTheDocument();
  await userEvent.click(screen.getAllByText('Bain nordique du 05/11')[0]);
  expect(onOpen).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Claire Martin' }));
  expect(onOpen).toHaveBeenCalledWith(7);
  expect(errors.mock.calls.filter((c) => /same key|unique "key"/.test(String(c[0])))).toHaveLength(0);
  errors.mockRestore();
});
