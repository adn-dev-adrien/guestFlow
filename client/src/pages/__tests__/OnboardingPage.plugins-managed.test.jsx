// specs/plugin-operator-provisioning.md rule 8 — on an operator-managed space the start assistant has no
// « Plugins » step: the other steps are numbered without a gap, and the last step drops the
// « Plugins : … » link. An unmanaged space keeps the five steps.
import React from 'react';
import { vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

vi.mock('../../api', () => ({
  __esModule: true,
  default: {
    getOnboarding: vi.fn(), saveOnboardingCompany: vi.fn(), saveOnboardingProperty: vi.fn(), saveOnboardingPlugins: vi.fn(),
    saveOnboardingEmails: vi.fn(), completeOnboarding: vi.fn(), previewEmailDraft: vi.fn(), getEmailReadiness: vi.fn(),
  },
}));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ refresh: vi.fn().mockResolvedValue() }) }));

import api from '../../api';
import OnboardingPage from '../OnboardingPage';

const base = {
  open: true, company: { name: 'Les Cabanes', email: 'c@x.fr' }, property: { id: 1, existing: 1, draft: null },
  emails: { phone: '', senderName: '', properties: [], previewStableKey: 'arrival_reminder_1d' },
};

function open(data) {
  api.getOnboarding.mockResolvedValue({ ...base, ...data });
  api.saveOnboardingCompany.mockResolvedValue({});
  api.saveOnboardingEmails.mockResolvedValue({});
  api.saveOnboardingPlugins.mockResolvedValue({ results: [], pluginsSummary: '2 plugins actifs' });
  api.getEmailReadiness.mockResolvedValue({ items: [] });
  return render(<MemoryRouter initialEntries={['/demarrage']}><OnboardingPage /></MemoryRouter>);
}

async function next() {
  fireEvent.click(screen.getByRole('button', { name: 'Suivant' }));
  await new Promise((r) => setTimeout(r, 30));
}

beforeEach(() => vi.clearAllMocks());

test('rule 8: four steps — Entreprise, Premier logement, Emails, C’est prêt — numbered without a gap', async () => {
  open({ pluginStep: false });
  expect(await screen.findByText('Étape 1 sur 4')).toBeInTheDocument();
  await next();
  expect(await screen.findByText('Étape 2 sur 4')).toBeInTheDocument();
  await next();
  expect(await screen.findByText('Étape 3 sur 4')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Emails' })).toBeInTheDocument();
  await next();
  expect(await screen.findByText('Étape 4 sur 4')).toBeInTheDocument();
  expect(api.saveOnboardingPlugins).not.toHaveBeenCalled();
});

test('rule 8: the last step has no « Plugins : … » link', async () => {
  open({ pluginStep: false, pluginsSummary: '2 plugins actifs' });
  await screen.findByText('Étape 1 sur 4');
  await next(); await next(); await next();
  await screen.findByText('Étape 4 sur 4');
  expect(screen.queryByText(/Plugins :/)).toBeNull();
  expect(screen.getByText('Tarifs : saisons et prix des logements')).toBeInTheDocument();
});

test('rule 8: an unmanaged space keeps five steps and the « Plugins : … » link', async () => {
  open({ pluginStep: true, plugins: [], questions: [], pluginsSummary: '2 plugins actifs' });
  expect(await screen.findByText('Étape 1 sur 5')).toBeInTheDocument();
  await next(); await next(); await next(); await next();
  await screen.findByText('Étape 5 sur 5');
  expect(screen.getByText('Plugins : 2 plugins actifs')).toBeInTheDocument();
});
