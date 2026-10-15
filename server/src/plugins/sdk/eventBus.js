/**
 * Core → plugin calls (specs/plugins-phase-1-sdk.md rules 9, 10, 17).
 *
 * `emit` replaces the direct calls the core used to make after a reservation write. It returns at
 * once; handlers run on the next turn of the event loop, only for live plugins, each isolated — a
 * throwing handler is logged and never reaches the write that emitted the event.
 *
 * `emailContext` and `sasData` merge the contributions of live plugins. An inactive plugin's email
 * variables render empty and its flags read false, so a stored template never leaks its data.
 */

const registry = require('./registry');

const EVENTS = Object.freeze([
  'reservation.created',
  'reservation.updated',
  'reservation.paid',
  'reservation.cancelled',
  'reservation.deleted',
  'ical.imported',
]);

function logFailure(pluginId, what, err) {
  // eslint-disable-next-line no-console
  console.error(`[plugin:${pluginId}] ${what} failed:`, err && err.message ? err.message : err);
}

function dispatch(name, payload) {
  const runs = [];
  registry.all().forEach((record) => {
    const handlers = record.handlers.get(name);
    if (!handlers || !registry.isLive(record.id)) return;
    handlers.forEach((handler) => {
      runs.push(Promise.resolve()
        .then(() => handler(payload))
        .catch((err) => logFailure(record.id, name, err)));
    });
  });
  return Promise.all(runs);
}

function emit(name, payload = {}) {
  if (!EVENTS.includes(name)) throw new Error(`Unknown plugin event: ${name}`);
  setImmediate(() => { dispatch(name, payload); });
}

// The variables and conditions the live plugins add to the template editor (rule 13).
function editorTokens() {
  const variables = [];
  const conditions = [];
  registry.all().filter((record) => registry.isLive(record.id)).forEach((record) => {
    record.emailProviders.forEach((provider) => {
      provider.tokens.forEach((t) => variables.push({ label: t.label, token: `{{${t.name}}}` }));
      (provider.flags || []).forEach((f) => conditions.push({ label: f.label, token: `{{#if ${f.name}}}` }));
    });
  });
  return { variables, conditions };
}

function emailContext(reservationId) {
  const tokens = {};
  const flags = {};
  registry.all().forEach((record) => {
    record.emailProviders.forEach((provider) => {
      provider.tokens.forEach((t) => { tokens[t.name] = ''; });
      (provider.flags || []).forEach((f) => { flags[f.name] = false; });
      if (!registry.isLive(record.id)) return;
      try {
        const built = provider.build(reservationId) || {};
        Object.assign(tokens, built.tokens || {});
        Object.assign(flags, built.flags || {});
      } catch (err) {
        logFailure(record.id, 'email context', err);
      }
    });
  });
  return { tokens, flags };
}

// Synchronous on purpose: the SAS read never waits on a plugin (a QR, a network call) — a provider
// answers from what is already stored.
function sasData(reservationId) {
  const out = {};
  registry.all().forEach((record) => {
    if (!record.sasProviders.length || !registry.isLive(record.id)) return;
    record.sasProviders.forEach((provider) => {
      try {
        out[record.id] = { ...(out[record.id] || {}), ...(provider(reservationId) || {}) };
      } catch (err) {
        logFailure(record.id, 'SAS data', err);
      }
    });
  });
  return out;
}

module.exports = { EVENTS, emit, dispatch, emailContext, editorTokens, sasData };
