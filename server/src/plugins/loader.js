/**
 * Boots the plugin modules (specs/plugins-phase-1-sdk.md §3.A–B).
 *
 *   registerAll({ db })  every module's `register(ctx)`; a throw marks it failed (rule 4) and the
 *                        boot goes on. Then, for every installed module, its migrations and its
 *                        boot hooks.
 *   migrate(db, id)      one module's migrations — install time (rule 6).
 *   mountPublic(app)     `/public/...` mounts, outside the /api guards, in module-list order — the
 *                        whole /public/v1 tree since specs/plugins-phase-2-hosts.md rule 23.
 *   mountApi(app)        `/api/...` mounts and single routes, after the core routers.
 *   startJobs()          the declared jobs, each tick skipped while the plugin is not live.
 *   isWebhook(m, path)   whether the guards must let a plugin's webhook through (phase 3a rule 12).
 *   roleMatchers(role)   the allowlist entries plugins declared for a restricted role
 *                        (specs/plugins-phase-2-hosts.md rule 3); receptionMatchers() is its phase 1 form.
 *
 * specs/plugins-phase-4-registry.md adds the package path (rules 13–14, 17, P27):
 *   installResolver()    `guestflow/sdk` → the core SDK, and the npm packages of a plugin package →
 *                        the core's own node_modules (a package ships none, rule 1).
 *   loadPackages(...)    the modules of the installed rows, each from its package directory; a package
 *                        whose ranges or requirements no longer match stays installed, unloaded (rule 14).
 *   registerLive(mod)    an install takes effect without a restart: register, migrate, mount, schedule.
 * The mounts go through two routers placed once at boot, so a module registered later still lands
 * at the place of the plugin routes — before the core's 404 and the SPA.
 */

const fs = require('fs');
const path = require('path');
const Module = require('module');
const express = require('express');
const registry = require('./sdk/registry');
const { createContext } = require('./sdk/createContext');
const { runPluginMigrations } = require('./sdk/pluginMigrations');
const requirePlugin = require('../middleware/requirePlugin');
const { whenPluginActive } = require('../utils/pluginScheduling');

const defaultSettingsModel = () => require('../models/pluginSettingsModel');
const defaultIsInstalled = (id) => Boolean(require('../models/pluginsModel').get(id));
// Rule 15 — `<data>/plugin-data/<id>/`, created when the plugin first asks for it.
const defaultDataDir = (id) => path.join(require('../utils/deploymentPaths').resolvePaths().dataDir, 'plugin-data', id);

const SERVER_DIR = path.resolve(__dirname, '..', '..');
const SDK_DIR = path.join(__dirname, 'sdk');
const SDK_REQUEST = 'guestflow/sdk';
const packageRoots = new Set();
let resolverInstalled = false;

const realOrSelf = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
const inPackageRoot = (file) => [...packageRoots].some((root) => file === root || file.startsWith(`${root}${path.sep}`));

/**
 * Rules 4 and 17: a package's server code requires the core through `guestflow/sdk` only, and its
 * npm packages are the core's (express, googleapis…). `roots` are the directories packages run from.
 */
function installResolver({ roots = [] } = {}) {
  roots.forEach((r) => packageRoots.add(realOrSelf(r)));
  if (resolverInstalled) return;
  resolverInstalled = true;
  const original = Module._resolveFilename;
  Module._resolveFilename = function resolveForPackages(request, parent, isMain, options) {
    if (request === SDK_REQUEST || request.startsWith(`${SDK_REQUEST}/`)) {
      const sub = request.slice(SDK_REQUEST.length).replace(/^\//, '');
      return original.call(this, path.join(SDK_DIR, sub || 'index.js'), parent, isMain, options);
    }
    const bare = !request.startsWith('.') && !path.isAbsolute(request) && !Module.isBuiltin(request);
    if (bare && parent && parent.filename && inPackageRoot(parent.filename)) {
      return original.call(this, require.resolve(request, { paths: [SERVER_DIR] }), parent, isMain, options);
    }
    return original.call(this, request, parent, isMain, options);
  };
}

let dataDirOf = defaultDataDir;

function registerOne(mod, { db, settingsModel }) {
  try {
    mod.register(createContext(mod.id, { db, settingsModel, dataDir: () => dataDirOf(mod.id) }));
    return true;
  } catch (err) {
    registry.markFailed(mod.id, err);
    // eslint-disable-next-line no-console
    console.error(`[plugin:${mod.id}] register failed — the plugin stays off:`, err && err.message ? err.message : err);
    return false;
  }
}

function registerAll({ db, modules = require('./index'), settingsModel = defaultSettingsModel, isInstalled = defaultIsInstalled, dataDir } = {}) {
  if (dataDir) dataDirOf = dataDir;
  modules.forEach((mod) => registerOne(mod, { db, settingsModel }));
  registry.all().forEach((record) => {
    if (record.failed || !isInstalled(record.id)) return;
    try {
      runPluginMigrations(db, record.id, record.migrations);
      record.onBoot.forEach((hook) => hook());
    } catch (err) {
      registry.markFailed(record.id, err);
      // eslint-disable-next-line no-console
      console.error(`[plugin:${record.id}] migration failed — the plugin stays off:`, err && err.message ? err.message : err);
    }
  });
}

function migrate(db, id) {
  const record = registry.get(id);
  if (!record || record.failed) return 0;
  return runPluginMigrations(db, id, record.migrations);
}

async function runInstallHooks(id) {
  const record = registry.get(id);
  if (!record) return;
  for (const hook of record.onInstall) {
    try {
      await hook();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[plugin:${id}] install hook failed:`, err && err.message ? err.message : err);
    }
  }
}

// SDK 2.11.0 — the activation hooks run in the background: a failure is logged, never the request's.
// Activation hooks run once per off → on transition. `announced`: live and already announced since it last
// went off; `installing`: an install is between its row and its commit (the controller announces then).
const wasLive = new Map();
const announced = new Set();
const installing = new Set();

function runActivateHooks(id) {
  const record = registry.get(id);
  if (!record || record.failed || announced.has(id) || !registry.isLive(id)) return Promise.resolve();
  announced.add(id);
  wasLive.set(id, true);
  return Promise.all(record.onActivate.map(async (hook) => {
    try {
      await hook();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[plugin:${id}] activation hook failed:`, err && err.message ? err.message : err);
    }
  }));
}

/** Deactivated or uninstalled: the next activation is a new transition. */
function markInactive(id) {
  announced.delete(id);
  wasLive.set(id, false);
}

/** An install is under way for `id` until `endInstall`: the live-set watcher leaves it to the install. */
function beginInstall(id) { installing.add(id); }
function endInstall(id) { installing.delete(id); }

/**
 * A plugin can also turn live without anyone activating it: the licence starts allowing it (a plan
 * upgrade, the row already enabled). The first call records the live set (the boot, which fires nothing);
 * each later call fires the activation hooks of the plugins that were not live and now are — once per
 * transition: an explicit activation or an install in progress has the plugin announced already.
 */
function syncLiveTransitions() {
  const fired = [];
  registry.all().forEach((record) => {
    const id = record.id;
    if (installing.has(id)) return;
    const live = registry.isLive(id);
    const before = wasLive.get(id);
    wasLive.set(id, live);
    if (!live) {
      announced.delete(id);
    } else if (before === undefined) {
      announced.add(id);
    } else if (before === false && !announced.has(id)) {
      fired.push(runActivateHooks(id));
    }
  });
  return Promise.all(fired);
}

/**
 * Specs/plugins-phase-4-registry.md rule 41 — an install that needed a restart ran no hook (the old code
 * was still loaded). At the boot that follows, the plugins that owe them get their install hooks and
 * their activation hooks, once; the marker is cleared even if a hook fails (hooks never block).
 */
async function runPendingInstallHooks(model) {
  for (const id of model.pendingHooks()) {
    model.clearHooksPending(id);
    if (!registry.get(id)) continue;
    announced.delete(id);
    await runInstallHooks(id); // eslint-disable-line no-await-in-loop
    runActivateHooks(id);
  }
}

/** Test-only: forget every recorded transition so a suite starts from a clean boot. */
function resetLiveTransitionsForTests() {
  wasLive.clear();
  announced.clear();
  installing.clear();
}

const gate = (id) => requirePlugin(id, { isActive: registry.isLive });

// The routers holding the plugin mounts, placed once in the app (rule 13: a live install adds to them).
let publicDispatcher = null;
let apiDispatcher = null;
const mountedIds = new Set();
const mountedLayers = new Map();

// The layers a record added to a dispatcher, kept so a re-registered plugin replaces them.
function trackLayers(router, id, mount) {
  const before = router.stack.length;
  mount();
  const layers = mountedLayers.get(id) || [];
  layers.push({ router, added: router.stack.slice(before) });
  mountedLayers.set(id, layers);
}

function unmountRecord(id) {
  (mountedLayers.get(id) || []).forEach(({ router, added }) => {
    router.stack = router.stack.filter((layer) => !added.includes(layer));
  });
  mountedLayers.delete(id);
  mountedIds.delete(id);
}

function mountRecordPublic(router, record) {
  trackLayers(router, record.id, () => {
    record.mounts.filter((m) => m.public).forEach((m) => router.use(m.path, gate(record.id), m.router));
  });
}

function mountRecordApi(router, record) {
  trackLayers(router, record.id, () => mountRecordApiLayers(router, record));
}

function mountRecordApiLayers(router, record) {
  record.webhooks.forEach((w) => router.post(w.path, gate(record.id), w.handler));
  record.routes.forEach((r) => router[r.method](r.path, gate(record.id), ...r.handlers));
  record.mounts.filter((m) => !m.public).forEach((m) => router.use(m.path, gate(record.id), m.router));
}

function mountPublic(app) {
  publicDispatcher = express.Router();
  app.use(publicDispatcher);
  registry.all().forEach((record) => mountRecordPublic(publicDispatcher, record));
}

function mountApi(app) {
  apiDispatcher = express.Router();
  app.use(apiDispatcher);
  mountedIds.clear();
  registry.all().forEach((record) => {
    mountRecordApi(apiDispatcher, record);
    mountedIds.add(record.id);
  });
}

let jobTimers = null;
const scheduledIds = new Set();

function scheduleRecordJobs(record) {
  if (!jobTimers || scheduledIds.has(record.id)) return;
  scheduledIds.add(record.id);
  record.jobs.forEach((job) => {
    const tick = whenPluginActive(record.id, job.run, { isActive: registry.isLive });
    const run = () => tick().catch((err) => {
      // eslint-disable-next-line no-console
      console.error(`[plugin:${record.id}:${job.name}] unhandled:`, err && err.message ? err.message : err);
    });
    jobTimers.setIntervalFn(run, job.intervalMs);
    if (job.bootDelayMs != null) jobTimers.setTimeoutFn(run, job.bootDelayMs);
  });
}

function startJobs({ setIntervalFn = setInterval, setTimeoutFn = setTimeout } = {}) {
  jobTimers = { setIntervalFn, setTimeoutFn };
  scheduledIds.clear();
  registry.all().forEach(scheduleRecordJobs);
}

/**
 * Rule 13 — a package installed while the app runs: its routes, jobs and handlers take effect at
 * once. The migrations and the install hooks stay the controller's (install order: migrate, row,
 * hooks). Returns false when `register` threw (the plugin is then failed, rule 4 of phase 1). A plugin
 * already failed is registered afresh: its failed record, its mounts and its job schedule are dropped
 * first, so a retry either comes up whole or fails again (audit 2026-10-28).
 */
function registerLive(mod, { db, settingsModel = defaultSettingsModel } = {}) {
  const existing = registry.get(mod.id);
  if (existing && !existing.failed) return true;
  if (existing) {
    registry.discard(mod.id);
    unmountRecord(mod.id);
    scheduledIds.delete(mod.id);
  }
  const ok = registerOne(mod, { db, settingsModel });
  const record = registry.get(mod.id);
  if (!record || mountedIds.has(mod.id)) return ok;
  if (publicDispatcher) mountRecordPublic(publicDispatcher, record);
  if (apiDispatcher) mountRecordApi(apiDispatcher, record);
  mountedIds.add(mod.id);
  if (ok) scheduleRecordJobs(record);
  return ok;
}

/**
 * Rules 14 and 17 — the modules of the installed rows, from their package directories. A package
 * whose ranges the running core or SDK no longer satisfies, or whose requirement is not loadable,
 * is left out: still installed, data untouched, shown « Incompatible avec cette version ».
 *
 * → { modules, incompatible: { id: { code, message } }, manifests: { id: manifest } }
 */
function loadPackages({ store, rows, order, env, nameOf = (id) => id }) {
  const { rangeRefusal } = require('../utils/pluginOffers');
  const { parseManifest } = require('./manifest');
  const readManifestFrom = (dir) => {
    try { return parseManifest(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')); } catch { return null; }
  };
  const incompatible = {};
  const manifests = {};
  const dirs = {};
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  order.filter((id) => byId[id]).forEach((id) => {
    const dir = store.packageDirFor(id, byId[id]);
    if (!dir) {
      incompatible[id] = { code: 'PACKAGE_MISSING', message: 'Paquet introuvable : à réinstaller.' };
      return;
    }
    const manifest = readManifestFrom(dir);
    if (!manifest) {
      incompatible[id] = { code: 'PACKAGE_MISSING', message: 'Paquet introuvable : à réinstaller.' };
      return;
    }
    const refusal = rangeRefusal(manifest, env);
    if (refusal) {
      incompatible[id] = { code: refusal.code, message: 'Incompatible avec cette version.' };
      return;
    }
    manifests[id] = manifest;
    dirs[id] = dir;
  });
  // specs/plugin-dependencies.md rule 5 — a dependency cycle leaves every member unloaded: neither could
  // be switched on first.
  const { createGraph, cycleLabel } = require('../utils/pluginGraph');
  createGraph({ manifests, nameOf }).cycles().forEach((cycle) => {
    cycle.forEach((id) => {
      incompatible[id] = { code: 'REQUIREMENT_CYCLE', message: `Dépendance circulaire : ${cycleLabel(cycle, nameOf)}.` };
      delete manifests[id];
    });
  });
  // A requirement must itself be loadable, at a version its range accepts — repeated until stable.
  const { satisfies } = require('../utils/semverRange');
  let changed = true;
  while (changed) {
    changed = false;
    Object.entries(manifests).forEach(([id, manifest]) => {
      const missing = (manifest.requires || []).find((r) => !manifests[r.id] || !satisfies(manifests[r.id].version, r.range));
      if (!missing) return;
      incompatible[id] = { code: 'REQUIREMENT_MISSING', message: `Nécessite ${nameOf(missing.id)}.` };
      delete manifests[id];
      changed = true;
    });
  }
  installResolver({ roots: Object.values(dirs) });
  const modules = order.filter((id) => manifests[id]).map((id) => {
    try {
      // eslint-disable-next-line import/no-dynamic-require, global-require
      const mod = require(path.join(dirs[id], 'server'));
      if (!mod || mod.id !== id || typeof mod.register !== 'function') throw new Error(`package ${id} exports no module "${id}"`);
      return mod;
    } catch (err) {
      return { id, register() { throw err; } };
    }
  });
  return { modules, incompatible, manifests };
}

/** The module of one package directory, for a live install (rule 13). */
function requirePackage(id, dir) {
  installResolver({ roots: [dir] });
  // eslint-disable-next-line import/no-dynamic-require, global-require
  const mod = require(path.join(dir, 'server'));
  if (!mod || mod.id !== id || typeof mod.register !== 'function') throw new Error(`package ${id} exports no module "${id}"`);
  return mod;
}

const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Whether `path` (below /api) falls on a route, a mount or a webhook the plugin declared itself.
function ownsPath(record, method, path) {
  const full = `/api${path}`;
  const verb = String(method).toLowerCase();
  if (record.routes.some((r) => r.method === verb && new RegExp(`^${escapeRe(r.path).replace(/:[A-Za-z_]+/g, '[^/]+')}$`).test(full))) return true;
  if (record.mounts.some((m) => !m.public && (full === m.path || full.startsWith(`${m.path}/`)))) return true;
  return record.webhooks.some((w) => w.path === full);
}

// Authz L4 (audit 2026-10-28) — a plugin's allowlist entries count while it is live, and only on
// paths it serves itself: an entry aimed at a core route stays inert, whatever its pattern.
function roleMatchers(role) {
  return registry.all().filter((record) => registry.isLive(record.id)).flatMap((record) => (record.roleAccess[role] || []).map((m) => ({
    ...m,
    pluginId: record.id,
    re: { source: m.re.source, test: (path) => m.re.test(path) && ownsPath(record, m.method, path) },
  })));
}

const receptionMatchers = () => roleMatchers('reception');

// Whether `path` (below /api, as the guards see it) is a webhook a live plugin declared — the guards
// let it through to the plugin's own authentication (specs/plugins-phase-3a-online-payment.md rule 12).
function isWebhook(method, path) {
  if (method !== 'POST') return false;
  return registry.all().some((record) => record.webhooks.some((w) => w.path === `/api${path}`) && registry.isLive(record.id));
}

module.exports = {
  registerAll,
  migrate,
  runInstallHooks,
  runActivateHooks,
  syncLiveTransitions,
  runPendingInstallHooks,
  markInactive,
  beginInstall,
  endInstall,
  resetLiveTransitionsForTests,
  mountPublic,
  mountApi,
  startJobs,
  roleMatchers,
  receptionMatchers,
  isWebhook,
  installResolver,
  loadPackages,
  requirePackage,
  registerLive,
};
