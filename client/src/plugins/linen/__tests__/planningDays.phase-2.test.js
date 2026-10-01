// specs/plugins-phase-2-hosts.md rules 5 and 15 — the laundry's `planning.days` load: the cards the
// planning page used to compute itself, now returned by the plugin for a window of dates.
import { vi } from 'vitest';

vi.mock('../../../api', () => ({
  default: {
    getLaundryPlanningSummary: vi.fn(),
    getLinenInventory: vi.fn(),
    listLaundrySkips: vi.fn(),
    getLaundryManualAdditions: vi.fn(),
    getLaundryExtraTrips: vi.fn(),
  },
}));

import api from '../../../api';
import { loadLaundryDays } from '../planningDays';
import linen from '..';

const EMPTY = { singleBeds: 0, doubleBeds: 0, babyBeds: 0, largeTowels: 0, mediumTowels: 0, smallTowels: 0 };

beforeEach(() => {
  api.getLaundryPlanningSummary.mockResolvedValue({
    laundryDays: [
      { date: '2026-10-06', kind: 'regular', dropOff: { ...EMPTY, doubleBeds: 2 }, pickUp: EMPTY },
      { date: '2026-10-13', kind: 'regular', dropOff: EMPTY, pickUp: EMPTY },
      { date: '2026-10-09', kind: 'extra', dropOff: EMPTY, pickUp: EMPTY },
      { date: '2026-10-20', kind: 'regular', dropOff: { ...EMPTY, incomplete: [{ id: 4 }] }, pickUp: EMPTY },
    ],
  });
  api.getLinenInventory.mockResolvedValue({ byLaundryDay: { '2026-10-06': { double: 8 } } });
  api.listLaundrySkips.mockResolvedValue({ skips: ['2026-09-29', '2026-10-27'] });
  api.getLaundryManualAdditions.mockResolvedValue({ additions: { '2026-10-06': { ...EMPTY, singleBeds: 1 } } });
  api.getLaundryExtraTrips.mockResolvedValue({ trips: [{ date: '2026-10-09', pickUpAll: true, pickUp: {} }] });
});

test('specs/plugins-phase-2-hosts.md rule 5: the laundry returns the days that carry a card, with what the card needs', async () => {
  const days = await loadLaundryDays({ from: '2026-10-01', to: '2026-10-31' });
  expect(api.getLaundryPlanningSummary).toHaveBeenCalledWith({ from: '2026-10-01', to: '2026-10-31' });
  // A silent week is left out; an extra trip, a stay without quantities and a skip in the window stay.
  expect(Object.keys(days).sort()).toEqual(['2026-10-06', '2026-10-09', '2026-10-20', '2026-10-27']);
  expect(days['2026-10-06']).toMatchObject({
    inventoryAfter: { double: 8 }, isSkipped: false, manualAddition: { singleBeds: 1 }, extraTrip: null,
  });
  expect(days['2026-10-09'].extraTrip).toEqual({ date: '2026-10-09', pickUpAll: true, pickUp: {} });
  expect(days['2026-10-27']).toMatchObject({ isSkipped: true, data: { dropOff: {}, pickUp: {} } });
});

test('specs/plugins-phase-2-hosts.md rules 5-6: the module contributes the laundry card and the extra-trip button', () => {
  const [days] = linen.contributes['planning.days'];
  expect(days.rank).toBeGreaterThan(0);
  expect(days.errorMessage).toBe("Le linge n'a pas pu être chargé.");
  expect(linen.contributes['planning.actions']).toHaveLength(1);
  expect(linen.contributes.routes[0].path).toBe('/parametres/stock-blanchisserie');
  expect(linen.contributes['dashboard.alerts'][0].key).toBe('linen-shortage');
});
