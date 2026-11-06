// specs/finance-data-checks.md §3 rule 10 — the « À vérifier » read sends the exercise and the logement, nothing empty.
import { vi } from 'vitest';
import api from '../api';

beforeEach(() => { vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) }))); });
afterEach(() => { vi.unstubAllGlobals(); });

test('rule 10: getFinanceDataChecks asks /finance/data-checks with the exercise and the logement', async () => {
  await api.getFinanceDataChecks({ fiscalYear: 2026, propertyId: 3 });
  expect(fetch.mock.calls[0][0]).toBe('/api/finance/data-checks?fiscalYear=2026&propertyId=3');
  await api.getFinanceDataChecks({ fiscalYear: 2026, propertyId: '' });
  expect(fetch.mock.calls[1][0]).toBe('/api/finance/data-checks?fiscalYear=2026');
  await api.getFinanceDataChecks();
  expect(fetch.mock.calls[2][0]).toBe('/api/finance/data-checks?');
});
