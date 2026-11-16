// specs/mollie-rolling-reserve-and-incoming-payments.md rule 13 — the home's « Retenue Mollie non reçue »: the server's
// late-reserve attention, one line per fiche (oldest expected date first), a click opens the fiche; the card's words
// are the server's attention subject.
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router';
import { vi } from 'vitest';

vi.mock('../../../api', () => ({ __esModule: true, default: { getMollieReserveAttention: vi.fn() } }));
import api from '../../../api';
import MollieReserveAlert from '../MollieReserveAlert';
import pluginModule from '../index';

const ATTENTION = { key: 'mollie-reserve-late', severity: 'todo', count: 2, title: 'Retenue Mollie non reçue', detail: '2 fiches · la plus ancienne attendue le 08/11' };
// date-literal-ok: fixture data drawn as given; nothing compares it with today
const OLDEST = { reservationId: 101, saleKey: null, clientName: 'Jean Dupont', amountCents: 14648, expectedDate: '2026-11-08', expectedDateLabel: '08/11', line: 'Jean Dupont · 146,48 € · attendue le 08/11' };
// date-literal-ok: fixture data drawn as given; nothing compares it with today
const NEWER = { reservationId: 102, saleKey: null, clientName: 'Lucia Rossi', amountCents: 19680, expectedDate: '2026-11-10', expectedDateLabel: '10/11', line: 'Lucia Rossi · 196,80 € · attendue le 10/11' };

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

test('one line per fiche, in the server\'s order, with the date it was expected; a click opens the fiche', async () => {
  api.getMollieReserveAttention.mockResolvedValue({ count: 2, items: [OLDEST, NEWER] });
  renderAlert();
  expect(await screen.findByText('Retenue Mollie non reçue')).toBeInTheDocument();
  const lines = screen.getAllByRole('button', { name: /€/ });
  expect(lines).toHaveLength(2);
  expect(lines[0]).toHaveTextContent('Jean Dupont · 146,48 € · attendue le 08/11');
  expect(lines[1]).toHaveTextContent('Lucia Rossi');
  await userEvent.click(lines[1]);
  expect(await screen.findByText('Fiche ouverte')).toBeInTheDocument();
});

test('a failed read draws the card without its list, never an error', async () => {
  api.getMollieReserveAttention.mockRejectedValue(new Error('boom'));
  renderAlert();
  expect(await screen.findByText('Retenue Mollie non reçue')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Lucia/ })).not.toBeInTheDocument();
});
