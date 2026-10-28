// @ts-check
// The removal matrix's checks (specs/plugin-removal-resilience.md rules 8-12): the production build on
// the seeded database of a cell, whose plugin — and the ones requiring it — are gone from the code
// while their rows are still installed. `node scripts/plugin-removal.mjs cell <id>`.
const { test, expect } = require('@playwright/test');
const {
  seed, reference, removed, CORE_PAGES, countRows, control,
} = require('./helpers');
const { coreContract } = require('./coreContract');
const { smoke, removedApiMatchers } = require('./smoke');
const { money } = require('./money');

const SEED = seed();
const GONE = removed();
const SHIPPED = Object.keys(SEED.rows).filter((id) => !GONE.includes(id));
const { PLUGIN_PAGES, PLUGIN_SETTINGS_PLACES } = require('../../server/src/constants/plugins');

test('rule 8 — boot and health: the removed plugins are reported missing, every other one is active', async ({ request }) => {
  const version = await request.get('/api/version');
  expect(version.status()).toBe(200);
  const log = await control.log(request);
  const failures = log.split('\n').filter((line) => /register failed|migration failed/.test(line) && !GONE.some((id) => line.includes(`[plugin:${id}]`)));
  expect(failures, 'a plugin other than the removed ones failed to start').toEqual([]);
  const plugins = await (await request.get('/api/plugins')).json();
  const byId = Object.fromEntries(plugins.map((p) => [p.id, p]));
  GONE.forEach((id) => {
    expect(byId[id], `${id} is not listed`).toBeTruthy();
    expect(byId[id].state, id).toBe('incompatible');
    expect(byId[id].incompatible.code, id).toBe('PACKAGE_MISSING');
  });
  SHIPPED.forEach((id) => expect(byId[id] && byId[id].state, id).toBe('active'));
});

test('rule 9 — the core API answers 200 with its keys, and the scheduled passes run', async ({ request }) => {
  const problems = [];
  for (const entry of coreContract(SEED)) {
    const res = await request.get(entry.path);
    if (res.status() !== 200) { problems.push(`${entry.path} → ${res.status()}`); continue; }
    const body = await res.json();
    if (entry.array && !Array.isArray(body)) problems.push(`${entry.path} → not a list`);
    (entry.keys || []).forEach((key) => { if (!(key in body)) problems.push(`${entry.path} → missing "${key}"`); });
  }
  expect(problems).toEqual([]);
  const passes = await control.passes(request);
  expect(passes.failed, 'a scheduled pass threw').toEqual({});
  expect(passes.ran.length).toBeGreaterThan(0);
});

test('rule 10 — the core pages render without the removed plugins, on desktop and on a phone', async ({ page }) => {
  test.setTimeout(480_000);
  const matchers = removedApiMatchers(GONE);
  const exclusive = Object.entries(PLUGIN_PAGES).filter(([, owners]) => owners.every((id) => GONE.includes(id))).map(([p]) => p);
  const fiches = Object.values(SEED.stays).map((s) => `/reservations/${s.id}`);
  const problems = [];
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    const found = await smoke(page, [...CORE_PAGES, ...fiches], { matchers, hiddenLinks: exclusive });
    problems.push(...found.map((p) => `${viewport.width}px ${p}`));
  }
  expect(problems).toEqual([]);

  const names = Object.fromEntries((await (await page.request.get('/api/plugins')).json()).map((p) => [p.id, p.name]));
  for (const [pagePath, owners] of Object.entries(PLUGIN_PAGES)) {
    if (!owners.every((id) => GONE.includes(id)) || owners.length !== 1) continue;
    await page.goto(pagePath);
    await expect(page.getByText(`Cette page dépend du plugin « ${names[owners[0]]} », qui n’est pas activé.`), pagePath).toBeVisible();
  }
  const own = SHIPPED.map((id) => PLUGIN_SETTINGS_PLACES[id]).filter(Boolean);
  const stillThere = await smoke(page, [...new Set(own)], { matchers });
  expect(stillThere, 'a page of a plugin that stayed no longer renders').toEqual([]);
});

test('rule 12 — the fiches that carried the removed plugins’ data open, save and keep their money to the cent', async ({ request }) => {
  const ref = reference();
  for (const [name, stay] of Object.entries(SEED.stays)) {
    const res = await request.get(`/api/reservations/${stay.id}`);
    expect(res.status(), `${name} fiche`).toBe(200);
    const fiche = await res.json();
    expect(money(fiche), `${name}: money as loaded`).toEqual(ref[name]);
    const saved = await request.put(`/api/reservations/${stay.id}`, { data: fiche });
    expect(saved.status(), `${name} save`).toBe(200);
    const after = await (await request.get(`/api/reservations/${stay.id}`)).json();
    expect(money(after), `${name}: money after a save that changes nothing`).toEqual(ref[name]);
  }
  GONE.forEach((id) => {
    const tables = Object.keys(SEED.rows[id] || {});
    expect(countRows(tables), `${id}: its rows were left untouched`).toEqual(SEED.rows[id]);
  });

  const templates = await (await request.get('/api/email-templates')).json();
  const problems = [];
  const reminder = await (await request.get(`/api/emails/preview?reservationId=${SEED.quote.id}&templateId=${ref.quoteReminder.templateId}`)).json();
  const offers = /pay\.example\.test\/pl_removal_open/.test(`${reminder.subject}\n${reminder.body}`);
  // Rule 6: with the payment plugin the quote's reminder offers its open link; without it, never.
  if (offers !== !GONE.includes('online-payment')) problems.push(`the quote's deposit reminder ${offers ? 'offers' : 'does not offer'} its open payment link`);
  for (const template of templates) {
    for (const stay of [...Object.values(SEED.stays), SEED.quote]) {
      const res = await request.get(`/api/emails/preview?reservationId=${stay.id}&templateId=${template.id}`);
      if (res.status() !== 200) { problems.push(`template ${template.stableKey || template.id} / stay ${stay.id} → ${res.status()}`); continue; }
      const body = await res.json();
      const text = `${body.subject}\n${body.body}`;
      if (/\{\{|\}\}/.test(text)) problems.push(`template ${template.stableKey} keeps a placeholder`);
      if (GONE.includes('online-payment') && /pay\.example\.test/.test(text)) problems.push(`template ${template.stableKey} offers a payment link`);
    }
  }
  expect(problems).toEqual([]);
});
