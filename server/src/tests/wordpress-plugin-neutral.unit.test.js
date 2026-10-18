// specs/plugins-phase-p-productisation.md rule 31 — the WordPress plugin names no deployment: its
// author is « GuestFlow » and its settings show example placeholders.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const PLUGIN = path.join(__dirname, '..', '..', '..', 'integrations', 'wordpress', 'guestflow-booking');
const read = (file) => fs.readFileSync(path.join(PLUGIN, file), 'utf8');

test('rule 31: the plugin is authored by GuestFlow, in its header and its update manifest', () => {
  assert.match(read('guestflow-booking.php'), /^ \* Author:\s+GuestFlow$/m);
  assert.match(read('includes/class-gf-updater.php'), /'author'\s+=> 'GuestFlow'/);
});

test('rule 31: the settings placeholders are examples, never a real address', () => {
  const settings = read('includes/class-gf-settings.php');
  assert.match(settings, /placeholder="https:\/\/guestflow\.example\.com"/);
  // The booking page is a page picker since specs/wordpress-plugin.md rule 14: no URL to type.
  assert.doesNotMatch(settings, /192\.168\.|exemple\.com|domainesolio/);
});
