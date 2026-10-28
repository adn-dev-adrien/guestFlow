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
const wasLive = new Map();

function runActivateHooks(id) {
  const record = registry.get(id);
  if (!record || record.failed) return Promise.resolve();
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

/**
 * A plugin can also turn live without anyone activating it: the licence starts allowing it (a plan
 * upgrade, the row already enabled). The first call records the live set (the boot, which fires nothing);
 * each later call fires the activation hooks of the plugins that were not live and now are — once per
 * transition, an explicit activation having already recorded itself.
 */
function syncLiveTransitions() {
  const fired = [];
  registry.all().forEach((record) => {
    const live = registry.isLive(record.id);
    const before = wasLive.get(record.id);
    wasLive.set(record.id, live);
    if (before === false && live) fired.push(runActivateHooks(record.id));
  });
  return Promise.all(fired);
}

function resetLiveTransitions() { wasLive.clear(); }

const gate = (id) => requirePlugin(id, { isActive: registry.isLive });

// The routers holding the plugin mounts, placed once in the app (rule 13: a live install adds to them).
let publicDispatcher = null;
let apiDispatcher = null;
const mountedIds = new Set();

function mountRecordPublic(router, record) {
  record.mounts.filter((m) => m.public).forEach((m) => router.use(m.path, gate(record.id), m.router));
}

function mountRecordApi(router, record) {
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
 * hooks). Returns false when `register` threw (the plugin is then failed, rule 4 of phase 1).
 */
function registerLive(mod, { db, settingsModel = defaultSettingsModel } = {}) {
  if (registry.has(mod.id) && !registry.get(mod.id).failed) return true;
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

function roleMatchers(role) {
  return registry.all().flatMap((record) => (record.roleAccess[role] || []).map((m) => ({ ...m, pluginId: record.id })));
}

const receptionMatchers = () => roleMatchers('reception');

// Whether `path` (below /api, as the guards see it) is a webhook a plugin declared — the guards let it
// through to the plugin's own authentication (specs/plugins-phase-3a-online-payment.md rule 12).
function isWebhook(method, path) {
  if (method !== 'POST') return false;
  return registry.all().some((record) => record.webhooks.some((w) => w.path === `/api${path}`));
}

module.exports = {
  registerAll,
  migrate,
  runInstallHooks,
  runActivateHooks,
  syncLiveTransitions,
  resetLiveTransitions,
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
