// specs/gites-de-france-mail-intake.md rule 18 (audit 2026-10-27) — a mail waiting for its gîte to be
// mapped is `pending` with the server's reason; the dashboard line says that reason, not « aucune
// fiche sur ces dates ».
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

const ATTENTION = { key: 'gdf-intake', severity: 'todo', count: 1, title: 'Mails Gîtes de France à vérifier', detail: '1 mail' };

test('rule 18: a pending mail for an unmapped gîte shows why it waits', async () => {
  api.getGdfIntakeAlerts.mockResolvedValue({ items: [
    { id: 3, dossierNumber: '11773', receivedAt: '2026-10-14T16:32:00.000Z', status: 'pending', reservationId: null, error: 'Aucun logement n’est relié au gîte n°309700' },
  ] });
  render(<MemoryRouter><IntakeAlert attention={ATTENTION} /></MemoryRouter>);
  expect(await screen.findByText(/Dossier 11773 du 14\/10\/2026 — Aucun logement n’est relié au gîte n°309700/)).toBeInTheDocument();
});
