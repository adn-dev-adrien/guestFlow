// specs/guest-email-texts-made-simple.md rules 28–30, 32 — the assistant reopens on the property it
// created (rule 29) and never offers one to an instance that has some; « Vos emails » asks the deposit,
// the cleaning and the towels with no answer chosen, sends only what was answered (rule 28), shows no
// article as chosen until one is (rule 30), and has its own key-box code field (rule 32).
// specs/hosting-h2-account-security.md rule 27 — step 1 says once that the login is now the company email.
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
  phone: '', senderName: 'Les Cabanes', previewStableKey: 'arrival_reminder_1d',
  properties: [{
    id: 1, name: 'Gite', nameArticle: null, articles: [{ value: 'au', label: 'au Gite' }, { value: 'à la', label: 'à la Gite' }],
    address: '', access: '', hasAccessCode: false, hasWifi: false, wifiName: '', hasWifiPassword: false,
    caution: null, cleaningIncluded: null, towelsProvided: null, bedLinenProvided: null, pending: ['caution', 'cleaning', 'towels', 'linen'],
  }],
};
const DRAFT = { name: 'Gite', doubleBeds: '1', singleBeds: '0', maxGuests: '2', checkIn: '17:00', checkOut: '10:00', pricePerNight: '80' };

function onboarding(property) {
  api.getOnboarding.mockResolvedValue({ open: true, company: { name: 'Les Cabanes', email: 'contact@cabanes.fr' }, property, emails: EMAILS, plugins: [] });
}

beforeEach(() => {
  vi.clearAllMocks();
  onboarding({ id: null, existing: 0, draft: null });
  api.saveOnboardingCompany.mockResolvedValue({ loginChanged: false });
  api.saveOnboardingProperty.mockResolvedValue({ id: 1 });
  api.saveOnboardingPlugins.mockResolvedValue({ results: [] });
  api.saveOnboardingEmails.mockResolvedValue({});
  api.previewEmailDraft.mockResolvedValue({ subject: 'À vendredi', body: 'Bonjour Camille,', sample: true });
  api.getEmailReadiness.mockResolvedValue({ items: [], soonCount: 0 });
});

const next = () => fireEvent.click(screen.getByRole('button', { name: 'Suivant' }));
const start = async () => {
  render(<MemoryRouter initialEntries={['/demarrage']}><OnboardingPage /></MemoryRouter>);
  await screen.findByText('Étape 1 sur 5');
};

test('specs/hosting-h2-account-security.md rule 27: the new login is said once, at step 2', async () => {
  api.saveOnboardingCompany.mockResolvedValue({ loginEmail: 'contact@cabanes.fr', loginChanged: true });
  await start();
  next();
  expect(await screen.findByText('Connexion désormais avec contact@cabanes.fr.')).toBeInTheDocument();
  expect(refresh).toHaveBeenCalled();
});

test('rule 29: the property it created comes back in step 2', async () => {
  onboarding({ id: 1, existing: 1, draft: DRAFT });
  await start();
  next();
  await screen.findByText('Étape 2 sur 5');
  expect(screen.getByLabelText(/Nom du logement/)).toHaveValue('Gite');
  expect(screen.getByLabelText('Arrivée à partir de')).toHaveValue('17:00');
});

test('rule 29: an instance that already has properties is not asked for one', async () => {
  onboarding({ id: null, existing: 2, draft: null });
  await start();
  next();
  expect(await screen.findByText('Logements : 2')).toBeInTheDocument();
  expect(screen.queryByLabelText(/Nom du logement/)).toBeNull();
  next();
  await screen.findByText('Étape 3 sur 5');
  expect(api.saveOnboardingProperty).not.toHaveBeenCalled();
});

test('rules 28, 30, 32: nothing chosen by default; only what is answered is sent', async () => {
  await start();
  next(); await screen.findByText('Étape 2 sur 5');
  fireEvent.change(screen.getByLabelText(/Nom du logement/), { target: { value: 'Gite' } });
  fireEvent.change(screen.getByLabelText(/Prix par nuit/), { target: { value: '80' } });
  next(); await screen.findByText('Étape 3 sur 5');
  next(); await screen.findByText('Étape 4 sur 5');
  const gite = within(await screen.findByRole('region', { name: 'Gite' }));
  for (const radio of gite.getAllByRole('radio')) expect(radio).toHaveAttribute('aria-checked', 'false');
  expect(gite.getByText('Vide : aucune caution annoncée.')).toBeInTheDocument();
  fireEvent.click(gite.getByRole('radio', { name: 'Non compris' }));
  fireEvent.change(gite.getByLabelText('Code de la boîte à clés'), { target: { value: '4821' } });
  next();
  await waitFor(() => expect(api.saveOnboardingEmails).toHaveBeenCalled());
  const [sent] = api.saveOnboardingEmails.mock.calls[0][0].properties;
  expect(sent).toEqual(expect.objectContaining({ id: 1, cleaningIncluded: false, accessCode: '4821' }));
  expect(sent).not.toHaveProperty('nameArticle');
  expect(sent).not.toHaveProperty('caution');
  expect(sent).not.toHaveProperty('towelsProvided');
  expect(sent).not.toHaveProperty('bedLinenProvided');
});

test('rule 28 (2026-10-18): the bed linen is asked like the towels, and sent once answered', async () => {
  await start();
  next(); await screen.findByText('Étape 2 sur 5');
  fireEvent.change(screen.getByLabelText(/Nom du logement/), { target: { value: 'Gite' } });
  fireEvent.change(screen.getByLabelText(/Prix par nuit/), { target: { value: '80' } });
  next(); await screen.findByText('Étape 3 sur 5');
  next(); await screen.findByText('Étape 4 sur 5');
  const gite = within(await screen.findByRole('region', { name: 'Gite' }));
  fireEvent.click(within(gite.getByRole('radiogroup', { name: 'Linge de lit' })).getByRole('radio', { name: 'À apporter' }));
  next();
  await waitFor(() => expect(api.saveOnboardingEmails).toHaveBeenCalled());
  const [sent] = api.saveOnboardingEmails.mock.calls[0][0].properties;
  expect(sent).toEqual(expect.objectContaining({ id: 1, bedLinenProvided: false }));
  expect(sent).not.toHaveProperty('towelsProvided');
});
