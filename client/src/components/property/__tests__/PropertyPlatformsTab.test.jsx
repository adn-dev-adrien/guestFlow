// PropertyPlatformsTab — only this property's calendars are edited here; the platform's global
// settings are read-only chips linking to Plateformes (specs/settings-rationalization.md rule 18).

import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
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

const ROWS = [
  { platformKey: 'direct', platformLabel: 'Direct', isDirect: true, isDirectChannel: true, isBuiltIn: true, url: '', disabled: 0, sourceId: null },
  { platformKey: 'airbnb', platformLabel: 'Airbnb', color: '#FF5A5F', isDirect: false, isDirectChannel: false, isBuiltIn: true, url: '', touristTaxCollection: 'platform_reversed', platformTakesDeposit: 0, payoutDueDays: 12, disabled: 0, sourceId: null },
  { platformKey: 'vrbo', platformLabel: 'Vrbo', isDirect: false, isDirectChannel: false, isBuiltIn: false, url: 'https://v/c.ics', touristTaxCollection: 'owner', payoutDueDays: 10, disabled: 1, sourceId: 11, lastSyncStatus: 'success' },
];

beforeEach(() => {
  vi.clearAllMocks();
  api.getPropertyPlatforms.mockResolvedValue({ platforms: ROWS.map((r) => ({ ...r })) });
  api.getPlatformSettings.mockResolvedValue({ platforms: [{ id: 3, name: 'Airbnb', commissionPercent: 15.5 }] });
  api.createPropertyIcalSource.mockResolvedValue({});
  api.updatePropertyIcalSource.mockResolvedValue({});
});

const renderTab = () => render(<MemoryRouter><PropertyPlatformsTab propertyId={5} propertyName="Le Moulin" canManage /></MemoryRouter>);

test('the global settings are read-only chips, with a link to Plateformes', async () => {
  renderTab();
  const airbnb = await screen.findByTestId('platform-row-airbnb');
  expect(within(airbnb).getByText('15.5 %')).toBeInTheDocument();
  expect(within(airbnb).getByText('Taxe : plateforme → vous')).toBeInTheDocument();
  expect(within(airbnb).getByText('Virement 12 j')).toBeInTheDocument();
  expect(screen.queryByRole('combobox')).toBeNull();
  expect(screen.getByRole('link', { name: 'Plateformes' })).toHaveAttribute('href', '/settings/plateformes');
});

test('editing the URL of an unconfigured platform creates its source; a non-http URL is refused', async () => {
  renderTab();
  const airbnb = await screen.findByTestId('platform-row-airbnb');
  fireEvent.click(within(airbnb).getByRole('button', { name: "Modifier l'URL" }));
  fireEvent.change(screen.getByLabelText('URL iCal'), { target: { value: 'ftp://nope' } });
  fireEvent.click(within(airbnb).getByRole('button', { name: 'Enregistrer' }));
  expect(await screen.findByText(/Un lien complet/)).toBeInTheDocument();
  expect(api.createPropertyIcalSource).not.toHaveBeenCalled();

  fireEvent.change(screen.getByLabelText('URL iCal'), { target: { value: 'https://airbnb.test/cal.ics' } });
  fireEvent.click(within(airbnb).getByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => expect(api.createPropertyIcalSource).toHaveBeenCalledWith(5, expect.objectContaining({ platformKey: 'airbnb', url: 'https://airbnb.test/cal.ics' })));
});

test('a disabled calendar keeps its live buttons in colour: « Réactiver » filled, « Retirer » red, « Synchroniser » greyed', async () => {
  renderTab();
  const vrbo = await screen.findByTestId('platform-row-vrbo');
  expect(within(vrbo).getByText('Désactivé')).toBeInTheDocument();
  expect(within(vrbo).getByRole('button', { name: 'Réactiver' })).toHaveClass('MuiButton-contained');
  expect(within(vrbo).getByRole('button', { name: 'Retirer' })).toBeEnabled();
  expect(within(vrbo).getByRole('button', { name: /Synchroniser/ })).toBeDisabled();
});

test('a built-in platform cannot be removed; a custom configured one can', async () => {
  renderTab();
  await screen.findByTestId('platform-row-vrbo');
  expect(within(screen.getByTestId('platform-row-airbnb')).queryByRole('button', { name: 'Retirer' })).toBeNull();
  expect(within(screen.getByTestId('platform-row-vrbo')).getByRole('button', { name: 'Retirer' })).toBeInTheDocument();
});
