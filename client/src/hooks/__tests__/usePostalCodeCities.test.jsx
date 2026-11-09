// specs/resource-booking-pricing-and-invoicing.md rule 27 — the communes of a postcode: from 2 digits, debounced, a help only.
import { renderHook, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import usePostalCodeCities from '../usePostalCodeCities';

afterEach(() => { vi.restoreAllMocks(); });

test('rule 27 — under 2 digits, or disabled, nothing is asked', async () => {
  const fetchSpy = vi.spyOn(globalThis, 'fetch');
  const { result } = renderHook(() => usePostalCodeCities('0'));
  renderHook(() => usePostalCodeCities('07200', '', { enabled: false }));
  await new Promise((r) => setTimeout(r, 300));
  expect(result.current).toEqual([]);
  expect(fetchSpy).not.toHaveBeenCalled();
});

test('rule 27 — the communes of the postcode, deduplicated', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => [{ nom: 'Aubenas' }, { nom: 'Ucel' }, { nom: 'Ucel' }] });
  const { result } = renderHook(() => usePostalCodeCities('07200'));
  await waitFor(() => expect(result.current).toEqual(['Aubenas', 'Ucel']));
  expect(String(globalThis.fetch.mock.calls[0][0])).toContain('codePostal=07200');
});

test('rule 27 — a failed lookup leaves an empty list, never an error', async () => {
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
  const { result } = renderHook(() => usePostalCodeCities('07200'));
  await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
  await waitFor(() => expect(result.current).toEqual([]));
});
