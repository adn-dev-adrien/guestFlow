// specs/guest-app-home-automation.md rules 7, 10, 12-17, 22, 27, 29 — the « Domotique » routes on the real routers: the
// module's prerequisite and modes, the guest's taps, Studio's save with its refusals and its preview.
const test = require('node:test');
const assert = require('node:assert/strict');

const { freshDb, addStay, startApi, enable, openStay } = require('./guestAppFixtures');
const { GRANJA_BLOCKS, readingsAt, fakeHome } = require('./homeFixtures');
const { readModules } = require('../modules');

const homeOn = (db) => {
  const lodgings = require('../models/lodgingsModel')(db);
  const modules = readModules(null).map((m) => (m.key === 'home' ? { ...m, on: true } : m));
  lodgings.save(1, { enabled: true, modules });
};

async function setup(t, { house = {}, limiters } = {}) {
  const db = freshDb();
  const home = fakeHome(house);
  const ctx = await startApi(db, { homeData: () => home, ...(limiters ? { limiters } : {}) });
  t.after(ctx.close);
  enable(ctx.api, db, 1);
  homeOn(db);
  const now = ctx.clock.now;
  home.state.readings = readingsAt(now);
  home.state.lastPollAt = new Date(now.getTime() - 60 * 1000).toISOString();
  return { db, home, ...ctx };
}

const save = (call, blocks = GRANJA_BLOCKS) => call('PUT', '/api/guest-app/lodgings/1/home', { blocks });
const tileKeys = (me) => me.body.data.tiles.map((t) => t.key);

test('rule 17 — off by default: no tile, and the page answers MODULE_OFF', async (t) => {
  const db = freshDb();
  const home = fakeHome();
  const ctx = await startApi(db, { homeData: () => home });
  t.after(ctx.close);
  enable(ctx.api, db, 1);
  await openStay(ctx.call, db, addStay(db));
  assert.ok(!tileKeys(await ctx.call('GET', '/public/v1/guest/me')).includes('home'));
  const page = await ctx.call('GET', '/public/v1/guest/home');
  assert.equal(page.status, 404);
  assert.equal(page.body.error.code, 'MODULE_OFF');
});

test('rule 17 — on, configured, the house heard: the tile shows and the page is ready to render', async (t) => {
  const ctx = await setup(t);
  assert.equal((await save(ctx.call)).status, 200);
  await openStay(ctx.call, ctx.db, addStay(ctx.db));
  assert.ok(tileKeys(await ctx.call('GET', '/public/v1/guest/me')).includes('home'));
  const page = await ctx.call('GET', '/public/v1/guest/home');
  assert.equal(page.status, 200);
  assert.deepEqual(page.body.data.blocks.map((b) => b.kind), ['outdoor', 'rooms', 'lights', 'rain', 'energy', 'grid']);
  assert.equal(page.body.data.blocks[0].temperature, '8,5');
});

test('rule 29 — a lodging saved before « Réseau » existed reads back with it, switched off', async (t) => {
  const ctx = await setup(t);
  assert.equal((await save(ctx.call)).status, 200);
  ctx.db.prepare("DELETE FROM guest_home_blocks WHERE kind = 'grid'").run();
  const read = await ctx.call('GET', '/api/guest-app/lodgings/1/home');
  const grid = read.body.blocks.find((b) => b.kind === 'grid');
  assert.deepEqual([grid.on, grid.equipmentId], [false, null]);
  assert.equal(read.body.blocks.length, 6);
});

test('rule 17 — the house silent for more than 6 h: the tile goes', async (t) => {
  const ctx = await setup(t);
  await save(ctx.call);
  ctx.home.state.lastPollAt = new Date(ctx.clock.now.getTime() - 7 * 60 * 60 * 1000).toISOString();
  await openStay(ctx.call, ctx.db, addStay(ctx.db));
  assert.ok(!tileKeys(await ctx.call('GET', '/public/v1/guest/me')).includes('home'));
});

test('rule 17 — before the arrival there is no page', async (t) => {
  const ctx = await setup(t);
  await save(ctx.call);
  await openStay(ctx.call, ctx.db, addStay(ctx.db, { startDate: '2099-07-10', endDate: '2099-07-12' }));
  const me = await ctx.call('GET', '/public/v1/guest/me');
  assert.equal(me.body.data.mode, 'preArrival');
  assert.ok(!tileKeys(me).includes('home'));
  assert.equal((await ctx.call('GET', '/public/v1/guest/home')).status, 404);
});

test('rules 7-8, 22 — a tap on an entrusted light is queued for the house and readable by its own stay only', async (t) => {
  const ctx = await setup(t);
  const saved = await save(ctx.call);
  const chene = saved.body.blocks.find((b) => b.kind === 'lights').items[0];
  await openStay(ctx.call, ctx.db, addStay(ctx.db));
  const tap = await ctx.call('POST', `/public/v1/guest/home/lights/${chene.id}`, { on: true });
  assert.equal(tap.status, 202);
  assert.deepEqual([tap.body.data.state, tap.body.data.on], ['pending', true]);
  const [queued] = ctx.home.state.commands;
  assert.deepEqual([queued.equipmentId, queued.value, queued.propertyId], ['l-chene', 'on', 1]);

  queued.state = 'refused';
  queued.reason = 'not_occupied';
  const status = await ctx.call('GET', `/public/v1/guest/home/commands/${queued.id}`);
  assert.deepEqual([status.body.data.state, status.body.data.message], ['refused', 'Possible uniquement pendant le séjour.']);

  queued.stayId = 999;
  assert.equal((await ctx.call('GET', `/public/v1/guest/home/commands/${queued.id}`)).status, 404);
});

test('rule 7 — a light not pilotable, or unknown, is refused 403', async (t) => {
  const ctx = await setup(t);
  const saved = await save(ctx.call);
  const salon = saved.body.blocks.find((b) => b.kind === 'lights').items[1];
  await openStay(ctx.call, ctx.db, addStay(ctx.db));
  const refused = await ctx.call('POST', `/public/v1/guest/home/lights/${salon.id}`, { on: true });
  assert.equal(refused.status, 403);
  assert.equal(refused.body.error.code, 'NOT_PILOTABLE');
  assert.equal((await ctx.call('POST', '/public/v1/guest/home/lights/nope', { on: true })).status, 403);
  assert.equal(ctx.home.state.commands.length, 0);
});

test('rule 7 — a light no longer entrusted in Sowel is refused even if Studio had it pilotable', async (t) => {
  const ctx = await setup(t);
  const saved = await save(ctx.call);
  const chene = saved.body.blocks.find((b) => b.kind === 'lights').items[0];
  ctx.home.state.catalog.find((e) => e.id === 'l-chene').guestSwitchable = false;
  await openStay(ctx.call, ctx.db, addStay(ctx.db));
  assert.equal((await ctx.call('POST', `/public/v1/guest/home/lights/${chene.id}`, { on: true })).status, 403);
});

test('rule 10 — the 7th tap within 10 minutes is refused, in words', async (t) => {
  const { createGuestLimiters } = require('../rateLimiters');
  const ctx = await setup(t, { limiters: { homeCommand: createGuestLimiters().homeCommand } });
  const saved = await save(ctx.call);
  const chene = saved.body.blocks.find((b) => b.kind === 'lights').items[0];
  await openStay(ctx.call, ctx.db, addStay(ctx.db));
  for (let i = 0; i < 6; i += 1) {
    assert.equal((await ctx.call('POST', `/public/v1/guest/home/lights/${chene.id}`, { on: i % 2 === 0 })).status, 202);
  }
  const seventh = await ctx.call('POST', `/public/v1/guest/home/lights/${chene.id}`, { on: true });
  assert.equal(seventh.status, 429);
  assert.equal(seventh.body.error.message, 'Trop de demandes. Réessayer dans quelques minutes.');
});

test('rule 14 — Studio’s save: 422 with every field in error, nothing stored', async (t) => {
  const ctx = await setup(t);
  const bad = GRANJA_BLOCKS.map((b) => (b.kind === 'rooms' ? { ...b, items: [{ label: '', equipmentId: 't-sejour' }] } : b));
  const res = await save(ctx.call, bad);
  assert.equal(res.status, 422);
  assert.equal(res.body.errors['blocks.1.items.0.label'], 'Nom requis.');
  const read = await ctx.call('GET', '/api/guest-app/lodgings/1/home');
  assert.ok(read.body.blocks.every((b) => !b.on));
});

test('rules 13, 15 — Studio reads the channel, the blocks and the pickers; the preview is the guest’s page', async (t) => {
  const ctx = await setup(t);
  await save(ctx.call);
  const read = await ctx.call('GET', '/api/guest-app/lodgings/1/home');
  assert.equal(read.body.channel.state, 'ok');
  assert.equal(read.body.channel.message, 'Reçu de Sowel il y a 1 min.');
  assert.deepEqual(read.body.pickers.energy.map((p) => p.id), ['m-granja', 'edf']);
  assert.deepEqual(read.body.pickers.grid.map((p) => p.id), ['edf']);
  assert.deepEqual(read.body.pickers.lights.map((p) => [p.id, Boolean(p.guestSwitchable)]), [['l-chene', true], ['l-salon', false]]);
  const preview = await ctx.call('POST', '/api/guest-app/lodgings/1/home/preview', {});
  assert.equal(preview.body.blocks[0].temperature, '8,5');
  // Rule 16 — the draft, not the saved blocks: the outdoor block switched off disappears from the preview.
  const draft = GRANJA_BLOCKS.map((b) => (b.kind === 'outdoor' ? { ...b, on: false } : b));
  const drafted = await ctx.call('POST', '/api/guest-app/lodgings/1/home/preview', { blocks: draft });
  assert.equal(drafted.body.blocks[0].kind, 'rooms');
  const refused = await ctx.call('POST', '/api/guest-app/lodgings/1/home/preview', { blocks: draft.slice(1) });
  assert.equal(refused.status, 422);
});

test('rule 15 — without a connector Studio says so, and the guest never sees the tile', async (t) => {
  const db = freshDb();
  const ctx = await startApi(db, { homeData: () => null });
  t.after(ctx.close);
  enable(ctx.api, db, 1);
  homeOn(db);
  const read = await ctx.call('GET', '/api/guest-app/lodgings/1/home');
  assert.equal(read.body.channel.state, 'off');
  await openStay(ctx.call, db, addStay(db));
  assert.ok(!tileKeys(await ctx.call('GET', '/public/v1/guest/me')).includes('home'));
});
