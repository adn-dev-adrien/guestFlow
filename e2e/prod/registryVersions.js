// @ts-check
// The versions of the production-build suite, read from the plugins' own manifests so a plugin bump
// never breaks the suite: `bundled` is what the release ships (plugins-dist), `next` the version the
// test registry publishes above it (specs/plugins-phase-4-registry.md rules 10, 13, 22).
const path = require('path');

const MANIFESTS = path.join(__dirname, '..', '..', 'server', 'src', 'plugins');

function bundled(id) {
  return require(path.join(MANIFESTS, id, 'manifest.json')).version;
}

function next(id) {
  const [major, minor, patch] = bundled(id).split('.').map(Number);
  return `${major}.${minor}.${patch + 1}`;
}

module.exports = { bundled, next };
