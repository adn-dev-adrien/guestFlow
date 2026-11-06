// specs/stay-profile.md §3 rule 1 — the « Profil des séjours » asks with the dashboard's window and
// logement parameters, empty ones left out.
import { vi } from 'vitest';
import api from '../api';

beforeEach(() => { vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) }))); });
afterEach(() => { vi.unstubAllGlobals(); });

test('rule 1: getFinanceStayProfile passes the window and the logement through', async () => {
  await api.getFinanceStayProfile();
  expect(fetch.mock.calls[0][0]).toBe('/api/finance/stay-profile?');
  await api.getFinanceStayProfile({ fiscalYear: 2026, period: 'month', month: '2026-07', propertyId: 2, from: '', to: null }); // date-literal-ok: a query string built from its input
  expect(fetch.mock.calls[1][0]).toBe('/api/finance/stay-profile?fiscalYear=2026&period=month&month=2026-07&propertyId=2'); // date-literal-ok: a query string built from its input
});
