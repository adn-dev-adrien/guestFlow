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
 *   roleMatchers(role)   the allowlist entries plugins declared for a restricted role
 *                        (specs/plugins-phase-2-hosts.md rule 3); receptionMatchers() is its phase 1 form.
 */

const registry = require('./sdk/registry');
const { createContext } = require('./sdk/createContext');
const { runPluginMigrations } = require('./sdk/pluginMigrations');
const requirePlugin = require('../middleware/requirePlugin');
const { whenPluginActive } = require('../utils/pluginScheduling');

const defaultSettingsModel = () => require('../models/pluginSettingsModel');
const defaultIsInstalled = (id) => Boolean(require('../models/pluginsModel').get(id));

function registerAll({ db, modules = require('./index'), settingsModel = defaultSettingsModel, isInstalled = defaultIsInstalled } = {}) {
  modules.forEach((mod) => {
    try {
      mod.register(createContext(mod.id, { db, settingsModel }));
    } catch (err) {
      registry.markFailed(mod.id, err);
      // eslint-disable-next-line no-console
      console.error(`[plugin:${mod.id}] register failed — the plugin stays off:`, err && err.message ? err.message : err);
    }
  });
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

const gate = (id) => requirePlugin(id, { isActive: registry.isLive });

function mountPublic(app) {
  registry.all().forEach((record) => {
    record.mounts.filter((m) => m.public).forEach((m) => app.use(m.path, gate(record.id), m.router));
  });
}

function mountApi(app) {
  registry.all().forEach((record) => {
    record.routes.forEach((r) => app[r.method](r.path, gate(record.id), ...r.handlers));
    record.mounts.filter((m) => !m.public).forEach((m) => app.use(m.path, gate(record.id), m.router));
  });
}

function startJobs({ setIntervalFn = setInterval, setTimeoutFn = setTimeout } = {}) {
  registry.all().forEach((record) => {
    record.jobs.forEach((job) => {
      const tick = whenPluginActive(record.id, job.run, { isActive: registry.isLive });
      const run = () => tick().catch((err) => {
        // eslint-disable-next-line no-console
        console.error(`[plugin:${record.id}:${job.name}] unhandled:`, err && err.message ? err.message : err);
      });
      setIntervalFn(run, job.intervalMs);
      if (job.bootDelayMs != null) setTimeoutFn(run, job.bootDelayMs);
    });
  });
}

function roleMatchers(role) {
  return registry.all().flatMap((record) => (record.roleAccess[role] || []).map((m) => ({ ...m, pluginId: record.id })));
}

const receptionMatchers = () => roleMatchers('reception');

module.exports = { registerAll, migrate, runInstallHooks, mountPublic, mountApi, startJobs, roleMatchers, receptionMatchers };
