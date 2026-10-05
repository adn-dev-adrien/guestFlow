// The SAS commit contract of plugin steps (specs/plugins-phase-3c-hourly-resources.md rules 6–8).

const test = require('node:test');
const assert = require('node:assert/strict');

const registry = require('../plugins/sdk/registry');
const { createContext } = require('../plugins/sdk/createContext');
const sasCommitHooks = require('../utils/sasCommitHooks');
const { seed } = require('../plugins/hourly-resources/tests/hourlySchedulingFixture');

// A plugin `demo` whose step `demoStep` bills one line and writes a note, recording every call.
function declare({ live = true, validate = () => ({ ok: true }), write } = {}) {
  const calls = [];
  registry.reset();
  registry.configure({ isActive: () => live, allows: () => true });
  createContext('demo', {}).sasCommit({
    step: 'demoStep',
    validate: (reservation, payload) => { calls.push(['validate', payload]); return validate(payload); },
    complementItems: (reservation, payload) => { calls.push(['items', payload]); return [{ key: 'fee', label: 'Frais démo', amount: 12 }]; },
    write: write || ((db, reservation, payload) => {
      calls.push(['write', payload]);
      db.prepare("UPDATE reservations SET departureHandoverNote = 'écrit' WHERE id = ?").run(reservation.id);
    }),
  });
  return calls;
}

test.afterEach(() => registry.reset());

const customRows = (ctx) => ctx.db.prepare('SELECT description, amount, sasArrivalOrigin, sasLineKey FROM reservation_custom_options WHERE reservationId = 500').all();

test('rule 6: a refusal aborts before anything is written, with its status and body', () => {
  const ctx = seed();
  declare({ validate: () => ({ ok: false, status: 409, body: { error: 'SLOT_CONFLICT' } }) });
  const out = sasCommitHooks.prepare({ reservation: ctx.reservation, pluginSteps: { demoStep: {} }, db: ctx.db });
  assert.deepEqual(out.refusal, { status: 409, body: { error: 'SLOT_CONFLICT' } });
});

test('rule 6: the step that did not run is not validated nor written, but its lines are recomputed', () => {
  const ctx = seed();
  const calls = declare();
  const out = sasCommitHooks.prepare({ reservation: ctx.reservation, pluginSteps: {}, db: ctx.db });
  assert.deepEqual(calls, [['items', undefined]]);
  assert.deepEqual(out.writes, []);
  assert.deepEqual(out.items, [{ label: 'Frais démo', amount: 12, sasLineKey: 'demo:fee' }]);
});

test('rules 6–7: the line is stored tagged and the write runs inside the commit', () => {
  const ctx = seed();
  declare();
  const out = sasCommitHooks.prepare({ reservation: ctx.reservation, pluginSteps: { demoStep: { any: 1 } }, db: ctx.db });
  const complement = ctx.reservations.commitArrivalSas(500, { complementItems: out.items, pluginWrites: out.writes });
  assert.equal(complement, 12);
  assert.deepEqual(customRows(ctx), [{ description: 'Frais démo', amount: 12, sasArrivalOrigin: 1, sasLineKey: 'demo:fee' }]);
  assert.equal(ctx.db.prepare('SELECT departureHandoverNote AS n FROM reservations WHERE id = 500').get().n, 'écrit');
});

test('rule 6: a throwing write rolls the whole commit back', () => {
  const ctx = seed();
  declare({ write: () => { throw new Error('boom'); } });
  const out = sasCommitHooks.prepare({ reservation: ctx.reservation, pluginSteps: { demoStep: {} }, db: ctx.db });
  assert.throws(() => ctx.reservations.commitArrivalSas(500, { complementItems: out.items, pluginWrites: out.writes }), /boom/);
  assert.equal(ctx.db.prepare('SELECT arrivalSasDoneAt FROM reservations WHERE id = 500').get().arrivalSasDoneAt, null);
  assert.deepEqual(customRows(ctx), []);
});

test('rule 7: the labels of the plugin lines, stored or computed, are the ones a dialog copy is dropped by', () => {
  const ctx = seed();
  ctx.db.prepare(`INSERT INTO reservation_custom_options (reservationId, description, amount, inComplement, sasArrivalOrigin, sasLineKey)
    VALUES (500, 'Ancienne ligne', 5, 1, 1, 'demo:old')`).run();
  declare();
  const out = sasCommitHooks.prepare({ reservation: ctx.reservation, db: ctx.db });
  assert.deepEqual([...out.labels].sort(), ['Ancienne ligne', 'Frais démo']);
});

test('rule 8 (P10): with the plugin off, nothing is called and what it billed is kept as stored', () => {
  const ctx = seed();
  ctx.db.prepare(`INSERT INTO reservation_custom_options (reservationId, description, amount, offered, inComplement, sasArrivalOrigin, sasLineKey)
    VALUES (500, 'Frais démo', 12, 0, 1, 1, 'demo:fee')`).run();
  ctx.db.prepare('UPDATE reservations SET complementAmount = 12 WHERE id = 500').run();
  const calls = declare({ live: false });
  const out = sasCommitHooks.prepare({ reservation: ctx.reservation, pluginSteps: { demoStep: {} }, db: ctx.db });
  assert.deepEqual(calls, []);
  assert.deepEqual(out.items, [{ label: 'Frais démo', amount: 12, offered: false, sasLineKey: 'demo:fee' }]);
  const complement = ctx.reservations.commitArrivalSas(500, { complementItems: out.items, pluginWrites: out.writes });
  assert.equal(complement, 12, 'a re-committed SAS keeps the money');
  assert.deepEqual(customRows(ctx), [{ description: 'Frais démo', amount: 12, sasArrivalOrigin: 1, sasLineKey: 'demo:fee' }]);
});
