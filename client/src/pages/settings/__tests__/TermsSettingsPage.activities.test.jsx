/**
 * TermsSettingsPage — one tab per activity (specs/gift-voucher-campaigns.md rule 37). The tabs come from GET /api/terms/activities; each tab
 * is its own draft and its own versions; the lodging-only cards (public site address, plugin slot) stay on the lodging tab; a draft not saved
 * keeps the operator on its tab.
 */
import React from 'react';
import { vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

vi.mock('../../../api', () => ({
  __esModule: true,
  default: {
    getTermsActivities: vi.fn(),
    getTerms: vi.fn(),
    saveTermsDraft: vi.fn(),
    previewTerms: vi.fn(),
    publishTerms: vi.fn(),
    getTermsVersion: vi.fn(),
    saveTermsPublicSiteOrigin: vi.fn(),
  },
}));
vi.mock('../../../hooks/useAuth', () => ({ __esModule: true, useAuth: () => ({ user: { roles: ['admin'], enabledPlugins: [] } }) }));
const toast = { showSuccess: vi.fn(), showError: vi.fn() };
vi.mock('../../../components/DialogProvider', () => ({ __esModule: true, useToast: () => toast }));

import api from '../../../api';
import TermsSettingsPage from '../TermsSettingsPage';

const overview = (activity, over = {}) => ({
  activity,
  draft: { fr: `Texte ${activity}`, en: `Text ${activity}`, updatedAt: null },
  current: null,
  nextVersion: 1,
  canPublish: true,
  publishBlockedReason: null,
  staleVariables: [],
  unknownVariables: [],
  variables: ['raisonSociale'],
  versions: [],
  publicSiteOrigin: 'https://www.exemple.fr',
  ...over,
});

const ACTIVITIES = [
  { key: 'lodging', label: 'Hébergement', currentVersion: 2 },
  { key: 'resource', label: 'Bain nordique et activités', currentVersion: null },
];

beforeEach(() => {
  Object.values(api).forEach((m) => m.mockReset());
  Object.values(toast).forEach((m) => m.mockReset());
  api.getTermsActivities.mockResolvedValue({ activities: ACTIVITIES });
  api.getTerms.mockImplementation(async (activity) => overview(activity));
  api.previewTerms.mockResolvedValue({ html: { fr: '<p>fr</p>', en: '<p>en</p>' }, unknownVariables: [] });
  api.saveTermsDraft.mockImplementation(async (d) => overview(d.activity, { draft: { fr: d.fr, en: d.en, updatedAt: 'x' } }));
  api.publishTerms.mockImplementation(async (activity) => overview(activity, { current: { version: 1, publishedAtLabel: 'x' }, nextVersion: 2, canPublish: false }));
});

const renderPage = () => render(<MemoryRouter><TermsSettingsPage /></MemoryRouter>);

test('one tab per declared activity, the lodging first and selected', async () => {
  renderPage();
  const tabs = await screen.findAllByRole('tab', { name: /Hébergement|Bain nordique et activités/ });
  expect(tabs.map((t) => t.textContent)).toEqual(['Hébergement', 'Bain nordique et activités']);
  expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
  await waitFor(() => expect(api.getTerms).toHaveBeenCalledWith('lodging'));
});

test('no tab strip while the lodging is the only activity', async () => {
  api.getTermsActivities.mockResolvedValue({ activities: [ACTIVITIES[0]] });
  renderPage();
  await screen.findByText('Brouillon');
  expect(screen.queryByRole('tab', { name: 'Hébergement' })).toBeNull();
});

test('choosing a tab loads that activity\'s own draft; the lodging-only cards leave', async () => {
  renderPage();
  await screen.findByText('Brouillon');
  expect(screen.getByDisplayValue('https://www.exemple.fr')).toBeInTheDocument();
  fireEvent.click(await screen.findByRole('tab', { name: 'Bain nordique et activités' }));
  await waitFor(() => expect(api.getTerms).toHaveBeenCalledWith('resource'));
  expect(await screen.findByDisplayValue('Texte resource')).toBeInTheDocument();
  expect(screen.queryByDisplayValue('https://www.exemple.fr')).toBeNull();
});

test('saving and publishing name the activity of the tab', async () => {
  renderPage();
  fireEvent.click(await screen.findByRole('tab', { name: 'Bain nordique et activités' }));
  const field = await screen.findByDisplayValue('Texte resource');
  fireEvent.change(field, { target: { value: 'Texte modifié' } });
  fireEvent.click(await screen.findByRole('button', { name: 'Enregistrer le brouillon' }));
  await waitFor(() => expect(api.saveTermsDraft).toHaveBeenCalledWith(expect.objectContaining({ activity: 'resource', fr: 'Texte modifié' })));
  fireEvent.click(await screen.findByRole('button', { name: 'Publier la version 1' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Publier' }));
  await waitFor(() => expect(api.publishTerms).toHaveBeenCalledWith('resource'));
});

test('an unsaved draft keeps the operator on its tab and says why', async () => {
  renderPage();
  const field = await screen.findByDisplayValue('Texte lodging');
  fireEvent.change(field, { target: { value: 'Brouillon en cours' } });
  fireEvent.click(await screen.findByRole('tab', { name: 'Bain nordique et activités' }));
  expect(toast.showError).toHaveBeenCalledWith(expect.stringMatching(/Enregistrez ou annulez le brouillon/));
  expect(api.getTerms).not.toHaveBeenCalledWith('resource');
  expect(screen.getByRole('tab', { name: 'Hébergement' })).toHaveAttribute('aria-selected', 'true');
});
