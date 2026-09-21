/**
 * EmailSequenceSimulation — renders the server's simulation verbatim (specs/guest-email-sequence.md
 * rule 31, §6.2): statuses as badges, reasons as given, the activation banner, the server's counts.
 */

import React from 'react';
import { vi } from 'vitest';
import { render as rtlRender, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

vi.mock('../../api', () => ({
  __esModule: true,
  default: { getEmailSequenceSimulation: vi.fn() },
}));

import api from '../../api';
import EmailSequenceSimulation from '../EmailSequenceSimulation';

// The page action bar navigates; give it a router.
const render = (ui) => rtlRender(<MemoryRouter>{ui}</MemoryRouter>);

const RESULT = {
  rows: [
    { date: '2026-09-25', mailKey: 'arrival_reminder_7d', mailLabel: 'J-7 · préparation', reservationId: 1, clientId: 1, clientName: 'Camille Martin', propertyName: 'La Granja', status: 'send', reason: '' },
    { date: '2026-09-30', mailKey: 'arrival_reminder_1d', mailLabel: 'J-2 · arrivée', reservationId: 2, clientId: 2, clientName: 'Léo Roy', propertyName: 'L\'Estiva', status: 'blocked', reason: 'Séjour annulé' },
    { date: '2026-10-01', mailKey: 'reservation_confirmation', mailLabel: 'Confirmation', reservationId: 3, clientId: 3, clientName: 'Ana Diaz', propertyName: 'La Granja', status: 'already-sent', reason: 'Déjà envoyé le 2026-09-18' },
  ],
  counts: { send: 1, blocked: 1, alreadySent: 1, toCheck: 0 },
  startDate: null,
  assumedStartDate: '2026-09-18',
  autoMailKeys: [],
};

beforeEach(() => {
  api.getEmailSequenceSimulation.mockReset();
});

test('lists each email with its status and the server\'s reason', async () => {
  api.getEmailSequenceSimulation.mockResolvedValue(RESULT);
  render(<EmailSequenceSimulation tabs={null} />);
  expect((await screen.findAllByText('Camille Martin')).length).toBeGreaterThan(0);
  expect(screen.getAllByText('Part').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Ne part pas').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Déjà envoyé').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Séjour annulé').length).toBeGreaterThan(0);
  expect(screen.getByText(/1 mail partirait sur la période, sur 3 examinés/)).toBeInTheDocument();
});

// specs/settings-rationalization.md rule 17b — each sequence mail follows its own template's mode.
test('says nothing leaves by itself while every sequence template is « Manuel »', async () => {
  api.getEmailSequenceSimulation.mockResolvedValue(RESULT);
  render(<EmailSequenceSimulation tabs={null} />);
  expect(await screen.findByText(/Aucun mail de la séquence en mode « Automatique »/)).toBeInTheDocument();
});

test('shows the start date and how many mails leave by themselves', async () => {
  api.getEmailSequenceSimulation.mockResolvedValue({ ...RESULT, autoMailKeys: ['arrival_reminder_7d', 'arrival_reminder_1d'], startDate: '2026-09-28', assumedStartDate: null });
  render(<EmailSequenceSimulation tabs={null} />);
  expect(await screen.findByText(/Séquence active depuis le 28\/09\/2026 : 2 mails en mode « Automatique »/)).toBeInTheDocument();
});

test('an empty period shows the empty state', async () => {
  api.getEmailSequenceSimulation.mockResolvedValue({ ...RESULT, rows: [], counts: { send: 0, blocked: 0, alreadySent: 0, toCheck: 0 } });
  render(<EmailSequenceSimulation tabs={null} />);
  expect(await screen.findByText('Aucun mail prévu sur cette période')).toBeInTheDocument();
});

test('an invalid range is explained, not silently ignored', async () => {
  api.getEmailSequenceSimulation.mockRejectedValue(Object.assign(new Error('INVALID_RANGE'), { error: 'INVALID_RANGE' }));
  render(<EmailSequenceSimulation tabs={null} />);
  await waitFor(() => expect(screen.getByText(/Période invalide/)).toBeInTheDocument());
});
