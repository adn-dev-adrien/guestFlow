// specs/gate-access-portier.md §3.2, §6 — the email history shows an email waiting for Portier, with its
// next attempt, and one dropped because its reservation was cancelled meanwhile.
import { vi, test, expect } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import DialogProvider from '../../components/DialogProvider';

vi.mock('../../api', () => ({
  __esModule: true,
  default: {
    getEmailHistory: vi.fn(),
    getEmailTemplates: vi.fn(),
  },
}));

import api from '../../api';
import EmailHistoryPage from '../EmailHistoryPage';

const row = (over) => ({
  id: 1, templateId: 1, reservationId: 10, sentAt: '2026-09-14 06:00:00', channel: 'smtp', errorMessage: '',
  renderedSubject: 'Votre séjour approche', renderedBody: '', recipientEmail: 'camille@example.com',
  templateName: 'Rappel J-7', clientFullName: 'Camille Roux', propertyName: 'Gîte', ...over,
});

test('« En attente de Portier · prochain essai à 08:15 », and « Ignoré — réservation annulée »', async () => {
  api.getEmailTemplates.mockResolvedValue([]);
  api.getEmailHistory.mockResolvedValue({
    total: 2,
    rows: [
      row({ id: 1, status: 'waiting_portier', statusDetail: 'prochain essai à 08:15' }),
      row({ id: 2, status: 'skipped', errorMessage: 'RESERVATION_CANCELLED', statusDetail: 'réservation annulée' }),
    ],
  });
  render(<MemoryRouter><DialogProvider><EmailHistoryPage /></DialogProvider></MemoryRouter>);
  expect(await screen.findByText('En attente de Portier · prochain essai à 08:15')).toBeInTheDocument();
  expect(screen.getByText('Ignoré — réservation annulée')).toBeInTheDocument();
});
