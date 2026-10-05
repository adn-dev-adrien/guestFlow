/**
 * `ctx` — everything a plugin may ask of the core (specs/plugins-phase-1-sdk.md §3.B). `register(ctx)`
 * only DECLARES: nothing it declares runs before the loader mounts, migrates and schedules it, and
 * nothing runs while the plugin is not live.
 */

const registry = require('./registry');
const { EVENTS } = require('./eventBus');
const coreServices = require('./coreServices');

const METHODS = new Set(['get', 'post', 'put', 'patch', 'delete']);
const PROVIDER_MEMBERS = ['id', 'label', 'errorCode', 'isReady', 'createLink', 'getPayment', 'getLinkStatus', 'cancelLink'];
const PROCESSOR_MEMBERS = ['id', 'isReady', 'priceSync', 'priceLive'];
const CONTRIBUTOR_MEMBERS = ['id', 'priceTypes', 'priceLine'];
const SAS_COMMIT_MEMBERS = ['step', 'validate', 'complementItems', 'write'];

function createContext(id, { db, settingsModel } = {}) {
  const record = registry.ensure(id);
  const prefix = `[plugin:${id}]`;

  const settings = {
    // [{ key, secret?, default?, validate? }] — the keys `GET/PUT /api/plugins/:id/settings` accept
    // (rule 7); `validate(value)` returns a French message to refuse a write, or null.
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
    // Allowlist entries for a restricted role, matched like enforceRoleAccess's own ({ method, re }
    // on the path below /api) — specs/plugins-phase-2-hosts.md rule 3. `reception(entries)` is its
    // shorthand from phase 1.
    roleAccess(role, entries) {
      if (!Object.prototype.hasOwnProperty.call(record.roleAccess, role)) throw new Error(`${prefix} unknown role ${role}`);
      record.roleAccess[role].push(...entries);
    },
    reception(entries) { record.roleAccess.reception.push(...entries); },
    // A POST under /api/ that no session reaches — a provider calling back. It bypasses the session,
    // role and read-only guards, so the plugin authenticates it itself (specs/plugins-phase-3a-online-payment.md rule 12).
    webhook(path, handler) {
      if (!path.startsWith('/api/')) throw new Error(`${prefix} webhooks must live under /api/`);
      record.webhooks.push({ path, handler });
    },
    // The payment provider the core's money path talks to (rule 4). One per instance.
    paymentProvider(provider) {
      PROVIDER_MEMBERS.forEach((m) => {
        if (provider == null || provider[m] == null) throw new Error(`${prefix} payment provider lacks "${m}"`);
      });
      const other = registry.all().find((r) => r.id !== id && r.paymentProvider);
      if (other) throw new Error(`${prefix} a payment provider is already declared by ${other.id}`);
      record.paymentProvider = provider;
    },
    // The quote post-processor (specs/plugins-phase-3b-neat.md rule 1): its single output is the
    // cancellation insurance unit price, so at most one per instance.
    quotePostProcessor(processor) {
      PROCESSOR_MEMBERS.forEach((m) => {
        if (processor == null || processor[m] == null) throw new Error(`${prefix} quote post-processor lacks "${m}"`);
      });
      const other = registry.all().find((r) => r.id !== id && r.quotePostProcessor);
      if (other) throw new Error(`${prefix} the cancellation insurance price is already declared by ${other.id}`);
      record.quotePostProcessor = processor;
    },
    // The price-line contributor (specs/plugins-phase-3c-hourly-resources.md rule 1): it prices the
    // resource lines of its price types, inside the engine's loop. At most one per price type.
    priceLineContributor(contributor) {
      CONTRIBUTOR_MEMBERS.forEach((m) => {
        if (contributor == null || contributor[m] == null) throw new Error(`${prefix} price-line contributor lacks "${m}"`);
      });
      contributor.priceTypes.forEach((type) => {
        const other = registry.all().find((r) => r.id !== id && r.priceLineContributor
          && r.priceLineContributor.priceTypes.includes(type));
        if (other) throw new Error(`${prefix} the "${type}" lines are already priced by ${other.id}`);
      });
      record.priceLineContributor = contributor;
    },
    // A commit hook for one of the plugin's arrival SAS steps (rule 6).
    sasCommit(hook) {
      SAS_COMMIT_MEMBERS.forEach((m) => {
        if (hook == null || hook[m] == null) throw new Error(`${prefix} SAS commit hook lacks "${m}"`);
      });
      record.sasCommits.push(hook);
    },
    // (reservation) → a block added under `key` to the fiche payload while the plugin is live (rule 12).
    // The key is the plugin's id: the fiche hands each plugin's line component the block of its id.
    reservationBlock(key, build) {
      if (typeof build !== 'function') throw new Error(`${prefix} reservation block "${key}" needs a builder`);
      if (key !== id) throw new Error(`${prefix} a reservation block is keyed by the plugin id ("${id}"), not "${key}"`);
      record.reservationBlocks.push({ key, build });
    },
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
