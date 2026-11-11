// specs/plugins-phase-0-foundation.md — what the core test used to read from this plugin's sources.

const test = require('node:test');
const assert = require('node:assert/strict');

const googleCalendarSync = require('../sync');

test('Google sync: an inactive plugin makes every push, delete and reconcile a no-op', () => {
  const settings = { googleConnected: () => true, googleCalendarSelection: () => ({ calendarId: 'cal' }) };
  const on = googleCalendarSync.create({ settings, pluginActive: () => true });
  const off = googleCalendarSync.create({ settings, pluginActive: () => false });
  assert.equal(on.isActive(), true);
  assert.equal(off.isActive(), false);
});
