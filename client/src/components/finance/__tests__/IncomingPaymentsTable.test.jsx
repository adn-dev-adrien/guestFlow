// specs/mollie-rolling-reserve-and-incoming-payments.md rules 22-27 — « Versements à venir »: one block per client,
// lines in the server's order (late first), colour = state only, nature filter chips, the « Reçus ces 30 derniers
// jours » switch, header / line click opens the fiche, the empty sentence. Nothing is computed by the component.
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import DialogProvider from '../../DialogProvider';
import IncomingPaymentsTable from '../IncomingPaymentsTable';

const item = (key, kind, icon, extra = {}) => ({
  key, kind, label: kind, icon, natureLabel: 'Retenue Mollie', natureDetail: '20 % retenus pendant 90 jours · Solde',
  amountCents: 14648, expectedDate: '2027-02-11', receivedDate: null, dateLabel: 'jeu. 11/02', state: 'upcoming',
  stateLabel: 'Dans 3 mois', tone: 'neutral', refs: { qonto: null, mollieSettlement: null, molliePayment: null }, ...extra,
});

const DATA = {
  totals: { amount: 640.14, amountCents: 64014, clients: 3, nextDate: '2026-11-10', nextDateLabel: 'mar. 10/11' },
  kinds: [
    { key: 'mollieReserve', label: 'Retenue Mollie', count: 2 },
    { key: 'installment', label: 'Échéance', count: 2 },
  ],
  clients: [
    { clientId: 2, name: 'Lucia Rossi', totalCents: 19680, nextDate: '2026-11-10', nextDateLabel: 'mar. 10/11', late: true, stays: [
      { reservationId: 102, label: 'Gîte · 07/10 → 12/10/2026', items: [
        item('mollie:102|balance#retenue', 'mollieReserve', 'hourglass', { amountCents: 19680, dateLabel: 'mar. 10/11', state: 'late', stateLabel: 'En retard de 6 j', tone: 'error' }),
      ] },
    ] },
    { clientId: 1, name: 'Jean Dupont', totalCents: 14648, nextDate: '2027-02-11', nextDateLabel: 'jeu. 11/02', late: false, stays: [
      { reservationId: 101, label: 'Cabane · 01/11 → 05/11/2026', items: [item('mollie:101|balance#retenue', 'mollieReserve', 'hourglass')] },
    ] },
    { clientId: 3, name: 'Anna Roux', totalCents: 29686, nextDate: '2026-12-01', nextDateLabel: 'mar. 01/12', late: false, stays: [
      { reservationId: 201, label: 'Gîte · 10/12 → 14/12/2026', items: [item('inst:201|2', 'installment', 'calendar', { natureLabel: 'Échéance 2 sur 4', natureDetail: 'Solde', amountCents: 10000, dateLabel: 'mar. 01/12', stateLabel: 'Dans 15 jours' })] },
      { reservationId: 202, label: 'Cabane · 20/12 → 22/12/2026', items: [item('inst:202|1', 'installment', 'calendar', { natureLabel: 'Échéance 1 sur 2', natureDetail: 'Acompte', amountCents: 19686, dateLabel: 'jeu. 03/12', stateLabel: 'Dans 17 jours' })] },
    ] },
  ],
};

const EMPTY = { totals: { amount: 0, amountCents: 0, clients: 0, nextDate: null, nextDateLabel: null }, kinds: [], clients: [] };

function renderTable(props = {}) {
  const onRecentChange = vi.fn();
  const onOpenReservation = vi.fn();
  render(<DialogProvider><IncomingPaymentsTable data={DATA} recent={false} onRecentChange={onRecentChange} onOpenReservation={onOpenReservation} {...props} /></DialogProvider>);
  return { onRecentChange, onOpenReservation };
}

const names = () => screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'));

test('rule 22: one block per client, in the server\'s order — the late one first', () => {
  renderTable();
  expect(names()).toEqual(['Lucia Rossi', 'Jean Dupont', 'Anna Roux']);
  expect(screen.getByRole('region', { name: 'Lucia Rossi' })).toHaveAttribute('data-late', 'true');
  expect(screen.getByRole('region', { name: 'Jean Dupont' })).not.toHaveAttribute('data-late');
});

test('rule 22: a line says date, nature in words with its detail, amount and state', () => {
  renderTable();
  const block = within(screen.getByRole('region', { name: 'Lucia Rossi' }));
  expect(block.getByText('mar. 10/11')).toBeInTheDocument();
  expect(block.getByText('Retenue Mollie')).toBeInTheDocument();
  expect(block.getByText(/20 % retenus pendant 90 jours · Solde/)).toBeInTheDocument();
  expect(block.getAllByText('196,80 €').length).toBeGreaterThan(0);
  expect(block.getByText('En retard de 6 j')).toBeInTheDocument();
});

test('rule 22: a legend says the colour carries the state only', () => {
  renderTable();
  expect(screen.getByText('La couleur ne dit que l’état :')).toBeInTheDocument();
  ['À venir', 'En retard', 'Reçu'].forEach((label) => expect(screen.getAllByText(label).length).toBeGreaterThan(0));
});

test('rule 22: the state colour follows the tone, whatever the nature', () => {
  renderTable();
  const late = getComputedStyle(screen.getByText('En retard de 6 j').closest('.MuiChip-root')).backgroundColor;
  const wait = getComputedStyle(screen.getByText('Dans 3 mois').closest('.MuiChip-root')).backgroundColor;
  const waitOtherKind = getComputedStyle(screen.getByText('Dans 15 jours').closest('.MuiChip-root')).backgroundColor;
  expect(late).not.toBe(wait);
  expect(wait).toBe(waitOtherKind);
});

test('rule 23: filter chips carry the kind and its count; switching one off hides its lines', async () => {
  renderTable();
  const chip = screen.getByRole('button', { name: /Échéance · 2/ });
  expect(chip).toHaveAttribute('aria-pressed', 'true');
  await userEvent.click(chip);
  expect(chip).toHaveAttribute('aria-pressed', 'false');
  expect(screen.queryByRole('region', { name: 'Anna Roux' })).not.toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Lucia Rossi' })).toBeInTheDocument();
  await userEvent.click(chip);
  expect(screen.getByRole('region', { name: 'Anna Roux' })).toBeInTheDocument();
});

test('rule 24: the « Reçus ces 30 derniers jours » switch asks the page for the other payload', async () => {
  const { onRecentChange } = renderTable();
  await userEvent.click(screen.getByRole('switch', { name: 'Reçus ces 30 derniers jours' }));
  expect(onRecentChange).toHaveBeenCalledWith(true);
});

test('rule 24: a received line shows its bank reference with a copy button', () => {
  const received = { ...DATA, clients: [{ ...DATA.clients[1], stays: [{ ...DATA.clients[1].stays[0], items: [item('r', 'mollieReserve', 'hourglass', { state: 'received', tone: 'success', stateLabel: 'Reçu le 30/10', refs: { qonto: 'solio-6791-1-transaction-019d1b2f-0001', mollieSettlement: 'T19274230.2610.01', molliePayment: null } })] }] }] };
  renderTable({ data: received, recent: true });
  expect(screen.getByText('Reçu le 30/10')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Copier la référence Qonto/ })).toBeInTheDocument();
  expect(screen.getByRole('switch', { name: 'Reçus ces 30 derniers jours' })).toBeChecked();
});

test('rule 22: the header of a client with one stay opens its fiche', async () => {
  const { onOpenReservation } = renderTable();
  await userEvent.click(screen.getByRole('button', { name: 'Ouvrir la fiche : Jean Dupont' }));
  expect(onOpenReservation).toHaveBeenCalledWith(101);
});

test('rule 22: the header is a ≥ 44 px tap target and opens with the keyboard', async () => {
  const { onOpenReservation } = renderTable();
  const header = screen.getByRole('button', { name: 'Ouvrir la fiche : Lucia Rossi' });
  expect(parseFloat(getComputedStyle(header).minHeight)).toBeGreaterThanOrEqual(44);
  header.focus();
  await userEvent.keyboard('{Enter}');
  expect(onOpenReservation).toHaveBeenCalledWith(102);
});

test('rule 22: a client with several stays names the stay on each line and opens THAT stay', async () => {
  const { onOpenReservation } = renderTable();
  const block = within(screen.getByRole('region', { name: 'Anna Roux' }));
  expect(block.queryByRole('button', { name: 'Ouvrir la fiche : Anna Roux' })).not.toBeInTheDocument();
  expect(block.getByText('Acompte · Cabane · 20/12 → 22/12/2026')).toBeInTheDocument();
  await userEvent.click(block.getByRole('button', { name: /Échéance 1 sur 2/ }));
  expect(onOpenReservation).toHaveBeenCalledWith(202);
});

test('rule 22: the empty state says everything expected has arrived', () => {
  renderTable({ data: EMPTY });
  expect(screen.getByText('Rien à recevoir : tout ce qui était attendu est arrivé.')).toBeInTheDocument();
  expect(screen.queryByRole('region')).not.toBeInTheDocument();
});

test('rule 27: the overlap with « En attente de règlement » is explained', () => {
  renderTable();
  expect(screen.getByText(/figurent dans les deux/)).toBeInTheDocument();
});
