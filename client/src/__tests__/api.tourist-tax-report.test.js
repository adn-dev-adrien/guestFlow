import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

// specs/tourist-tax-report-v2.md §4.3 — the client functions of the tourist-tax report: the query string carries the
// selection as given (empty values left out), the CSV is saved under the server's file name, and a refusal throws
// the server's French reason.

describe('api.js — tourist-tax report', () => {
  let originalFetch;
  let originalCreate;
  let originalRevoke;

  beforeEach(() => {
    originalFetch = global.fetch;
    originalCreate = URL.createObjectURL;
    originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => 'blob:report');
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
    vi.restoreAllMocks();
  });

  test('getTouristTaxReport sends the selection, empty values left out', async () => {
    global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ totals: {} }) }));
    const api = (await import('../api')).default;
    await api.getTouristTaxReport({ period: 'quarter', quarter: '2027-Q3', propertyId: '', declaration: 'todo' });
    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe('/api/finance/tourist-tax/report?period=quarter&quarter=2027-Q3&declaration=todo');
    expect(options.credentials).toBe('include');
  });

  test('downloadTouristTaxReportCsv saves the file the server names, with the view', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      blob: async () => new Blob(['x']),
      headers: { get: (name) => (name === 'Content-Disposition' ? 'attachment; filename="taxe-de-sejour-a_b-par-nuit.csv"' : null) },
    }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const api = (await import('../api')).default;
    const name = await api.downloadTouristTaxReportCsv({ period: 'month', month: '2027-08' }, 'night');
    expect(global.fetch.mock.calls[0][0]).toBe('/api/finance/tourist-tax/report.csv?period=month&month=2027-08&view=night');
    expect(name).toBe('taxe-de-sejour-a_b-par-nuit.csv');
    expect(click).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:report');
  });

  test('a refused CSV throws the server reason', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 400, json: async () => ({ error: 'Deux dates à choisir.' }) }));
    const api = (await import('../api')).default;
    await expect(api.downloadTouristTaxReportCsv({ period: 'custom', from: '', to: '' })).rejects.toMatchObject({
      message: 'Deux dates à choisir.',
      status: 400,
    });
  });
});
