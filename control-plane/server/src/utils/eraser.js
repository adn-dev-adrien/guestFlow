/**
 * Erases a customer's instance directory at the end of the 90 days (rule 20, step 5). Refuses any
 * path that is not exactly `<root>/<slug>`: a wrong slug must never become `rm -rf` of something
 * else.
 */

const fs = require('fs');
const path = require('path');

function eraseInstance({ instances, slug }) {
  const target = path.resolve(instances.dirOf(slug));
  if (path.dirname(target) !== instances.root || path.basename(target) !== slug) {
    throw new Error(`refusing to erase ${target}`);
  }
  if (!fs.existsSync(target)) return { erased: false };
  fs.rmSync(target, { recursive: true, force: true });
  return { erased: true };
}

module.exports = { eraseInstance };
