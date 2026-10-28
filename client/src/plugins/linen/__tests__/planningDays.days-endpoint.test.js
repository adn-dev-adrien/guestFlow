// specs/linen-laundry-days.md §3.2 rule 13 and §4.2 — the laundry's `planning.days` load is one call to
// the server and returns its cards untouched: nothing summed, filtered or merged on the client.
import { vi } from 'vitest';

vi.mock('../../../api', () => ({ default: { getLaundryPlanningDays: vi.fn() } }));

import api from '../../../api';
import { loadLaundryDays } from '../planningDays';
import linen from '..';

const CARDS = {
  '2026-10-06': { kind: 'regular', isSkipped: false, dropOff: { doubleBeds: 2, incomplete: [] }, pickUp: { fromTrips: [] }, stillAtLaundry: null, inventoryAfter: { double: 8 } },
  '2026-10-09': { kind: 'extra', extraTrip: { pickUpAll: true, pickUp: {} } },
  '2026-10-13': { kind: 'regular', isSkipped: true },
};

test('specs/linen-laundry-days.md rule 13: one request for the window, the server\'s cards passed through untouched', async () => {
  api.getLaundryPlanningDays.mockResolvedValue({ days: CARDS });
  const days = await loadLaundryDays({ from: '2026-10-01', to: '2026-10-31' });
  expect(api.getLaundryPlanningDays).toHaveBeenCalledTimes(1);
  expect(api.getLaundryPlanningDays).toHaveBeenCalledWith({ from: '2026-10-01', to: '2026-10-31' });
  expect(days).toBe(CARDS);
});

test('specs/linen-laundry-days.md rule 13: a window with no card is an empty object, and a failure propagates to the host', async () => {
  api.getLaundryPlanningDays.mockResolvedValueOnce({ days: {} });
  expect(await loadLaundryDays({ from: '2026-01-01', to: '2026-01-07' })).toEqual({});
  api.getLaundryPlanningDays.mockResolvedValueOnce({});
  expect(await loadLaundryDays({ from: '2026-01-01', to: '2026-01-07' })).toEqual({});
  api.getLaundryPlanningDays.mockRejectedValueOnce(new Error('boom'));
  await expect(loadLaundryDays({ from: '2026-01-01', to: '2026-01-07' })).rejects.toThrow('boom');
});

test('specs/linen-laundry-days.md rule 14: the planning.days contribution keeps its contract — load({ from, to }) → { date: entry }', () => {
  const [days] = linen.contributes['planning.days'];
  expect(days.key).toBe('laundry');
  expect(typeof days.load).toBe('function');
  expect(days.errorMessage).toBe("Le linge n'a pas pu être chargé.");
});
