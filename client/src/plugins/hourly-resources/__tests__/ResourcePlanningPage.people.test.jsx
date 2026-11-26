// specs/site/site-outside-resource-booking.md rule 4 — the people declared at booking are in the tooltip of a booking on the planning grid, and only when there are some.
import React from 'react';
import { vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../../theme';
import DialogProvider from '../../../components/DialogProvider';

const { getResources, getResourceBookings } = vi.hoisted(() => ({ getResources: vi.fn(), getResourceBookings: vi.fn() }));
vi.mock('../../../api', () => ({ __esModule: true, default: { getResources, getResourceBookings } }));

import ResourcePlanningPage from '../ResourcePlanningPage';

const RESOURCE = { id: 3, name: 'Bain', isComplex: 1, openTime: '08:00', closeTime: '22:00', slotDuration: 60 };
const bookingOn = (weekStart, id, name, people, startTime, endTime) => {
  const day = new Date(`${weekStart}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() + 2);
  return {
    id, resourceId: 3, date: day.toISOString().slice(0, 10), startTime, endTime, notes: '', totalPrice: 30,
    paid: false, propertyId: null, propertyName: '', displayName: name, firstName: name, lastName: '', kind: 'booking', people,
    resourceName: 'Bain', slotDuration: 60, openTime: '08:00', closeTime: '22:00', turnoverMinutes: 0, openDays: '[0,1,2,3,4,5,6]',
  };
};

beforeEach(() => {
  window.matchMedia = (query) => ({
    matches: /min-width/.test(query), media: query, onchange: null, dispatchEvent: () => false,
    addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {},
  });
  getResources.mockReset().mockResolvedValue([RESOURCE]);
  getResourceBookings.mockReset().mockImplementation(({ weekStart }) => Promise.resolve([
    bookingOn(weekStart, 1, 'Avec', 4, '09:00', '10:00'),
    bookingOn(weekStart, 2, 'Sans', null, '11:00', '12:00'),
  ]));
});
afterEach(() => { delete window.matchMedia; });

test('the tooltip of a booking names its people, and says nothing of them when none were declared', async () => {
  render(<MemoryRouter><ThemeProvider theme={theme}><DialogProvider><ResourcePlanningPage /></DialogProvider></ThemeProvider></MemoryRouter>);
  const withPeople = await screen.findByLabelText(/Avec/, {}, { timeout: 5000 });
  expect(withPeople.getAttribute('aria-label')).toMatch(/ · 4 pers\./);
  const without = await screen.findByLabelText(/Sans/);
  expect(without.getAttribute('aria-label')).not.toMatch(/pers\./);
});
