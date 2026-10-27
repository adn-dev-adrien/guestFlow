// PropertyPlatformsTab — the « séjours en CLOSED » switch of a calendar (specs/lodgify-decommission.md
// §3 rule 16): which feed names every stay « CLOSED - Not available » is the source's own setting, not
// the slug `booking`, so a Booking calendar registered as « BookingTente » can say so too.

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
  { platformKey: 'booking-tente', platformLabel: 'BookingTente', isDirect: false, isDirectChannel: false, isBuiltIn: false, url: 'https://b/t.ics', disabled: false, sourceId: 21, feedMarksStaysClosed: true },
  { platformKey: 'airbnb', platformLabel: 'Airbnb', isDirect: false, isDirectChannel: false, isBuiltIn: true, url: 'https://a/c.ics', disabled: false, sourceId: 22, feedMarksStaysClosed: false },
];

beforeEach(() => {
  vi.clearAllMocks();
  api.getPropertyPlatforms.mockResolvedValue({ platforms: ROWS.map((r) => ({ ...r })) });
  api.getPlatformSettings.mockResolvedValue({ platforms: [] });
  api.updatePropertyIcalSource.mockResolvedValue({});
});

const renderTab = () => render(<MemoryRouter><PropertyPlatformsTab propertyId={5} propertyName="La Tente" canManage /></MemoryRouter>);

test('a calendar whose feed marks stays CLOSED carries the chip; the others do not', async () => {
  renderTab();
  const booking = await screen.findByTestId('platform-row-booking-tente');
  expect(within(booking).getByTestId('platform-closed-booking-tente')).toHaveTextContent('CLOSED');
  expect(within(screen.getByTestId('platform-row-airbnb')).queryByTestId('platform-closed-airbnb')).toBeNull();
});

test('the URL editor shows the current setting and saves the switch with the URL', async () => {
  renderTab();
  const airbnb = await screen.findByTestId('platform-row-airbnb');
  fireEvent.click(within(airbnb).getByRole('button', { name: "Modifier l'URL" }));
  const toggle = screen.getByRole('switch', { name: /CLOSED - Not available/ });
  expect(toggle).not.toBeChecked();
  fireEvent.click(toggle);
  fireEvent.click(within(airbnb).getByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => expect(api.updatePropertyIcalSource).toHaveBeenCalledWith(5, 22, expect.objectContaining({ url: 'https://a/c.ics', feedMarksStaysClosed: true })));
});

test('switching a calendar off or on again keeps its CLOSED setting', async () => {
  renderTab();
  const booking = await screen.findByTestId('platform-row-booking-tente');
  fireEvent.click(within(booking).getByRole('button', { name: 'Désactiver' }));
  await waitFor(() => expect(api.updatePropertyIcalSource).toHaveBeenCalledWith(5, 21, expect.objectContaining({ disabled: true, feedMarksStaysClosed: true })));
});
