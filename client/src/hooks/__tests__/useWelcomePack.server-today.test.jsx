// specs/welcome-pack-auto-options.md + specs/reservations-backend-mvc.md rule 13, second reading (review of PR #938,
// F8) — the welcome pack is asked only for dates inside the window of the server's day the fiche hands it.
import { vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

vi.mock('../../api', () => ({ __esModule: true, default: { getWelcomePack: vi.fn() } }));

import api from '../../api';
import useWelcomePack from '../useWelcomePack';
import { horizonStart } from '../../utils/dateHorizon';
import { addIsoDays, localIsoToday } from '../../utils/isoDay';

const START = horizonStart(localIsoToday());
const stay = { enabled: true, propertyId: 1, platform: 'direct', startDate: START, endDate: addIsoDays(START, 3), adults: 2 };

beforeEach(() => {
  vi.clearAllMocks();
  api.getWelcomePack.mockResolvedValue({ lines: [] });
});

test('a stay starting on the device\'s today − 5 years is asked with the device\'s day', async () => {
  renderHook(() => useWelcomePack(stay));
  await waitFor(() => expect(api.getWelcomePack).toHaveBeenCalledTimes(1));
});

test('the same stay is not asked when the server\'s day is one day ahead', async () => {
  const { result } = renderHook(() => useWelcomePack({ ...stay, today: addIsoDays(localIsoToday(), 1) }));
  await new Promise((r) => setTimeout(r, 20));
  expect(api.getWelcomePack).not.toHaveBeenCalled();
  expect(result.current).toEqual([]);
});
