// specs/accounting-synthesis.md §3 rule 1 and §4.3 — the client asks the synthesis with the period it was given,
// nothing more: the server judges every key.
import { vi } from 'vitest';
import api from '../api';

beforeEach(() => { vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) }))); });
afterEach(() => { vi.unstubAllGlobals(); });

test('rule 1: the period and its keys travel as given, empty ones left out', async () => {
  await api.getAccountingSynthesis();
  expect(fetch.mock.calls.at(-1)[0]).toBe('/api/accounting/synthesis');
  await api.getAccountingSynthesis({ period: 'quarter', quarter: '2026-Q3', month: '' });
  expect(fetch.mock.calls.at(-1)[0]).toBe('/api/accounting/synthesis?period=quarter&quarter=2026-Q3');
  await api.getAccountingSynthesis({ period: 'custom', from: '2026-01-01', to: '2026-03-31', fiscalYear: null }); // date-literal-ok: query text the client forwards, compared with nothing
  expect(fetch.mock.calls.at(-1)[0]).toBe('/api/accounting/synthesis?period=custom&from=2026-01-01&to=2026-03-31');
  await api.getAccountingSynthesis({ period: 'fy', fiscalYear: 2026 });
  expect(fetch.mock.calls.at(-1)[0]).toBe('/api/accounting/synthesis?period=fy&fiscalYear=2026');
});
