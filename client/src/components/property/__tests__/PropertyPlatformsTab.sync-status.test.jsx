// specs/ical-import-hardening.md rules 2, 9 and 10 — a stopped calendar says so and offers no sync; the
// status line is the server's (when, and what changed), its detail in a tooltip; a « 0 » never shows.
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';

vi.mock('../../IcalExportCard', () => ({ default: () => null }));
vi.mock('../../DialogProvider', () => {
  const toast = { showSuccess: vi.fn(), showError: vi.fn() };
  return { __esModule: true, useToast: () => toast };
});
vi.mock('../../../api', () => ({
  default: {
    getPropertyPlatforms: vi.fn(), getPlatformSettings: vi.fn(), createPropertyIcalSource: vi.fn(),
    updatePropertyIcalSource: vi.fn(), deletePropertyIcalSource: vi.fn(), syncPropertyIcalSource: vi.fn(),
    syncAllPropertyIcalSources: vi.fn(), setPlatformColor: vi.fn(),
  },
}));

import api from '../../../api';
import PropertyPlatformsTab from '../PropertyPlatformsTab';

const row = (over) => ({
  isDirect: false, isDirectChannel: false, isBuiltIn: true, touristTaxCollection: 'platform', payoutDueDays: 10,
  disabled: false, isActive: true, sourceId: 1, url: 'https://feed.test/c.ics', ...over,
});

const ROWS = [
  row({
    // A server older than rule 10 sent the flag as the number 0.
    platformKey: 'booking', platformLabel: 'Booking', sourceId: 12, disabled: 0,
    syncStatus: { tone: 'success', text: 'Synchronisé à 02:05 · 1 nouvelle', detail: '1 créé(s), 0 mis à jour, 0 verrouillé(s), 0 annulation(s) à valider, 15 inchangé(s)' },
  }),
  row({
    platformKey: 'lodgify', platformLabel: 'Lodgify', sourceId: 10, isActive: false,
    syncStatus: { tone: 'stopped', text: 'Calendrier arrêté : plus rien n’est importé.', detail: '' },
  }),
];

beforeEach(() => {
  vi.clearAllMocks();
  api.getPropertyPlatforms.mockResolvedValue({ platforms: ROWS.map((r) => ({ ...r })) });
  api.getPlatformSettings.mockResolvedValue({ platforms: [] });
});

const renderTab = () => render(<MemoryRouter><PropertyPlatformsTab propertyId={1} propertyName="La Granja" canManage /></MemoryRouter>);

test('rule 2: a stopped calendar carries « Arrêté » and no « Synchroniser »; « Synchroniser tout » still works for the others', async () => {
  renderTab();
  const lodgify = await screen.findByTestId('platform-row-lodgify');
  expect(within(lodgify).getByText('Arrêté')).toBeInTheDocument();
  expect(within(lodgify).queryByRole('button', { name: /^Synchroniser$/ })).toBeNull();
  expect(within(lodgify).getByText('Calendrier arrêté : plus rien n’est importé.')).toBeInTheDocument();
  expect(within(screen.getByTestId('platform-row-booking')).getByRole('button', { name: /^Synchroniser$/ })).toBeEnabled();
  expect(screen.getByRole('button', { name: /Synchroniser tout/ })).toBeEnabled();
});

test('rule 9: the line is the server’s short status, the full sentence is its tooltip', async () => {
  renderTab();
  const status = await screen.findByTestId('platform-status-booking');
  expect(within(status).getByText('Synchronisé à 02:05 · 1 nouvelle')).toBeInTheDocument();
  expect(screen.queryByText(/0 verrouillé/)).toBeNull();
  await userEvent.hover(status);
  expect(await screen.findByRole('tooltip')).toHaveTextContent('15 inchangé(s)');
});

test('rule 10: no stray « 0 » after the chips of an enabled calendar', async () => {
  renderTab();
  const booking = await screen.findByTestId('platform-row-booking');
  const chipsLine = within(booking).getByText('Booking').parentElement;
  expect(Array.from(chipsLine.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim() === '0')).toBe(false);
  expect(chipsLine.textContent).not.toMatch(/j0$/);
});
