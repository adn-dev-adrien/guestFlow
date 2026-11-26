// specs/pricing/pricing-components.md rule 124 — the fiche asks the server whether the draft sells with no stay, asks again when the
// price type / planning card / insurance flag changes, and never shows one article's answer on another.
import { renderHook, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

vi.mock('../../api', () => ({ __esModule: true, default: { getOutsideSellability: vi.fn() } }));
import api from '../../api';
import useOutsideSellability from '../useOutsideSellability';

const NO = { sellable: false, code: 'NEEDS_STAY', reason: 'Le prix « par personne » a besoin d’un séjour : il ne se vend pas seul.' };
const YES = { sellable: true, code: null, reason: null };

beforeEach(() => { api.getOutsideSellability.mockReset(); });

test('pricing-components rule 124: asks with the draft fields and asks again when the price type changes', async () => {
  api.getOutsideSellability.mockResolvedValueOnce(NO).mockResolvedValueOnce(YES);
  const { result, rerender } = renderHook(({ draft }) => useOutsideSellability(true, 'option', draft), {
    initialProps: { draft: { id: 1, priceType: 'per_person', showsPlanningCard: false } },
  });
  await waitFor(() => expect(result.current).toEqual(NO));
  expect(api.getOutsideSellability).toHaveBeenLastCalledWith({ kind: 'option', priceType: 'per_person', showsPlanningCard: 0, isCancellationInsurance: 0 });
  rerender({ draft: { id: 1, priceType: 'per_person', showsPlanningCard: true } });
  expect(result.current).toEqual(NO);
  await waitFor(() => expect(result.current).toEqual(YES));
  expect(api.getOutsideSellability).toHaveBeenLastCalledWith({ kind: 'option', priceType: 'per_person', showsPlanningCard: 1, isCancellationInsurance: 0 });
});

test('pricing-components rule 124: another article, or the panel closing, drops the previous answer', async () => {
  let resolveSecond;
  api.getOutsideSellability.mockResolvedValueOnce(NO).mockReturnValueOnce(new Promise((r) => { resolveSecond = r; }));
  const { result, rerender } = renderHook(({ enabled, draft }) => useOutsideSellability(enabled, 'option', draft), {
    initialProps: { enabled: true, draft: { id: 1, priceType: 'per_person' } },
  });
  await waitFor(() => expect(result.current).toEqual(NO));
  rerender({ enabled: true, draft: { id: 2, priceType: 'per_stay' } });
  expect(result.current).toBeNull();
  resolveSecond(YES);
  await waitFor(() => expect(result.current).toEqual(YES));
  rerender({ enabled: false, draft: { id: 2, priceType: 'per_stay' } });
  expect(result.current).toBeNull();
});
