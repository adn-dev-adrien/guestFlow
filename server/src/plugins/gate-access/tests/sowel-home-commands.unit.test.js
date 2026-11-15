// specs/guest-app-home-automation.md rules 8-10 — light commands: queued for the house, collected by its long poll,
// expired when nobody collects them in 30 s, answered once, the same tap within 2 s counted once.
const test = require('node:test');
const assert = require('node:assert/strict');

const { startHome, freshHome } = require('./homeFixtures');

const COMMAND = { stayId: 7, propertyId: 1, equipmentId: 'l-chene', lightId: 'light-1', value: 'on' };
// date-literal-ok: an injected clock — the model reads no « today »
const at = (s) => new Date(Date.UTC(2026, 10, 15, 20, 0, s));

test('rule 8 — a queued command is collected once by the house', () => {
  const { model } = freshHome();
  const queued = model.queueCommand(COMMAND, at(0));
  assert.equal(queued.state, 'pending');
  const first = model.collect(at(1));
  assert.deepEqual(first.map((c) => c.id), [queued.id]);
  assert.deepEqual(model.collect(at(2)), []);
  assert.equal(model.command(queued.id, at(2)).state, 'collected');
});

test('rule 8 — a command not collected within 30 s expires and is never handed out later', () => {
  const { model } = freshHome();
  const queued = model.queueCommand(COMMAND, at(0));
  assert.equal(model.command(queued.id, at(31)).state, 'expired');
  assert.deepEqual(model.collect(at(32)), []);
});

test('rule 8 — a collected command without a result within 60 s expires; a late result is ignored', () => {
  const { model } = freshHome();
  const queued = model.queueCommand(COMMAND, at(0));
  model.collect(at(1));
  assert.equal(model.command(queued.id, at(62)).state, 'expired');
  assert.deepEqual(model.storeResults([{ id: queued.id, ok: true }], at(63)), { stored: 0 });
  assert.equal(model.command(queued.id, at(63)).state, 'expired');
});

test('rule 9 — the house’s verdict: done, or refused with its reason', () => {
  const { model } = freshHome();
  const a = model.queueCommand(COMMAND, at(0));
  const b = model.queueCommand({ ...COMMAND, lightId: 'light-2', equipmentId: 'l-salon' }, at(0));
  model.collect(at(1));
  model.storeResults([{ id: a.id, ok: true }, { id: b.id, ok: false, reason: 'not_entrusted' }], at(2));
  assert.equal(model.command(a.id, at(3)).state, 'done');
  assert.deepEqual([model.command(b.id, at(3)).state, model.command(b.id, at(3)).reason], ['refused', 'not_entrusted']);
});

test('rule 10 — the same tap within 2 s is one command; after 2 s, or the other way, a new one', () => {
  const { model } = freshHome();
  const first = model.queueCommand(COMMAND, at(0));
  assert.equal(model.queueCommand(COMMAND, at(1)).id, first.id);
  assert.notEqual(model.queueCommand(COMMAND, at(3)).id, first.id);
  assert.notEqual(model.queueCommand({ ...COMMAND, value: 'off' }, at(3)).id, first.id);
});

test('commands are purged after 7 days', () => {
  const { model, db } = freshHome();
  // date-literal-ok: an injected clock — the model reads no « today »
  model.queueCommand(COMMAND, new Date('2026-11-01T10:00:00Z'));
  // date-literal-ok: an injected clock — the model reads no « today »
  model.queueCommand(COMMAND, new Date('2026-11-14T10:00:00Z'));
  // date-literal-ok: an injected clock — the model reads no « today »
  assert.equal(model.purge(new Date('2026-11-15T10:00:00Z')), 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM home_commands').get().n, 1);
});

test('rule 8 — the long poll answers at once when a guest taps, signed, with the command only', async (t) => {
  const home = await startHome();
  t.after(home.close);
  const provider = home.controller.provider();
  const poll = home.call('GET', '/public/v1/home/commands?wait=5');
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(home.controller.waiting(), 1);
  const queued = provider.queueCommand(COMMAND);
  const res = await poll;
  assert.equal(res.status, 200);
  assert.equal(res.signatureOk, true);
  assert.deepEqual(res.body.commands.map((c) => Object.keys(c).sort()), [['equipmentId', 'id', 'issuedAt', 'propertyId', 'value']]);
  assert.equal(res.body.commands[0].id, queued.id);
  assert.equal(home.controller.waiting(), 0);

  const answered = await home.call('POST', '/public/v1/home/commands/results', { results: [{ id: queued.id, ok: true }] });
  assert.deepEqual(answered.body, { stored: 1 });
  assert.equal(provider.command(queued.id).state, 'done');
});

test('rule 8 — an empty long poll ends after `wait` seconds with no command', async (t) => {
  const home = await startHome();
  t.after(home.close);
  const started = Date.now();
  const res = await home.call('GET', '/public/v1/home/commands?wait=1');
  assert.deepEqual(res.body, { commands: [] });
  assert.ok(Date.now() - started >= 900);
});

test('a malformed result refuses the whole call', async (t) => {
  const home = await startHome();
  t.after(home.close);
  const res = await home.call('POST', '/public/v1/home/commands/results', { results: [{ id: 'x', ok: true }] });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.details.field, 'results.0.id');
});
