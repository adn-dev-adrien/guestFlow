/**
 * What every plugin module registered (specs/plugins-phase-1-sdk.md §3.B). One record per module,
 * filled by `register(ctx)`; the core reads it — the loader to mount and schedule, the event bus to
 * dispatch, the email and SAS builders to merge contributions, the Plugins controller to install and
 * erase. The core never imports a plugin file: it only asks this registry.
 *
 * `isLive(id)` is the single answer to "may this plugin run now": installed, active, registered
 * without throwing (rule 4), and allowed by the instance's licence
 * (specs/control-plane-plans-and-access.md rule 12). `isActive` and `allows` are injectable for tests.
 */

const records = new Map();
let isActiveImpl = (id) => require('../../models/pluginsModel').isActive(id);
let allowsImpl = (id) => require('../../utils/licence').allowsPlugin(id);

function emptyRecord(id) {
  return {
    id,
    failed: null,
    mounts: [],
    routes: [],
    reception: [],
    migrations: [],
    settings: [],
    jobs: [],
    handlers: new Map(),
    emailProviders: [],
    sasProviders: [],
    onInstall: [],
    onBoot: [],
    data: null,
  };
}

function ensure(id) {
  if (!records.has(id)) records.set(id, emptyRecord(id));
  return records.get(id);
}

module.exports = {
  ensure,
  get: (id) => records.get(id) || null,
  all: () => [...records.values()],
  has: (id) => records.has(id),
  markFailed(id, err) {
    const record = emptyRecord(id);
    record.failed = (err && err.message) || String(err);
    records.set(id, record);
  },
  isLive: (id) => {
    const record = records.get(id);
    if (record && record.failed) return false;
    return Boolean(isActiveImpl(id)) && allowsImpl(id);
  },
  configure({ isActive, allows } = {}) {
    if (isActive) isActiveImpl = isActive;
    if (allows) allowsImpl = allows;
  },
  reset() {
    records.clear();
    isActiveImpl = (id) => require('../../models/pluginsModel').isActive(id);
    allowsImpl = (id) => require('../../utils/licence').allowsPlugin(id);
  },
};
