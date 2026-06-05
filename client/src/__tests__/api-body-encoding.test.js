import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

// 2026-06-05 regression net. Reported live on the prod-shape DB:
// `api.savePlatformAccounts` was calling `JSON.stringify(payload)` AND the
// shared `request()` helper in api.js was JSON.stringify-ing the body again
// → double-encoded request body (`"{\"defaultAccount\":...}"`). Express's
// body-parser rejected with `SyntaxError: Unexpected token '"', "{\"defau"...`
// and returned 400. The PUT response was an HTML error page, the frontend
// surfaced "Bad Request" in the alert, but the user perceived the save as
// successful because the optimistic local state still showed the typed
// values until the next reload — at which point the GET returned the
// untouched DB state and the form looked empty.
//
// Contract pinned by this file: the shared `request()` helper is the SOLE
// place that JSON-encodes request bodies. Every consumer (savePlatformAccounts
// and friends) must pass the RAW payload object as `body`, never a string.

describe('api.js — request body encoding', () => {
  let fetchMock;
  let originalFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    }));
    global.fetch = fetchMock;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('savePlatformAccounts encodes the payload exactly once (not double-stringified)', async () => {
    const api = (await import('../api')).default;
    const payload = {
      defaultAccount: '622600',
      platforms: [{ id: 2, account: '62260300', hasVat: true }],
    };
    await api.savePlatformAccounts(payload);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [, options] = fetchMock.mock.calls[0];
    expect(options.method).toBe('PUT');
    expect(typeof options.body).toBe('string');
    // Single-encoded body parses straight to the original object. A double-
    // stringified body would parse to the string '{"defaultAccount":…}'.
    expect(JSON.parse(options.body)).toEqual(payload);
    expect(JSON.parse(options.body)).not.toBe(JSON.stringify(payload));
    // Defensive: the first char of the serialised body must be `{` (object),
    // never `"` (which is the smoking gun of double-encoding).
    expect(options.body[0]).toBe('{');
  });

  test('every JSON-body endpoint follows the same convention (raw object → request)', async () => {
    // Source-level invariant: no `body: JSON.stringify(...)` in api.js. The
    // shared `request` helper does the single stringify. Any future endpoint
    // that re-stringifies would re-open the same regression.
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const here = path.dirname(fileURLToPath(import.meta.url));
    const apiPath = path.resolve(here, '..', 'api.js');
    const content = fs.readFileSync(apiPath, 'utf8');
    // The `request` helper itself contains the only legitimate
    // `JSON.stringify(options.body)`. Strip its definition before scanning.
    const withoutHelper = content.replace(
      /async function request\([^)]*\)\s*\{[\s\S]*?\n\}/,
      ''
    );
    const offenders = (withoutHelper.match(/body:\s*JSON\.stringify\(/g) || []);
    expect(offenders, 'api.js contains `body: JSON.stringify(…)` outside the request() helper').toEqual([]);
  });
});
