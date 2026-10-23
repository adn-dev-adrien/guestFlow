// specs/plugins-phase-1-sdk.md rule 13 — `calendar.dayMarkers`: two plugins contributing the same `key`
// both draw their dots; neither overwrites the other.
import { renderHook, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

let CONTRIBUTIONS = [];
vi.mock('../../plugins/sdk/useSlot', () => ({ __esModule: true, useSlot: () => CONTRIBUTIONS }));

import useDayMarkers from '../useDayMarkers';

test('two plugins with the same key each keep their markers', async () => {
  CONTRIBUTIONS = [
    { pluginId: 'school-holidays', key: 'days', load: () => () => [{ key: 'A', color: 'blue', title: 'Zone A' }] },
    { pluginId: 'weather-alerts', key: 'days', load: () => Promise.resolve(() => [{ key: 'storm', color: 'red', title: 'Orage' }]) },
  ];
  const { result } = renderHook(() => useDayMarkers());
  await waitFor(() => expect(result.current.markersFor('2026-10-23')).toHaveLength(2));
  expect(result.current.markersFor('2026-10-23').map((m) => m.title)).toEqual(['Zone A', 'Orage']);
});
