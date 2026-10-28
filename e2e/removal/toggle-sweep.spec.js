// @ts-check
// The toggle sweep (specs/plugin-removal-resilience.md rules 15-17): on one production server with every
// plugin, each plugin — with the ones requiring it — is deactivated, reactivated, uninstalled keeping its
// data, reinstalled, uninstalled and purged, and reinstalled again, through the real API, restarting the
// server where a plugin must really stop being loaded. After every move the core pages render, and the
// data a plugin kept comes back with it. `node scripts/plugin-removal.mjs sweep`.
const path = require('path');
const { test, expect } = require('@playwright/test');
const {
  ROOT, WORK, seed, CORE_PAGES, countRows, restart, control,
} = require('./helpers');
const { smoke, removedApiMatchers } = require('./smoke');

const REBUILT = new Set(['gvr_rate_snapshot', 'gvr_day_snapshot']);
const SEED = seed();
const IDS = Object.keys(SEED.rows).sort();
const [index, total] = (process.env.SWEEP_SHARD || '1/1').split('/').map(Number);
const MINE = IDS.filter((_, i) => i % total === index - 1);
const Database = require(path.join(ROOT, 'server', 'node_modules', 'better-sqlite3'));
const { PLUGIN_SETTINGS_PLACES, PLUGIN_PAGES } = require('../../server/src/constants/plugins');

const writable = () => new Database(path.join(WORK, 'removal.db'));
const fiches = Object.values(SEED.stays).map((s) => `/reservations/${s.id}`);

/** The causes that refuse a move (rule 16), and what clears them. */
const BLOCKERS = {
  'online-payment': {
    code: 'OPEN_PAYMENT_LINKS',
    cause: () => { const db = writable(); db.prepare("INSERT INTO payment_links (reservationId, type, url, amountCents, status, providerLinkId) VALUES (?, 'balance', 'https://pay.example.test/open', 100, 'open', 'pl_open')").run(SEED.stays.direct.id); db.close(); },
    clear: () => { const db = writable(); db.prepare("UPDATE payment_links SET status = 'cancelled' WHERE status = 'open'").run(); db.close(); },
  },
  sas: {
    code: 'RECEPTION_USERS',
    cause: () => {},
    clear: () => { const db = writable(); db.prepare("UPDATE users SET isActive = 0 WHERE id IN (SELECT userId FROM user_roles WHERE role = 'reception')").run(); db.close(); },
  },
  'accounting-export': {
    code: 'ACCOUNTANT_USERS',
    cause: () => { const db = writable(); const id = db.prepare("INSERT INTO users (email, passwordHash, firstName, lastName, isActive) VALUES ('comptable@example.test', 'x', 'Compta', 'Ble', 1)").run().lastInsertRowid; db.prepare("INSERT INTO user_roles (userId, role) VALUES (?, 'accountant')").run(id); db.close(); },
    clear: () => { const db = writable(); db.prepare("UPDATE users SET isActive = 0 WHERE email = 'comptable@example.test'").run(); db.close(); },
  },
};

async function plugins(request) {
  return Object.fromEntries((await (await request.get('/api/plugins')).json()).map((p) => [p.id, p]));
}

for (const id of MINE) {
  test(`rules 15-17 — ${id}: deactivate, reactivate, uninstall, reinstall, purge, reinstall`, async ({ page }) => {
    test.setTimeout(600_000);
    const request = page.request;
    const known = await plugins(request);
    const group = [id, ...Object.values(known).filter((p) => (p.requires || []).some((r) => r.id === id)).map((p) => p.id)];
    const rowsOf = (ids) => Object.assign({}, ...ids.map((p) => Object.fromEntries(Object.entries(SEED.rows[p] || {}))));
    const keptRows = () => countRows(Object.keys(rowsOf(group)));
    // A plugin may add rows of its own once it runs again (the school holidays sync themselves): what the
    // seed put there must still be there, never less.
    const expectKept = (label) => {
      const expected = rowsOf(group);
      const now = keptRows();
      // The feed's snapshots are what it last sent: its catch-up rewrites them from the real state.
      Object.keys(expected).filter((table) => !REBUILT.has(table)).forEach((table) => expect(now[table], `${label}: ${table}`).toBeGreaterThanOrEqual(expected[table]));
    };
    const call = async (method, url, expected, label) => {
      const res = await request.fetch(url, { method });
      expect(res.status(), `${label} (${method} ${url})`).toBe(expected);
      return res;
    };
    // While the group is off the core pages neither call its API nor link to the pages only it owns.
    const exclusive = Object.entries(PLUGIN_PAGES).filter(([, owners]) => owners.every((o) => group.includes(o))).map(([p]) => p);
    const coreSmoke = async (label) => {
      const problems = await smoke(page, [...CORE_PAGES, ...fiches], { matchers: removedApiMatchers(group), hiddenLinks: exclusive });
      expect(problems, label).toEqual([]);
    };
    const ownPagesRender = async (ids, label) => {
      const places = ids.map((p) => PLUGIN_SETTINGS_PLACES[p]).filter(Boolean);
      expect(await smoke(page, [...new Set(places)]), label).toEqual([]);
    };

    // Google Vacation Rentals re-sends everything when it comes back (rule 17): the push log says so.
    const catchUps = () => {
      const db = writable();
      try { return db.prepare("SELECT COUNT(*) AS n FROM gvr_push_log WHERE reason = 'catch-up'").get().n; } finally { db.close(); }
    };
    const expectCatchUp = async (before, label) => {
      if (!group.includes('google-vacation-rentals')) return;
      await expect.poll(catchUps, { message: label, timeout: 30_000 }).toBeGreaterThan(before);
    };

    const blocker = BLOCKERS[id];
    if (blocker) {
      blocker.cause();
      const refused = await request.post(`/api/plugins/${id}/deactivate`);
      expect(refused.status(), `${id}: refused while it is needed`).toBe(409);
      expect((await refused.json()).code, id).toBe(blocker.code);
      blocker.clear();
    }
    if (group.length > 1) {
      const refused = await request.post(`/api/plugins/${id}/deactivate`);
      expect(refused.status(), `${id}: refused while ${group[1]} needs it`).toBe(409);
      expect((await refused.json()).error).toBe('REQUIRED_BY');
    }

    // (a) deactivated: the dependants first, then the plugin.
    for (const p of [...group].reverse()) await call('POST', `/api/plugins/${p}/deactivate`, 200, `deactivate ${p}`);
    await coreSmoke(`${id} deactivated`);
    // Something changes while the group is off: no event reaches it (the bus drops them), and what it holds
    // for the stay must come back as it was, the change included (rule 17).
    const db = writable();
    db.prepare("UPDATE reservations SET notes = 'changed while off' WHERE id = ?").run(SEED.stays.direct.id);
    db.close();
    // (b) back: the plugin first, then its dependants; its pages render, its data is untouched.
    const beforeActivation = group.includes('google-vacation-rentals') ? catchUps() : 0;
    for (const p of group) await call('POST', `/api/plugins/${p}/activate`, 200, `activate ${p}`);
    await expectCatchUp(beforeActivation, `${id}: the feed re-sends everything after a reactivation`);
    await ownPagesRender(group, `${id} reactivated: its own pages`);
    expectKept(`${id}: rows after the round trip`);
    const fiche = await (await request.get(`/api/reservations/${SEED.stays.direct.id}`)).json();
    expect(fiche.notes, `${id}: the change made while it was off is kept`).toBe('changed while off');
    const passes = await control.passes(request);
    expect(passes.failed, `${id}: a pass threw after the plugin came back`).toEqual({});

    // (c) uninstalled keeping its data: really not loaded after a restart.
    for (const p of [...group].reverse()) await call('DELETE', `/api/plugins/${p}`, 200, `uninstall ${p}`);
    await restart(request);
    await coreSmoke(`${id} uninstalled`);
    expectKept(`${id}: rows kept while uninstalled`);
    const beforeReinstall = group.includes('google-vacation-rentals') ? catchUps() : 0;
    for (const p of group) await call('POST', `/api/plugins/${p}/install`, 200, `reinstall ${p}`);
    await expectCatchUp(beforeReinstall, `${id}: the feed re-sends everything after a reinstall`);
    await restart(request);
    await ownPagesRender(group, `${id} reinstalled: its own pages`);
    expectKept(`${id}: rows after the reinstall`);

    // (d) purged: its tables are dropped, and a reinstall without a restart works on empty ones.
    const listed = await plugins(request);
    if (listed[id].erasable) {
      for (const p of [...group].reverse()) await call('DELETE', `/api/plugins/${p}?purge=1`, 200, `purge ${p}`);
      await restart(request);
      await coreSmoke(`${id} purged`);
      for (const p of group) await call('POST', `/api/plugins/${p}/install`, 200, `reinstall ${p} after the purge`);
      await ownPagesRender(group, `${id} reinstalled after the purge, without a restart`);
      await restart(request);
      await ownPagesRender(group, `${id} reinstalled after the purge, after a restart`);
    }
  });
}
