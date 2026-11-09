// specs/guest-app.md rule 33 — the return from Qonto follows the order: without network it keeps trying, waiting
// longer each time, and after the try limit it stops and offers to check again.
import { act, renderHook } from '@testing-library/react';
import {
  afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { POLL_LIMIT, POLL_MS, useOrderStatus } from '../hooks/useOrderStatus';
import { ApiError, api } from '../services/api';

vi.mock('../services/api', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, api: { orderById: vi.fn() } };
});

const AWAITING = { id: 42, status: 'awaiting_payment', lines: [] };
const PAID = { id: 42, status: 'paid', lines: [] };
const offline = () => new ApiError(0, 'NETWORK', 'network');

beforeEach(() => { vi.useFakeTimers(); api.orderById.mockReset(); });
afterEach(() => { vi.useRealTimers(); });

describe('useOrderStatus (rule 33)', () => {
  it('a network failure is tried again with a growing wait, then the payment confirmed is read', async () => {
    api.orderById
      .mockResolvedValueOnce(AWAITING)
      .mockRejectedValueOnce(offline())
      .mockRejectedValueOnce(offline())
      .mockResolvedValueOnce(PAID);
    const { result } = renderHook(() => useOrderStatus(42, 'fr'));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(result.current.order.status).toBe('awaiting_payment');
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
    expect(api.orderById).toHaveBeenCalledTimes(2);
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
    expect(api.orderById).toHaveBeenCalledTimes(3);
    // The second failure waits twice as long.
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
    expect(api.orderById).toHaveBeenCalledTimes(3);
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
    expect(api.orderById).toHaveBeenCalledTimes(4);
    expect(result.current).toMatchObject({ order: PAID, error: null, polling: false, stalled: false });
  });

  it('after the try limit it stops, says so, and recheck() reads again', async () => {
    api.orderById.mockResolvedValue(AWAITING);
    const { result } = renderHook(() => useOrderStatus(42, 'fr'));
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS * (POLL_LIMIT + 5)));
    expect(api.orderById).toHaveBeenCalledTimes(POLL_LIMIT + 1);
    expect(result.current).toMatchObject({ polling: false, stalled: true });

    api.orderById.mockResolvedValue(PAID);
    act(() => result.current.recheck());
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(api.orderById).toHaveBeenCalledTimes(POLL_LIMIT + 2);
    expect(result.current).toMatchObject({ order: PAID, stalled: false });
  });

  it('a refusal (not the network) stops at once', async () => {
    api.orderById.mockRejectedValue(new ApiError(404, 'ORDER_NOT_FOUND', 'Commande introuvable.'));
    const { result } = renderHook(() => useOrderStatus(42, 'fr'));
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS * 3));
    expect(api.orderById).toHaveBeenCalledTimes(1);
    expect(result.current.error.code).toBe('ORDER_NOT_FOUND');
  });
});
