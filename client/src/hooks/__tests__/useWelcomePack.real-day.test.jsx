// specs/welcome-pack-auto-options.md + specs/reservations-backend-mvc.md rule 12, reading of 2026-11-03 (audit R20-C2)
// — the welcome pack is asked only for a stay the fiche would quote: a date that is not a real day (5-digit year,
// 30 February) or a reversed range sends nothing.
import { vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

vi.mock('../../api', () => ({ __esModule: true, default: { getWelcomePack: vi.fn() } }));

import api from '../../api';
import useWelcomePack from '../useWelcomePack';
import { addIsoDays, localIsoToday } from '../../utils/isoDay';

const T = localIsoToday();
const ARRIVAL = addIsoDays(T, 30);
const DEPARTURE = addIsoDays(T, 33);
const stay = { enabled: true, propertyId: 1, platform: 'direct', startDate: ARRIVAL, endDate: DEPARTURE, adults: 2, today: T };

beforeEach(() => {
  vi.clearAllMocks();
  api.getWelcomePack.mockResolvedValue({ lines: [] });
});

test('a sound stay is asked', async () => {
  renderHook(() => useWelcomePack(stay));
  await waitFor(() => expect(api.getWelcomePack).toHaveBeenCalledTimes(1));
});

test.each([
  ['a 5-digit departure year', { endDate: `3${DEPARTURE}` }],
  ['a 6-digit arrival year', { startDate: `20${ARRIVAL}` }],
  ['a reversed range', { startDate: DEPARTURE, endDate: ARRIVAL }],
])('%s is not asked', async (_name, dates) => {
  const { result } = renderHook(() => useWelcomePack({ ...stay, ...dates }));
  await new Promise((r) => setTimeout(r, 20));
  expect(api.getWelcomePack).not.toHaveBeenCalled();
  expect(result.current).toEqual([]);
});
