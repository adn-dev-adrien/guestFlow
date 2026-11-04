// specs/hosting-h1-fleet-runtime.md rule 45 — a rename that is not finished: « Changer l'adresse » stays in its place,
// disabled, and says why; archived customers still have no such button.
import React from 'react';
import { fireEvent, screen } from '@testing-library/react';
import CustomerPage from '../pages/CustomerPage';
import api from '../api';
import { renderAt, setWidth, customerFixture } from './consoleFixtures';

vi.mock('../api', () => ({ default: { customerModules: () => new Promise(() => {}), customer: vi.fn(), licenceUrl: (id) => `/api/customers/${id}/licence` } }));

const HINT = 'Changement d’adresse à terminer d’abord.';
const open = (fields, actions) => {
  api.customer.mockResolvedValue({ ...customerFixture, ...fields, actions: { ...customerFixture.actions, ...actions } });
  renderAt(<CustomerPage />, { path: '/clients/:id', route: '/clients/3' });
};

beforeEach(() => {
  setWidth(1280);
  vi.clearAllMocks();
});

it('rule 45 — pending: the button is disabled and carries the server’s reason', async () => {
  open({}, { rename: false, renameHint: HINT });
  const button = await screen.findByRole('button', { name: 'Changer l’adresse' });
  expect(button).toBeDisabled();
  fireEvent.mouseOver(button.parentElement);
  expect(await screen.findByRole('tooltip')).toHaveTextContent(HINT);
});

it('rule 45 — finished: the button is enabled', async () => {
  open({}, { rename: true, renameHint: null });
  expect(await screen.findByRole('button', { name: 'Changer l’adresse' })).toBeEnabled();
});

it('rule 45 — an archived customer has no such button', async () => {
  open({ archivedAt: new Date().toISOString() }, { rename: false, renameHint: null });
  await screen.findByRole('button', { name: 'Télécharger la licence' });
  expect(screen.queryByRole('button', { name: 'Changer l’adresse' })).not.toBeInTheDocument();
});
