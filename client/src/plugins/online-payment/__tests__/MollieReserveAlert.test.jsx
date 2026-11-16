// specs/mollie-rolling-reserve-and-incoming-payments.md rule 13 — the home's « Retenue Mollie non reçue »: the late reserve
// receipts of the reconciliation, one line per fiche, a click opens it; the card's words are the server's attention subject.
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router';
import { vi } from 'vitest';

vi.mock('../../../api', () => ({ __esModule: true, default: { getReconciliation: vi.fn() } }));
import api from '../../../api';
import MollieReserveAlert from '../MollieReserveAlert';
import pluginModule from '../index';

const ATTENTION = { key: 'mollie-reserve-late', severity: 'todo', count: 1, title: 'Retenue Mollie non reçue', detail: '1 retenue attendue' };
const LATE = { key: '102|balance#retenue', state: 'late', label: 'Solde · retenue Mollie', expectedCents: 19680, fixText: null, reservation: { id: 102, clientName: 'Lucia Rossi' }, mollie: { tranche: 'retenue', expectedDateLabel: '10/11' } };
const IMMEDIATE_LATE = { ...LATE, key: '103|balance#immediat', mollie: { tranche: 'immediat', expectedDateLabel: '12/11' }, reservation: { id: 103, clientName: 'Autre' } };

const renderAlert = () => render(
  <MemoryRouter initialEntries={['/']}>
    <Routes>
      <Route path="/" element={<MollieReserveAlert attention={ATTENTION} />} />
      <Route path="/reservations/:id" element={<div>Fiche ouverte</div>} />
    </Routes>
  </MemoryRouter>,
);

test('the plugin contributes the alert for the attention subject `mollie-reserve-late`', () => {
  expect(pluginModule.contributes['dashboard.alerts'].map((a) => a.key)).toContain('mollie-reserve-late');
});

test('only the late reserve lines are listed, with the expected date, and a click opens the fiche', async () => {
  api.getReconciliation.mockResolvedValue({ items: [LATE, IMMEDIATE_LATE] });
  renderAlert();
  expect(await screen.findByText('Retenue Mollie non reçue')).toBeInTheDocument();
  expect(screen.getByText(/Lucia Rossi/)).toBeInTheDocument();
  expect(screen.getByText(/attendue vers le 10\/11/)).toBeInTheDocument();
  expect(screen.queryByText(/Autre/)).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /Lucia Rossi/ }));
  expect(await screen.findByText('Fiche ouverte')).toBeInTheDocument();
});

test('a failed read draws the card without its list, never an error', async () => {
  api.getReconciliation.mockRejectedValue(new Error('boom'));
  renderAlert();
  expect(await screen.findByText('Retenue Mollie non reçue')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Lucia/ })).not.toBeInTheDocument();
});
