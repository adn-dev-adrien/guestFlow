// specs/mollie-rolling-reserve-and-incoming-payments.md rule 13 and 22 — a late reserve of a sale outside a stay (reservation id
// null, sale key set) is listed by the sale's name and opens no fiche.
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router';
import { vi } from 'vitest';

vi.mock('../../../api', () => ({ __esModule: true, default: { getReconciliation: vi.fn() } }));
import api from '../../../api';
import MollieReserveAlert from '../MollieReserveAlert';

const ATTENTION = { key: 'mollie-reserve-late', severity: 'todo', count: 1, title: 'Retenue Mollie non reçue', detail: '1 retenue attendue' };
const SALE = {
  key: '0|sale:resource-booking:41#retenue', state: 'late', label: 'Bain nordique · retenue Mollie', expectedCents: 280, fixText: null,
  reservation: { id: null, saleKey: 'resource-booking:41', saleLabel: 'Bain nordique du 05/11', clientName: '', hasClient: false }, mollie: { tranche: 'retenue', expectedDateLabel: '10/11' },
};

test('a late reserve of a sale outside a stay is listed by its label and is not a link', async () => {
  api.getReconciliation.mockResolvedValue({ items: [SALE] });
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<MollieReserveAlert attention={ATTENTION} />} />
        <Route path="/reservations/:id" element={<div>Fiche ouverte</div>} />
      </Routes>
    </MemoryRouter>,
  );
  expect(await screen.findByText(/Bain nordique du 05\/11/)).toBeInTheDocument();
  expect(screen.getByText(/attendue vers le 10\/11/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Bain nordique du 05\/11/ })).not.toBeInTheDocument();
  await userEvent.click(screen.getByText(/Bain nordique du 05\/11/));
  expect(screen.queryByText('Fiche ouverte')).not.toBeInTheDocument();
});
