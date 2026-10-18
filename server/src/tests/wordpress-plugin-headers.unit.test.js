// specs/wordpress-plugin.md rule 20 — the plugin declares `Update URI`, so WordPress never offers a
// wordpress.org plugin of the same slug as an « update ». Rule 24 — the version is bumped in the three
// places the release reads, and the update manifest says which WordPress it was tested on.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const PLUGIN = path.join(__dirname, '..', '..', '..', 'integrations', 'wordpress', 'guestflow-booking');
const main = fs.readFileSync(path.join(PLUGIN, 'guestflow-booking.php'), 'utf8');
const readme = fs.readFileSync(path.join(PLUGIN, 'readme.txt'), 'utf8');

test('rule 20: Update URI names the GuestFlow repository, not wordpress.org', () => {
  assert.match(main, /^ \* Update URI:\s+https:\/\/github\.com\/adn-dev-adrien\/guestFlow$/m);
});

test('rule 24: header, constant and Stable tag agree, with a changelog entry', () => {
  const header = /^ \* Version:\s+(\d+\.\d+\.\d+)$/m.exec(main)[1];
  const constant = /define\('GF_BOOKING_VERSION', '(\d+\.\d+\.\d+)'\);/.exec(main)[1];
  const stable = /^Stable tag: (\d+\.\d+\.\d+)$/m.exec(readme)[1];
  assert.equal(constant, header);
  assert.equal(stable, header);
  assert.ok(readme.includes(`= ${header} =`), 'readme.txt has no changelog entry for the version');
});

test('rule 24: the manifest is « tested up to » a current WordPress', () => {
  const ctrl = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'website-booking', 'controllers', 'pluginUpdateController.js'), 'utf8');
  const tested = /const TESTED_WP = '(\d+)\.(\d+)';/.exec(ctrl);
  assert.ok(tested, 'TESTED_WP not found');
  assert.ok(Number(tested[1]) >= 6 && !(Number(tested[1]) === 6 && Number(tested[2]) < 8), `TESTED_WP ${tested[1]}.${tested[2]} is behind`);
});
