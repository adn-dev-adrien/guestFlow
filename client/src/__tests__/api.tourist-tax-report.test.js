import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

// specs/tourist-tax-report-v2.md §4.3 — the client functions of the tourist-tax report: the query string carries the
// selection as given (empty values left out), the CSV is saved under the server's file name, and a refusal throws
// the server's French reason; rule 36: a lost session reads « Session expirée. », a code alone never shows.

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

  test('rule 36: a lost session on the CSV says « Session expirée. » and sends the app back to the login', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 401, json: async () => ({ error: 'UNAUTHENTICATED' }) }));
    const heard = vi.fn();
    window.addEventListener('guestflow:unauthenticated', heard);
    const api = (await import('../api')).default;
    await expect(api.downloadTouristTaxReportCsv({ period: 'month', month: '2027-08' })).rejects.toMatchObject({ message: 'Session expirée.', status: 401 });
    expect(heard).toHaveBeenCalledTimes(1);
    window.removeEventListener('guestflow:unauthenticated', heard);
  });

  test('rule 36: a refusal with a code alone reads in French, never the code', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 403, json: async () => ({ error: 'FORBIDDEN_ROLE' }) }));
    const api = (await import('../api')).default;
    await expect(api.downloadTouristTaxReportCsv({ period: 'month', month: '2027-08' })).rejects.toMatchObject({ message: 'Téléchargement impossible.', status: 403 });
    global.fetch = vi.fn(async () => ({ ok: false, status: 403, json: async () => ({ error: 'FORBIDDEN_ROLE', message: 'Accès réservé.' }) }));
    await expect(api.downloadTouristTaxReportCsv({ period: 'month', month: '2027-08' })).rejects.toMatchObject({ message: 'Accès réservé.' });
  });
});
