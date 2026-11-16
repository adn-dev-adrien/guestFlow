// specs/mollie-rolling-reserve-and-incoming-payments.md rule 22 — a sale outside a stay has no fiche: its block and its
// lines carry `reservationId: null` and `saleKey`, and open nothing (no link, no crash).
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import DialogProvider from '../../DialogProvider';
import IncomingPaymentsTable from '../IncomingPaymentsTable';

const item = (key, extra = {}) => ({
  key, kind: 'mollieTransit', label: 'Mollie en transit', icon: 'hourglass', natureLabel: 'Paiement carte · 80 %', natureDetail: 'Versement immédiat de Mollie',
  amountCents: 1120, expectedDate: '2026-11-09', receivedDate: null, dateLabel: 'lun. 09/11', state: 'upcoming', stateLabel: 'Dans 2 jours', tone: 'neutral',
  refs: { qonto: null, mollieSettlement: null, molliePayment: null }, ...extra,
});
const sale = (extra = {}) => ({ reservationId: null, saleKey: 'resource-booking:41', label: 'Bain nordique du 05/11', startDate: null, endDate: null, items: [item('mollie:sale:41')], ...extra });
const data = (stays) => ({
  totals: { amount: 11.2, amountCents: 1120, clients: 1, nextDate: '2026-11-09', nextDateLabel: 'lun. 09/11' },
  kinds: [{ key: 'mollieTransit', label: 'Mollie en transit', count: 1 }],
  clients: [{ clientId: null, name: 'Marc Exemple', totalCents: 1120, nextDate: '2026-11-09', nextDateLabel: 'lun. 09/11', late: false, stays }],
});
const renderTable = (stays) => {
  const onOpenReservation = vi.fn();
  render(<DialogProvider><IncomingPaymentsTable data={data(stays)} recent={false} onRecentChange={() => {}} onOpenReservation={onOpenReservation} /></DialogProvider>);
  return onOpenReservation;
};

test('a client whose only stay is a sale outside a stay renders without a fiche link', async () => {
  const onOpenReservation = renderTable([sale()]);
  const block = within(screen.getByRole('region', { name: 'Marc Exemple' }));
  expect(block.getByText('Paiement carte · 80 %')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Ouvrir la fiche/ })).not.toBeInTheDocument();
  expect(screen.queryByText('Ouvrir la fiche')).not.toBeInTheDocument();
  await userEvent.click(block.getByText('Paiement carte · 80 %'));
  expect(onOpenReservation).not.toHaveBeenCalled();
});

test('with a stay and a sale, only the stay\'s lines open a fiche', async () => {
  const stay = { reservationId: 7, saleKey: null, label: 'Gîte · 01/11 → 05/11/2026', items: [item('mollie:7|balance#immediat', { natureLabel: 'Paiement carte · 80 % du solde' })] };
  const onOpenReservation = renderTable([stay, sale()]);
  const block = within(screen.getByRole('region', { name: 'Marc Exemple' }));
  await userEvent.click(block.getByText('Paiement carte · 80 %'));
  expect(onOpenReservation).not.toHaveBeenCalled();
  await userEvent.click(block.getByRole('button', { name: /Ouvrir la fiche : Paiement carte · 80 % du solde/ }));
  expect(onOpenReservation).toHaveBeenCalledWith(7);
  expect(block.getAllByRole('button', { name: /Ouvrir la fiche/ })).toHaveLength(1);
});
