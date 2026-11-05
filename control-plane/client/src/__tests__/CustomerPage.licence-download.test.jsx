// specs/hosting-h1-fleet-runtime.md rule 53 (audit R24 F3) — « Télécharger la licence » follows `actions.downloadLicence`:
// a customer held off its address (rule 48) is offered no download.
import React from 'react';
import { screen } from '@testing-library/react';
import CustomerPage from '../pages/CustomerPage';
import api from '../api';
import { renderAt, setWidth, customerFixture } from './consoleFixtures';

vi.mock('../api', () => ({ default: { customerModules: () => new Promise(() => {}), customer: vi.fn(), licenceUrl: (id) => `/api/customers/${id}/licence` } }));

const open = (actions) => {
  api.customer.mockResolvedValue({ ...customerFixture, actions: { ...customerFixture.actions, ...actions } });
  renderAt(<CustomerPage />, { path: '/clients/:id', route: '/clients/3' });
};

beforeEach(() => {
  setWidth(1280);
  vi.clearAllMocks();
});

it('rule 53 — offered when the server allows it', async () => {
  open({ downloadLicence: true });
  expect(await screen.findByRole('button', { name: 'Télécharger la licence' })).toBeEnabled();
});

it('rule 53 — a held customer has no download button', async () => {
  open({ downloadLicence: false });
  await screen.findByRole('button', { name: 'Changer l’adresse' });
  expect(screen.queryByRole('button', { name: 'Télécharger la licence' })).not.toBeInTheDocument();
});
