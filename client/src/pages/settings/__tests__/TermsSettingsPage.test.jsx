/**
 * TermsSettingsPage — writing, publishing and enforcing the CGV (specs/terms-acceptance-record.md
 * §3.1, §3.4). Every verdict comes from the server overview; the page renders it.
 */
import React from 'react';
import { vi } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

vi.mock('../../../api', () => ({
  __esModule: true,
  default: {
    getTerms: vi.fn(),
    saveTermsDraft: vi.fn(),
    previewTerms: vi.fn(),
    publishTerms: vi.fn(),
    updateTermsEnforcement: vi.fn(),
    getTermsVersion: vi.fn(),
  },
}));

vi.mock('../../../components/DialogProvider', () => {
  const stableToast = { showSuccess: vi.fn(), showError: vi.fn() };
  return { __esModule: true, useToast: () => stableToast };
});

import api from '../../../api';
import TermsSettingsPage from '../TermsSettingsPage';

const overview = (over = {}) => ({
  draft: { fr: '## Conditions', en: '## Terms', updatedAt: '2026-09-22T08:00:00Z' },
  current: { version: 1, publishedAt: '2026-09-01T08:00:00Z', publishedAtLabel: '01/09/2026 à 10:00:00' },
  nextVersion: 2,
  canPublish: true,
  publishBlockedReason: null,
  staleVariables: [],
  unknownVariables: [],
  variables: ['raisonSociale', 'cautions'],
  versions: [{ version: 1, publishedAt: '2026-09-01T08:00:00Z', publishedAtLabel: '01/09/2026 à 10:00:00', shortHash: 'abcdef123456', acceptanceCount: 4 }],
  requireTermsAcceptance: true,
  lastSeenPluginVersion: '1.8.0',
  pluginOutdated: false,
  minPluginVersion: '1.8.0',
  ...over,
});

beforeEach(() => {
  Object.values(api).forEach((m) => m.mockReset());
  api.getTerms.mockResolvedValue(overview());
  api.previewTerms.mockResolvedValue({ html: { fr: '<h2>Conditions</h2>', en: '<h2>Terms</h2>' }, unknownVariables: [] });
  api.saveTermsDraft.mockImplementation(async (d) => overview({ draft: { ...d, updatedAt: 'x' } }));
  api.publishTerms.mockResolvedValue(overview({ current: { version: 2, publishedAtLabel: 'x' }, nextVersion: 3, canPublish: false, publishBlockedReason: 'Rien de nouveau depuis la version 2.' }));
});

const renderPage = () => render(<MemoryRouter><TermsSettingsPage /></MemoryRouter>);
const publishButton = () => screen.getByRole('button', { name: 'Publier la version 2' });

test('the published versions are listed with their acceptance count', async () => {
  renderPage();
  expect(await screen.findByText('abcdef123456')).toBeInTheDocument();
  expect(screen.getByText('4')).toBeInTheDocument();
  expect(screen.getByText('v1 en vigueur')).toBeInTheDocument();
});

test('an edited draft must be saved before it can be published', async () => {
  renderPage();
  const field = await screen.findByLabelText('Texte en français (Markdown)');
  expect(publishButton()).toBeEnabled();
  fireEvent.change(field, { target: { value: '## Conditions\n\nArticle 7.' } });
  expect(publishButton()).toBeDisabled();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Enregistrer le brouillon' })); });
  await waitFor(() => expect(api.saveTermsDraft).toHaveBeenCalledWith({ fr: '## Conditions\n\nArticle 7.', en: '## Terms' }));
  await waitFor(() => expect(publishButton()).toBeEnabled());
});

test('publishing asks for confirmation, then publishes', async () => {
  renderPage();
  await screen.findByText('abcdef123456');
  fireEvent.click(publishButton());
  expect(screen.getByText(/sera figée et proposée aux clients dès maintenant/)).toBeInTheDocument();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Publier' })); });
  expect(api.publishTerms).toHaveBeenCalledTimes(1);
});

test('an unknown variable → publication disabled and the variable named', async () => {
  api.getTerms.mockResolvedValue(overview({ canPublish: false, publishBlockedReason: 'Variable(s) inconnue(s) : {{penalite}}', unknownVariables: ['penalite'] }));
  renderPage();
  expect(await screen.findByText(/variable\(s\) inconnue\(s\) dans le brouillon/)).toHaveTextContent('{{penalite}}');
  expect(publishButton()).toBeDisabled();
});

test('no published version → the closed-booking alert', async () => {
  api.getTerms.mockResolvedValue(overview({ current: null, versions: [], nextVersion: 1 }));
  renderPage();
  expect(await screen.findByText(/la réservation en ligne est fermée/)).toBeInTheDocument();
});

test('a quoted fact that changed → the stale warning names it', async () => {
  api.getTerms.mockResolvedValue(overview({ staleVariables: ['cautions'] }));
  renderPage();
  expect(await screen.findByText(/Un élément cité a changé depuis la version 1/)).toHaveTextContent('{{cautions}}');
});

test('an outdated plugin with the enforcement on → the blocking warning', async () => {
  api.getTerms.mockResolvedValue(overview({ lastSeenPluginVersion: '1.7.0', pluginOutdated: true }));
  renderPage();
  expect(await screen.findByText(/Le site utilise le plugin 1.7.0/)).toBeInTheDocument();
});

test('turning the enforcement off asks for confirmation first', async () => {
  api.updateTermsEnforcement.mockResolvedValue(overview({ requireTermsAcceptance: false }));
  renderPage();
  const toggle = await screen.findByRole('switch', { name: 'Exiger l’acceptation des CGV sur le site' });
  fireEvent.click(toggle);
  expect(api.updateTermsEnforcement).not.toHaveBeenCalled();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Désactiver' })); });
  expect(api.updateTermsEnforcement).toHaveBeenCalledWith(false);
});

test('« Voir » opens the frozen text of the version', async () => {
  api.getTermsVersion.mockResolvedValue({ version: 1, publishedAtLabel: '01/09/2026 à 10:00:00', contentHash: 'abcdef1234567890', html: { fr: '<p>FR</p>', en: '<p>EN</p>' } });
  renderPage();
  await screen.findByText('abcdef123456');
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Voir' })); });
  expect(api.getTermsVersion).toHaveBeenCalledWith(1);
  expect(await screen.findByTitle('Français')).toBeInTheDocument();
});
