// specs/control-plane-plans-and-access.md rules 18 and 33 — the home page's « Emails à valider »: the
// frozen text on « Voir », « Envoyer » and « Ignorer » through the server, and the Qonto alert that
// opens the Paiements page.
import React from 'react';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import FleetPage from '../pages/FleetPage';
import api from '../api';
import { renderAt, setWidth } from './consoleFixtures';

vi.mock('../api', () => ({ default: { fleet: vi.fn(), alerts: vi.fn(), sendEmail: vi.fn(), ignoreEmail: vi.fn() } }));

const mail = (id, companyName, name) => ({
  id, customerId: id, companyName, name, preparedOn: '25/10/2026', recipient: `contact@${companyName.toLowerCase()}.fr`,
  subject: `Votre facture GuestFlow F-2026-00${id}`, body: `Bonjour,\n\nPayer en ligne : https://pay.test/${id}`,
});

beforeEach(() => {
  vi.clearAllMocks();
  setWidth(1280);
  api.fleet.mockResolvedValue({ rows: [], counters: [] });
  api.alerts.mockResolvedValue({
    alerts: [{ customerId: null, link: '/parametres/paiements', severity: 'warning', text: 'Qonto n’est pas connecté : aucune facture de renouvellement ne part. Réglages → Paiements.' }],
    queue: [mail(1, 'Aulnes', 'Facture'), mail(2, 'Moulin', 'Relance J+7')],
  });
});

it('rule 33 — « Voir » shows the text that will leave; « Envoyer » and « Ignorer » go to the server', async () => {
  api.sendEmail.mockResolvedValue({ queue: [mail(2, 'Moulin', 'Relance J+7')] });
  api.ignoreEmail.mockResolvedValue({ queue: [] });
  renderAt(<FleetPage />);
  expect(await screen.findByText('Emails à valider (2)')).toBeInTheDocument();
  fireEvent.click(screen.getAllByRole('button', { name: 'Voir' })[0]);
  expect(await screen.findByText('Votre facture GuestFlow F-2026-001')).toBeInTheDocument();
  expect(screen.getByText('À : contact@aulnes.fr')).toBeInTheDocument();

  fireEvent.click(screen.getAllByRole('button', { name: 'Envoyer' })[0]);
  await waitFor(() => expect(api.sendEmail).toHaveBeenCalledWith(1));
  expect(await screen.findByText('Emails à valider (1)')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Ignorer' }));
  await waitFor(() => expect(api.ignoreEmail).toHaveBeenCalledWith(2));
  await waitFor(() => expect(screen.queryByText(/Emails à valider/)).not.toBeInTheDocument());
});

it('rules 18, 32 — the Qonto alert opens the Paiements page', async () => {
  renderAt(<FleetPage />);
  fireEvent.click(await screen.findByText(/Qonto n’est pas connecté/));
  expect(await screen.findByTestId('elsewhere')).toBeInTheDocument();
});
