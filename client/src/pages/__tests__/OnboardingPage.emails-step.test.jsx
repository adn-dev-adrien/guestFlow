// specs/guest-email-texts-made-simple.md rule 21 — the assistant's step « Vos emails », before
// « C'est prêt »: pre-filled by the server, the article as a choice, the J-2 of a sample stay rendered
// with what is typed, every field skippable; « C'est prêt » lists what the emails still miss.
import React from 'react';
import { vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

vi.mock('../../api', () => ({
  __esModule: true,
  default: {
    getOnboarding: vi.fn(), saveOnboardingCompany: vi.fn(), saveOnboardingProperty: vi.fn(), saveOnboardingPlugins: vi.fn(),
    saveOnboardingEmails: vi.fn(), completeOnboarding: vi.fn(), previewEmailDraft: vi.fn(), getEmailReadiness: vi.fn(),
  },
}));
const refresh = vi.fn().mockResolvedValue();
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ refresh }) }));

import api from '../../api';
import OnboardingPage from '../OnboardingPage';

const EMAILS = {
  phone: '06 12 34 56 78', senderName: 'Les Prés', previewStableKey: 'arrival_reminder_1d',
  properties: [
    { id: 1, name: 'Gîte des Prés', nameArticle: 'au', articles: [{ value: 'au', label: 'au Gîte des Prés' }, { value: 'à la', label: 'à la Gîte des Prés' }],
      address: '', access: '', hasWifi: true, wifiName: '', hasWifiPassword: false },
    { id: 2, name: 'La Cabane', nameArticle: 'à la', articles: [{ value: 'à la', label: 'à la Cabane' }],
      address: '1 place du Village', access: '', hasWifi: false, wifiName: '', hasWifiPassword: false },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  api.getOnboarding.mockResolvedValue({ open: true, company: { name: 'Les Prés', email: 'a@b.fr' }, emails: EMAILS, plugins: [] });
  api.saveOnboardingCompany.mockResolvedValue({});
  api.saveOnboardingProperty.mockResolvedValue({ id: 1 });
  api.saveOnboardingPlugins.mockResolvedValue({ results: [] });
  api.saveOnboardingEmails.mockResolvedValue({});
  api.previewEmailDraft.mockResolvedValue({ subject: 'À vendredi, au Gîte des Prés', body: 'Bonjour Camille,', sample: true });
  api.getEmailReadiness.mockResolvedValue({ items: [{ id: 'company.phone', label: 'Téléphone de l’entreprise', target: { path: '/settings/etablissement' } }], soonCount: 0 });
  api.completeOnboarding.mockResolvedValue({ open: false });
});

const next = () => fireEvent.click(screen.getByRole('button', { name: 'Suivant' }));

async function reachEmails() {
  render(<MemoryRouter initialEntries={['/demarrage']}><OnboardingPage /></MemoryRouter>);
  await screen.findByText('Étape 1 sur 5');
  next(); await screen.findByText('Étape 2 sur 5');
  next(); await screen.findByText('Étape 3 sur 5');
  next(); await screen.findByText('Étape 4 sur 5');
}

test('rule 21: « Emails » is pre-filled and previews the J-2 of a sample stay with what is typed', async () => {
  await reachEmails();
  expect(screen.getByRole('heading', { name: 'Emails' })).toBeInTheDocument();
  expect(screen.getByLabelText('Téléphone')).toHaveValue('06 12 34 56 78');
  expect(screen.getByLabelText('Nom d’expéditeur')).toHaveValue('Les Prés');
  expect(await screen.findByText('À vendredi, au Gîte des Prés')).toBeInTheDocument();
  // Every property has its block; the company address is offered; no Wi-Fi asked where there is none.
  const cabane = within(screen.getByRole('region', { name: 'La Cabane' }));
  expect(cabane.getByLabelText('Adresse')).toHaveValue('1 place du Village');
  expect(cabane.queryByLabelText('Wi-Fi')).toBeNull();
  const gite = within(screen.getByRole('region', { name: 'Gîte des Prés' }));
  fireEvent.click(gite.getByRole('radio', { name: 'à la Gîte des Prés' }));
  fireEvent.change(gite.getByLabelText('Adresse'), { target: { value: '12 chemin des Prés' } });
  await waitFor(() => expect(api.previewEmailDraft).toHaveBeenLastCalledWith({
    stableKey: 'arrival_reminder_1d', reservationId: 'sample', propertyId: 1,
    draft: {
      settings: { companyPhone: '06 12 34 56 78', smtpFromName: 'Les Prés' },
      arrival: { 1: { address: '12 chemin des Prés', accessFr: '', wifiName: '' }, 2: { address: '1 place du Village', accessFr: '', wifiName: '' } },
      properties: { 1: { nameArticle: 'à la' }, 2: { nameArticle: 'à la' } },
    },
  }));
  next();
  await screen.findByText('Étape 5 sur 5');
  expect(api.saveOnboardingEmails).toHaveBeenCalledWith(expect.objectContaining({
    properties: [
      expect.objectContaining({ id: 1, nameArticle: 'à la', address: '12 chemin des Prés' }),
      expect.objectContaining({ id: 2, address: '1 place du Village' }),
    ],
  }));
  expect(await screen.findByText('Emails à compléter (1)')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Téléphone de l’entreprise' })).toBeInTheDocument();
});

test('rule 21: every field can be skipped', async () => {
  await reachEmails();
  fireEvent.change(screen.getByLabelText('Téléphone'), { target: { value: '' } });
  next();
  expect(await screen.findByText('Étape 5 sur 5')).toBeInTheDocument();
  expect(api.saveOnboardingEmails).toHaveBeenCalledWith(expect.objectContaining({ phone: '' }));
});
