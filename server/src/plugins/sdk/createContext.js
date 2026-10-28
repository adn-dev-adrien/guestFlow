/**
 * `ctx` — everything a plugin may ask of the core (specs/plugins-phase-1-sdk.md §3.B). `register(ctx)`
 * only DECLARES: nothing it declares runs before the loader mounts, migrates and schedules it, and
 * nothing runs while the plugin is not live.
 */

const registry = require('./registry');
const eventBus = require('./eventBus');

const { EVENTS, PLUGIN_EMITTABLE } = eventBus;
const coreServices = require('./coreServices');

const METHODS = new Set(['get', 'post', 'put', 'patch', 'delete']);
const PROVIDER_MEMBERS = ['id', 'label', 'errorCode', 'isReady', 'createLink', 'getPayment', 'getLinkStatus', 'cancelLink'];
const PROCESSOR_MEMBERS = ['id', 'isReady', 'priceSync', 'priceLive'];
const CONTRIBUTOR_MEMBERS = ['id', 'priceTypes', 'priceLine'];
const SAS_COMMIT_MEMBERS = ['step', 'validate', 'complementItems', 'write'];
const PUSH_CHANNEL_KEY = /^[a-z][a-z0-9-]{0,39}$/;

function createContext(id, { db, settingsModel, dataDir = null } = {}) {
  const record = registry.ensure(id);
  const prefix = `[plugin:${id}]`;

  const settings = {
    // [{ key, secret?, default?, validate?, afterSave? }] — the keys `GET/PUT /api/plugins/:id/settings`
    // accept (rule 7); `validate(value)` returns a French message to refuse a write, or null;
    // `afterSave(value)` runs once the value is stored (specs/plugins-phase-p-productisation.md rule 16).
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
    // Routes that hand out, create or rotate a secret ({ method: 'GET' | … | '*', re } on the lower-case
    // path below /api, like roleAccess). A support session is refused them
    // (specs/hosting-h2-account-security.md rule 23).
    secretRoutes(entries) {
      (entries || []).forEach((e) => {
        if (!e || !(e.re instanceof RegExp) || typeof e.method !== 'string') throw new Error(`${prefix} a secret route needs { method, re }`);
      });
      record.secretRoutes.push(...entries);
    },
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
    // (resource, { properties }) → { lines?: [{ label, value }], footer?: string } | null — what the plugin
    // adds to a resource's card on Options & ressources while it is live (specs/options-resources-ux.md
    // rule 19). Synchronous, no I/O; a plugin declares one.
    resourceCatalogueLines(build) {
      if (typeof build !== 'function') throw new Error(`${prefix} resourceCatalogueLines needs a function`);
      if (record.resourceCatalogueLines) throw new Error(`${prefix} resourceCatalogueLines is already declared`);
      record.resourceCatalogueLines = build;
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
    // A subject of the home's « À traiter » (specs/shell-and-home-day-first.md rule 9): `handler` is the
    // plugin's own handler of the card's list, `summarize(payload)` → { count, title, detail, severity }
    // or null. The key is the one of its client contribution to `dashboard.alerts(.urgent)`.
    attention({ key, rank, handler, summarize } = {}) {
      if (!key || typeof key !== 'string') throw new Error(`${prefix} an attention subject needs a key`);
      if (typeof handler !== 'function' || typeof summarize !== 'function') {
        throw new Error(`${prefix} attention subject "${key}" needs a handler and a summarize function`);
      }
      const other = registry.all().find((r) => (r.attention || []).some((s) => s.key === key));
      if (other) throw new Error(`${prefix} the attention subject "${key}" is already declared by ${other.id}`);
      record.attention.push({ key, rank, handler, summarize });
    },
    // () → null when the plugin has what it needs, else a short French label of what it lacks
    // (« à connecter », « identifiants manquants »). The Plugins page prints « Actif · <label> » and
    // offers « Configurer » (specs/plugins-phase-0-foundation.md rule 25). Read on every list: keep it
    // a cheap, synchronous look at the plugin's own settings — never a call to a remote service.
    setupStatus(check) {
      if (typeof check !== 'function') throw new Error(`${prefix} setupStatus needs a function`);
      record.setupStatus = check;
    },
    // A push notification toggle of « Notifications push » (specs/platform-settings-relay-and-review.md
    // rule 8, SDK 2.6.0): offered while the plugin is live, sent with `pushService.sendToPref(key, …)`.
    // `label` is French, as the toggle reads.
    pushChannel({ key, label } = {}) {
      if (!PUSH_CHANNEL_KEY.test(String(key || ''))) throw new Error(`${prefix} a push channel needs a key like "my-channel"`);
      if (!label || typeof label !== 'string') throw new Error(`${prefix} push channel "${key}" needs a label`);
      const { CORE_PUSH_CHANNELS } = require('../../utils/pushChannels');
      const taken = CORE_PUSH_CHANNELS.some((c) => c.key === key)
        || registry.all().some((r) => (r.pushChannels || []).some((c) => c.key === key));
      if (taken) throw new Error(`${prefix} the push channel "${key}" is already declared`);
      record.pushChannels.push({ key, label });
    },
    // (rows) → rows: decorates the rows of the home's « Échéances » card while the plugin is live — a row may
    // gain a `bank` line or be dropped (specs/reconciliation-assisted-matching.md rule 22). At most one per plugin.
    paymentDeadlineDecorator(decorate) {
      if (typeof decorate !== 'function') throw new Error(`${prefix} the payment-deadline decorator must be a function`);
      if (record.paymentDeadlineDecorator) throw new Error(`${prefix} the payment-deadline decorator is already declared`);
      record.paymentDeadlineDecorator = decorate;
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
      // SDK 2.4.0 — only the events of PLUGIN_EMITTABLE; dispatched like the core's own emits.
      emit(name, payload) {
        if (!PLUGIN_EMITTABLE.includes(name)) throw new Error(`${prefix} may not emit ${name}`);
        eventBus.emit(name, payload);
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
    // SDK 2.11.0 — runs each time the plugin goes from off to live: activated, or installed (after its
    // install hooks). Events sent while it was off were dropped, so it recovers from its own data here
    // (specs/plugin-removal-resilience.md rule 17). Not awaited by the request that switched it on.
    onActivate(fn) { record.onActivate.push(fn); },
    // { tables: [name], describe(db) → [{ label, count }], purge?(db) } (rule 12).
    data(declaration) { record.data = declaration; },
    isLive: () => registry.isLive(id),
    // specs/plugins-phase-4-registry.md rule 15 — the plugin's own directory, kept across updates,
    // removed only by « Effacer aussi ses données ». Created on first read.
    get dataDir() {
      if (!dataDir) return null;
      const dir = dataDir();
      require('fs').mkdirSync(dir, { recursive: true });
      return dir;
    },
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
