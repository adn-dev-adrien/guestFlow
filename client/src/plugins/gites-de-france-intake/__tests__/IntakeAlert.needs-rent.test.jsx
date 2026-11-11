// specs/gites-de-france-mail-intake.md rule 14 (amended 2026-10-18) — the dashboard line of a fiche whose
// rent is still to choose says so and opens the fiche.
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi, test, expect } from 'vitest';

const api = vi.hoisted(() => ({ getGdfIntakeAlerts: vi.fn() }));
vi.mock('../../sdk', async () => ({
  api,
  displayDate: (iso) => iso.split('-').reverse().join('/'),
  AttentionCard: (await vi.importActual('../../../components/AttentionCard')).default,
}));

import IntakeAlert from '../IntakeAlert';

// The home's subject this card draws (specs/shell-and-home-day-first.md rule 6 — server-made).
const ATTENTION = { key: 'gdf-intake', severity: 'todo', count: 1, title: 'Mails Gîtes de France à vérifier', detail: '1 mail' };

test('rule 14: a rent to choose is listed with a link to the fiche', async () => {
  api.getGdfIntakeAlerts.mockResolvedValue({ items: [
    { id: 1, dossierNumber: '11773', receivedAt: '2026-10-14T16:32:00.000Z', status: 'needs_rent', reservationId: 22304, error: null },
    { id: 2, dossierNumber: null, receivedAt: '2026-10-13T08:00:00.000Z', status: 'pending', reservationId: null, error: null },
  ] });
  render(<MemoryRouter><IntakeAlert attention={ATTENTION} /></MemoryRouter>);
  expect(await screen.findByText(/Dossier 11773 du 14\/10\/2026 — loyer à choisir sur la fiche/)).toBeInTheDocument();
  expect(screen.getByText(/Mail du 13\/10\/2026 — aucune fiche sur ces dates/)).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: 'Ouvrir la fiche' })).toHaveLength(1);
});
