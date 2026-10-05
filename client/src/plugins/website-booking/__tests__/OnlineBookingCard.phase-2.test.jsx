/**
 * specs/plugins-phase-2-hosts.md rule 25 — the website-booking plugin fills two host slots: the
 * « Demandes du site » alert of the dashboard (`dashboard.alerts`) and the « Réservation en ligne »
 * card of the CGV page (`terms.settings`). Uninstalled, it leaves neither, and asks nothing of the
 * server.
 */
import React from 'react';
import { vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

const { mockAuth } = vi.hoisted(() => ({ mockAuth: { user: { roles: ['admin'], enabledPlugins: [] } } }));
vi.mock('../../../hooks/useAuth', () => ({ __esModule: true, useAuth: () => mockAuth }));

vi.mock('../../../api', () => ({
  __esModule: true,
  default: {
    getTerms: vi.fn(),
    previewTerms: vi.fn(),
    getOnlineBooking: vi.fn(),
    updateTermsEnforcement: vi.fn(),
    getPendingPublicDevis: vi.fn(),
  },
}));

vi.mock('../../../components/DialogProvider', () => {
  const stableToast = { showSuccess: vi.fn(), showError: vi.fn() };
  return { __esModule: true, useToast: () => stableToast };
});

import api from '../../../api';
import Slot from '../../sdk/Slot';
import TermsSettingsPage from '../../../pages/settings/TermsSettingsPage';

const overview = {
  draft: { fr: '## Conditions', en: '## Terms', updatedAt: '2026-09-22T08:00:00Z' },
  current: null,
  nextVersion: 1,
  canPublish: true,
  publishBlockedReason: null,
  staleVariables: [],
  unknownVariables: [],
  variables: [],
  versions: [],
};

beforeEach(() => {
  Object.values(api).forEach((m) => m.mockReset());
  api.getTerms.mockResolvedValue(overview);
  api.previewTerms.mockResolvedValue({ html: { fr: '', en: '' }, unknownVariables: [] });
  api.getOnlineBooking.mockResolvedValue({
    requireTermsAcceptance: true, lastSeenPluginVersion: '', minPluginVersion: '1.8.0',
    pluginOutdated: false, bookingClosed: true, outdatedPluginBlocks: false,
  });
  api.getPendingPublicDevis.mockResolvedValue({ alerts: [{ id: 1 }, { id: 2 }] });
});

const renderPage = () => render(<MemoryRouter><TermsSettingsPage /></MemoryRouter>);

test('specs/plugins-phase-2-hosts.md rule 25 — the CGV page shows the plugin card and its alert while website-booking is active', async () => {
  mockAuth.user.enabledPlugins = ['website-booking'];
  renderPage();
  expect(await screen.findByText('Réservation en ligne')).toBeInTheDocument();
  expect(screen.getByText(/réservation en ligne fermée/)).toBeInTheDocument();
  expect(api.getOnlineBooking).toHaveBeenCalledTimes(1);
});

test('specs/plugins-phase-2-hosts.md rule 25 — without website-booking the CGV page has neither card nor alert', async () => {
  mockAuth.user.enabledPlugins = [];
  renderPage();
  expect(await screen.findByText('Brouillon')).toBeInTheDocument();
  expect(screen.queryByText('Réservation en ligne')).not.toBeInTheDocument();
  expect(screen.queryByText(/réservation en ligne fermée/)).not.toBeInTheDocument();
  expect(api.getOnlineBooking).not.toHaveBeenCalled();
});

test('specs/plugins-phase-2-hosts.md rule 25 — « Demandes du site » is a dashboard.alerts contribution, gone with the plugin', async () => {
  mockAuth.user.enabledPlugins = ['website-booking'];
  const { unmount } = render(<MemoryRouter><Slot name="dashboard.alerts" /></MemoryRouter>);
  expect(await screen.findByText('Demandes de devis depuis le site (2)')).toBeInTheDocument();
  unmount();

  mockAuth.user.enabledPlugins = [];
  api.getPendingPublicDevis.mockClear();
  const { container } = render(<MemoryRouter><Slot name="dashboard.alerts" /></MemoryRouter>);
  await waitFor(() => expect(container).toBeEmptyDOMElement());
  expect(api.getPendingPublicDevis).not.toHaveBeenCalled();
});
