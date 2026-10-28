// specs/inte-performance.md rule 8 — identical GETs in flight are one request; a write never lets a
// later read join an earlier one.
import { vi } from 'vitest';
import api from '../api';

const json = (body) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });

beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); });
afterEach(() => { vi.unstubAllGlobals(); });

test('rule 8: two reads of the same path in the same tick send one request', async () => {
  fetch.mockImplementation(() => json([{ id: 1 }]));
  const [a, b] = await Promise.all([api.getProperties(), api.getProperties()]);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(a).toEqual([{ id: 1 }]);
  expect(b).toEqual([{ id: 1 }]);
});

test('rule 8: each caller gets its own copy, so one mutating it does not change the other', async () => {
  fetch.mockImplementation(() => json([{ id: 1 }]));
  const [a, b] = await Promise.all([api.getProperties(), api.getProperties()]);
  a[0].id = 99;
  expect(b[0].id).toBe(1);
});

test('rule 8: a read after the first settled is a new request', async () => {
  fetch.mockImplementation(() => json([]));
  await api.getProperties();
  await api.getProperties();
  expect(fetch).toHaveBeenCalledTimes(2);
});

test('rule 8: different paths are different requests', async () => {
  fetch.mockImplementation(() => json([]));
  await Promise.all([api.getProperties(), api.getSystemVersion()]);
  expect(fetch).toHaveBeenCalledTimes(2);
});

test('rule 8: a write empties the table, the read after it does not join the read before it', async () => {
  let release;
  fetch.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve({ ok: true, status: 200, json: () => Promise.resolve(['old']) }); }));
  const before = api.getProperties();
  fetch.mockImplementationOnce(() => json({}));
  await api.changePassword('a', 'b');
  fetch.mockImplementationOnce(() => json(['new']));
  const after = await api.getProperties();
  release();
  expect(after).toEqual(['new']);
  expect(await before).toEqual(['old']);
  expect(fetch).toHaveBeenCalledTimes(3);
});

test('rule 8: a failed read rejects every caller and is not remembered', async () => {
  fetch.mockImplementationOnce(() => Promise.resolve({ ok: false, status: 500, statusText: 'x', json: () => Promise.resolve({ error: 'boom' }) }));
  const results = await Promise.allSettled([api.getProperties(), api.getProperties()]);
  expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected']);
  fetch.mockImplementationOnce(() => json(['ok']));
  expect(await api.getProperties()).toEqual(['ok']);
});
