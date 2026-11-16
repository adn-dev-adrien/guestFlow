// specs/mollie-rolling-reserve-and-incoming-payments.md rule 13 and 22 — a late reserve of a sale outside a stay
// (reservationId null, saleKey set) is listed by the sale's name and opens no fiche.
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router';
import { vi } from 'vitest';

vi.mock('../../../api', () => ({ __esModule: true, default: { getMollieReserveAttention: vi.fn() } }));
import api from '../../../api';
import MollieReserveAlert from '../MollieReserveAlert';

const ATTENTION = { key: 'mollie-reserve-late', severity: 'todo', count: 1, title: 'Retenue Mollie non reçue', detail: '1 retenue attendue' };
// date-literal-ok: fixture data drawn as given; nothing compares it with today
const SALE = { reservationId: null, saleKey: 'resource-booking:41', saleLabel: 'Bain nordique du 05/11', clientName: 'Bain nordique du 05/11', amountCents: 280, expectedDate: '2026-11-10', expectedDateLabel: '10/11', line: 'Bain nordique du 05/11 · 2,80 € · attendue le 10/11' };

test('a late reserve of a sale outside a stay is listed by its label and is not a link', async () => {
  api.getMollieReserveAttention.mockResolvedValue({ count: 1, items: [SALE] });
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<MollieReserveAlert attention={ATTENTION} />} />
        <Route path="/reservations/:id" element={<div>Fiche ouverte</div>} />
      </Routes>
    </MemoryRouter>,
  );
  expect(await screen.findByText(/Bain nordique du 05\/11/)).toBeInTheDocument();
  expect(screen.getByText(/attendue le 10\/11/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Bain nordique du 05\/11/ })).not.toBeInTheDocument();
  await userEvent.click(screen.getByText(/Bain nordique du 05\/11/));
  expect(screen.queryByText('Fiche ouverte')).not.toBeInTheDocument();
});
