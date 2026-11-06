// The application's write routes as Express holds them, core and plugins. A router forgets the path it was mounted on,
// so `install()` notes it, BEFORE the application loads (specs/hosting-h2-account-security.md rule 68, census).
const express = require('express');

const WRITES = ['post', 'put', 'patch', 'delete'];
const mountPaths = new WeakMap();
let application = null;

function install() {
  const appUse = express.application.use;
  express.application.use = function noteApplication(...args) {
    application = this;
    return appUse.apply(this, args);
  };
  const proto = express.Router.prototype;
  const use = proto.use;
  proto.use = function noteMount(first, ...rest) {
    if (typeof first === 'string') rest.flat(Infinity).forEach((handler) => mountPaths.set(handler, first));
    return use.call(this, first, ...rest);
  };
}

function walk(stack, prefix, found) {
  for (const layer of stack) {
    if (layer.route) {
      for (const method of WRITES.filter((name) => layer.route.methods[name])) {
        for (const path of [layer.route.path].flat()) found.add(`${method.toUpperCase()} ${`${prefix}${path}`.replace(/\/+/g, '/').replace(/(.)\/$/, '$1')}`);
      }
    } else if (layer.handle && Array.isArray(layer.handle.stack)) {
      walk(layer.handle.stack, `${prefix}${mountPaths.get(layer.handle) || ''}`, found);
    }
  }
}

/** Every write route of the application, as `METHOD /path/:param`, sorted. */
function writeRoutes() {
  const found = new Set();
  walk(application.router.stack, '', found);
  return [...found].sort();
}

/**
 * The write routes each plugin of the tree registered, `{ id: ['METHOD /path', …] }`, read from the plugin registry: its
 * single routes, its webhooks and the routers it mounted, walked like the application's.
 */
function pluginWriteRoutes() {
  const registry = require('../plugins/sdk/registry');
  const owned = {};
  for (const record of registry.all()) {
    const found = new Set();
    record.routes.filter((r) => WRITES.includes(r.method)).forEach((r) => found.add(`${r.method.toUpperCase()} ${r.path}`));
    record.webhooks.forEach((w) => found.add(`POST ${w.path}`));
    record.mounts.forEach((m) => walk(m.router.stack || [], m.path, found));
    owned[record.id] = [...found].sort();
  }
  return owned;
}

module.exports = { install, writeRoutes, pluginWriteRoutes };
