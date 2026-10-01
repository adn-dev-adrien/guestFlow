// specs/control-plane-plans-and-access.md rule 22 — « Changer l'adresse »: the new slug checked by the
// server as it is typed, the items to tick, and the button enabled only when both are done.
import React from 'react';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import CustomerPage from '../pages/CustomerPage';
import api from '../api';
import { renderAt, setWidth, customerFixture } from './consoleFixtures';

vi.mock('../api', () => ({ default: { customer: vi.fn(), renamePreview: vi.fn(), rename: vi.fn(), licenceUrl: (id) => `/api/customers/${id}/licence` } }));

const CHECKLIST = [{ key: 'wordpress', label: 'Réglage du plugin WordPress' }, { key: 'ical', label: 'Flux iCal' }];

beforeEach(() => {
  setWidth(1280);
  vi.clearAllMocks();
  api.customer.mockResolvedValue({ ...customerFixture, actions: { ...customerFixture.actions, rename: true } });
  api.renamePreview.mockImplementation(async (id, slug) => ({
    error: slug === 'admin' ? 'Adresse réservée.' : null,
    url: slug && slug !== 'admin' ? `https://${slug}.guestflow.fr` : null,
    until: 'L’ancienne adresse moulin.guestflow.fr reste réservée et redirige (301) jusqu’au 30/09/2027.',
    checklist: CHECKLIST,
  }));
});

it('rule 22 — the slug is refused as typed; the button waits for a valid slug and every item', async () => {
  api.rename.mockResolvedValue({ ...customerFixture, slug: 'moulin-neuf' });
  renderAt(<CustomerPage />, { path: '/clients/:id', route: '/clients/3' });
  fireEvent.click(await screen.findByRole('button', { name: 'Changer l’adresse' }));
  const field = await screen.findByLabelText('Nouvelle adresse');
  fireEvent.change(field, { target: { value: 'admin' } });
  expect(await screen.findByText('Adresse réservée.')).toBeInTheDocument();
  const submit = () => screen.getAllByRole('button', { name: 'Changer l’adresse' }).pop();
  expect(submit()).toBeDisabled();

  fireEvent.change(field, { target: { value: 'moulin-neuf' } });
  expect(await screen.findByText('https://moulin-neuf.guestflow.fr')).toBeInTheDocument();
  expect(screen.getByText(/redirige \(301\) jusqu’au 30\/09\/2027/)).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText('Réglage du plugin WordPress'));
  expect(submit()).toBeDisabled();
  fireEvent.click(screen.getByLabelText('Flux iCal'));
  expect(submit()).toBeEnabled();
  fireEvent.click(submit());
  await waitFor(() => expect(api.rename).toHaveBeenCalledWith(3, 'moulin-neuf', ['wordpress', 'ical']));
});
