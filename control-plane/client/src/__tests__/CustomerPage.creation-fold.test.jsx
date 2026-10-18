// specs/control-plane-plans-and-access.md rule 37 — the « Création » card folds to one line once every
// step is done, and opens on demand; a creation still in progress or failed stays open.
import React from 'react';
import { screen, fireEvent } from '@testing-library/react';
import CustomerPage from '../pages/CustomerPage';
import api from '../api';
import { renderAt, setWidth, customerFixture } from './consoleFixtures';

vi.mock('../api', () => ({ default: { customer: vi.fn(), licenceUrl: (id) => `/api/customers/${id}/licence` } }));

const page = () => renderAt(<CustomerPage />, { path: '/clients/:id', route: '/clients/3' });
const done = {
  ...customerFixture,
  steps: [
    { step: 'dir', label: 'Dossier, données et fichier d’environnement', kind: 'auto', status: 'ok', detail: 'Créés.', action: null },
    { step: 'health', label: 'Contrôle de santé', kind: 'auto', status: 'ok', detail: '3.10.0 répond.', action: null },
  ],
  stepsDone: true,
  stepsSummary: 'Terminée : 2 étapes',
};

beforeEach(() => { setWidth(390); vi.clearAllMocks(); });

it('rule 37 — a finished creation reads one line, the steps open on demand', async () => {
  api.customer.mockResolvedValue(done);
  page();
  expect(await screen.findByText('Terminée : 2 étapes')).toBeInTheDocument();
  expect(screen.queryByText('Contrôle de santé')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Voir les étapes' }));
  expect(screen.getByText('Contrôle de santé')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Masquer les étapes' })).toHaveAttribute('aria-expanded', 'true');
});

it('rule 37 — an unfinished creation shows its steps and no fold button', async () => {
  api.customer.mockResolvedValue({ ...customerFixture, stepsDone: false, stepsSummary: '' });
  page();
  expect(await screen.findByRole('button', { name: 'Reprendre' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Voir les étapes' })).not.toBeInTheDocument();
});
