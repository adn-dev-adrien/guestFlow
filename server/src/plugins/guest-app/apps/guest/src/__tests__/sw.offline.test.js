// specs/guest-app.md rule 21 — offline: the booklet (and what a session reads to show it) stays readable without
// network from the service worker's cache, its photos too; the shop, the orders, the gate and the sessions are
// never answered from a cache (the app says « Connexion nécessaire »). The data cache is emptied on the page's
// `purge` (the device holds no stay any more) and keeps at most 200 photos; the shell stays.
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const SOURCE = fs.readFileSync(path.resolve(__dirname, '../../public/sw.js'), 'utf8');
const ORIGIN = 'https://sejour.example.test';

/** A fake service-worker global: Cache Storage in memory, a switchable network, the listeners it registers. */
function boot() {
  const stores = new Map();
  const keyOf = (r) => (typeof r === 'string' ? new URL(r, ORIGIN).href : r.url);
  const openStore = (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const m = stores.get(name);
    return {
      match: async (r) => m.get(keyOf(r))?.clone(),
      put: async (r, res) => { m.set(keyOf(r), res); },
      keys: async () => [...m.keys()].map((url) => ({ url })),
      delete: async (r) => m.delete(keyOf(r)),
      add: async (r) => { m.set(keyOf(r), new Response('shell')); },
      addAll: async (list) => { list.forEach((r) => m.set(keyOf(r), new Response('shell'))); },
    };
  };
  const caches = {
    open: async (name) => openStore(name),
    keys: async () => [...stores.keys()],
    delete: async (name) => stores.delete(name),
    match: async (r) => {
      for (const name of stores.keys()) { const hit = await openStore(name).match(r); if (hit) return hit; }
      return undefined;
    },
  };
  const net = { online: true, calls: [] };
  const fetch = async (request) => {
    net.calls.push(request.url);
    if (!net.online) throw new TypeError('Failed to fetch');
    return new Response(JSON.stringify({ from: 'network', url: request.url }), { status: 200 });
  };
  const listeners = {};
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type, fn) => { listeners[type] = fn; },
    skipWaiting: () => Promise.resolve(),
    clients: { claim: () => Promise.resolve() },
  };
  vm.runInNewContext(SOURCE, { self, caches, fetch, URL, Response, Promise, JSON, Error, Array });

  /** Dispatches a fetch event; resolves to the response, or null when the worker lets the page go to the network. */
  const dispatch = async (pathname, { mode = 'cors', method = 'GET' } = {}) => {
    let answered = null;
    listeners.fetch({ request: { url: ORIGIN + pathname, method, mode }, respondWith: (p) => { answered = p; } });
    return answered ? answered : null;
  };
  /** Posts a message from the page; resolves once the worker's work for it is done. */
  const post = async (data) => {
    let work = Promise.resolve();
    listeners.message({ data, waitUntil: (p) => { work = p; } });
    await work;
  };
  return { net, dispatch, post, stores };
}

describe('service worker — offline booklet (rule 21)', () => {
  let sw;
  beforeEach(() => { sw = boot(); });

  it('reads the booklet, /me and /lodging from the network first, then from the cache without network', async () => {
    for (const p of ['/public/v1/guest/booklet', '/public/v1/guest/me', '/public/v1/guest/lodging']) {
      const online = await sw.dispatch(p);
      expect(await online.json()).toMatchObject({ from: 'network' });
    }
    sw.net.online = false;
    for (const p of ['/public/v1/guest/booklet', '/public/v1/guest/me', '/public/v1/guest/lodging']) {
      const offline = await sw.dispatch(p);
      expect(offline).toBeTruthy();
      expect(await offline.json()).toMatchObject({ from: 'network', url: ORIGIN + p });
    }
  });

  it('keeps the booklet photos readable offline (stale-while-revalidate)', async () => {
    await (await sw.dispatch('/uploads/guest-app/terrasse.jpg')).text();
    sw.net.online = false;
    const offline = await sw.dispatch('/uploads/guest-app/terrasse.jpg');
    expect(offline.status).toBe(200);
  });

  it('never answers the shop, the orders, the gate or the sessions from a cache', async () => {
    for (const p of ['/public/v1/guest/shop', '/public/v1/guest/orders/quote', '/public/v1/guest/orders', '/public/v1/guest/gate', '/public/v1/guest/sessions']) {
      expect(await sw.dispatch(p)).toBeNull();
    }
  });

  it('opens the shell offline once it has been loaded', async () => {
    await (await sw.dispatch('/', { mode: 'navigate' })).text();
    sw.net.online = false;
    const offline = await sw.dispatch('/livret', { mode: 'navigate' });
    expect(offline).toBeTruthy();
    expect(offline.status).toBe(200);
  });

  it('a purge empties the data cache, booklet and photos, and keeps the shell', async () => {
    await (await sw.dispatch('/', { mode: 'navigate' })).text();
    await sw.dispatch('/public/v1/guest/me');
    await (await sw.dispatch('/uploads/guest-app/terrasse.jpg')).text();
    await sw.post({ type: 'purge' });
    expect(sw.stores.has('mon-sejour-v1-data')).toBe(false);
    sw.net.online = false;
    expect(await sw.dispatch('/public/v1/guest/me')).toBeUndefined();
    expect((await sw.dispatch('/uploads/guest-app/terrasse.jpg')).status).toBe(503);
    expect((await sw.dispatch('/livret', { mode: 'navigate' })).status).toBe(200);
  });

  it('keeps at most 200 photos, the oldest dropped first, and the booklet reads beside them', async () => {
    await sw.dispatch('/public/v1/guest/booklet');
    for (let i = 0; i < 205; i += 1) await (await sw.dispatch(`/uploads/guest-app/p${i}.jpg`)).text();
    const data = sw.stores.get('mon-sejour-v1-data');
    const photos = [...data.keys()].filter((k) => k.includes('/uploads/'));
    expect(photos).toHaveLength(200);
    expect(photos[0]).toBe(`${ORIGIN}/uploads/guest-app/p5.jpg`);
    expect(data.has(`${ORIGIN}/public/v1/guest/booklet`)).toBe(true);
  });

  it('leaves writes to the network', async () => {
    expect(await sw.dispatch('/public/v1/guest/booklet', { method: 'POST' })).toBeNull();
  });
});
