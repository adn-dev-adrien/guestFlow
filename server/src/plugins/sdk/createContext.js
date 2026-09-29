/**
 * `ctx` — everything a plugin may ask of the core (specs/plugins-phase-1-sdk.md §3.B). `register(ctx)`
 * only DECLARES: nothing it declares runs before the loader mounts, migrates and schedules it, and
 * nothing runs while the plugin is not live.
 */

const registry = require('./registry');
const { EVENTS } = require('./eventBus');
const coreServices = require('./coreServices');

const METHODS = new Set(['get', 'post', 'put', 'patch', 'delete']);

function createContext(id, { db, settingsModel } = {}) {
  const record = registry.ensure(id);
  const prefix = `[plugin:${id}]`;

  const settings = {
    // [{ key, secret?, default? }] — the keys `GET/PUT /api/plugins/:id/settings` accept (rule 7).
    declare(keys) { record.settings.push(...keys); },
    get(key) {
      const decl = record.settings.find((k) => k.key === key);
      const value = settingsModel().get(id, key, { secret: Boolean(decl && decl.secret) });
      return value === '' && decl && decl.default !== undefined ? decl.default : value;
    },
    set(key, value) {
      const decl = record.settings.find((k) => k.key === key);
      if (!decl) throw new Error(`${prefix} undeclared setting "${key}"`);
      settingsModel().set(id, key, value, { secret: Boolean(decl.secret) });
    },
    // The stored value, untouched — a secret's blob. Used as a cache key, never decrypted.
    raw: (key) => settingsModel().raw(id, key),
  };

  return Object.freeze({
    id,
    // A prefix the plugin owns. `public: true` only under /public/ — outside the /api guards.
    mount(path, router, { public: isPublic = false } = {}) {
      if (isPublic && !path.startsWith('/public/')) throw new Error(`${prefix} public mounts must live under /public/`);
      if (!isPublic && !path.startsWith('/api/')) throw new Error(`${prefix} mounts must live under /api/`);
      record.mounts.push({ path, router, public: isPublic });
    },
    // One route under a core prefix, at its full URL (rule 5).
    route(method, path, ...handlers) {
      if (!METHODS.has(method)) throw new Error(`${prefix} unknown method ${method}`);
      if (!path.startsWith('/api/')) throw new Error(`${prefix} routes must live under /api/`);
      record.routes.push({ method, path, handlers });
    },
    // Reception-role allowlist entries, matched like enforceRoleAccess's own ({ method, re } on the
    // path below /api).
    reception(entries) { record.reception.push(...entries); },
    migrations(list) { record.migrations.push(...list); },
    settings,
    jobs: {
      every({ name, intervalMs, bootDelayMs, run }) {
        record.jobs.push({ name, intervalMs, bootDelayMs, run });
      },
    },
    events: {
      on(name, handler) {
        if (!EVENTS.includes(name)) throw new Error(`${prefix} unknown event ${name}`);
        if (!record.handlers.has(name)) record.handlers.set(name, []);
        record.handlers.get(name).push(handler);
      },
    },
    // { tokens: [{ name, label }], flags: [name], build(reservationId) → { tokens, flags } } (rule 10)
    emailContext(provider) { record.emailProviders.push(provider); },
    // (reservationId) → object merged into the SAS payload under pluginData[<id>] (rule 17). Sync:
    // the SAS read never waits on a plugin.
    sasData(provider) { record.sasProviders.push(provider); },
    // Runs after the migrations of an install (rules 18, 26).
    onInstall(fn) { record.onInstall.push(fn); },
    // Runs at every boot, only while the plugin is installed (rule 18).
    onBoot(fn) { record.onBoot.push(fn); },
    // { tables: [name], describe(db) → [{ label, count }], purge?(db) } (rule 12).
    data(declaration) { record.data = declaration; },
    isLive: () => registry.isLive(id),
    core: coreServices,
    db,
    log: {
      info: (...args) => console.log(prefix, ...args), // eslint-disable-line no-console
      warn: (...args) => console.warn(prefix, ...args), // eslint-disable-line no-console
      error: (...args) => console.error(prefix, ...args), // eslint-disable-line no-console
    },
  });
}

module.exports = { createContext };
