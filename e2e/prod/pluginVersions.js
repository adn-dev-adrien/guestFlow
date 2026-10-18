// @ts-check
// The versions the production-build suite reads from the plugins' manifests, so bumping a plugin never
// breaks it: `current(id)` is the bundled version, `nextPatch(id)` the update the fake registry offers.
const manifest = (id) => require(`../../server/src/plugins/${id}/manifest.json`);

const current = (id) => manifest(id).version;

function nextPatch(id) {
  const [major, minor, patch] = current(id).split('.').map(Number);
  return `${major}.${minor}.${patch + 1}`;
}

module.exports = { current, nextPatch };
