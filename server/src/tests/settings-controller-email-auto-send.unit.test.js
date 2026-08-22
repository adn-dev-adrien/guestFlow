const test = require('node:test');
const assert = require('node:assert/strict');

// The `emails` settings group at the HTTP boundary
// (specs/no-automatic-email-without-approval.md §4.3). The client sends a Switch's boolean; SQLite
// stores 0/1. This is where that coercion happens, and where a partial update must not disturb the
// rest of the settings.

let upserted = null;

require.cache[require.resolve('../models/settingsModel')] = {
  exports: {
    upsert(payload) { upserted = payload; },
    read() { return {}; },
    updateLogoPath() {},
    smtpConfigured() { return false; },
    decryptedSmtpSettings() { return {}; },
    publicUrl() { return ''; },
  },
};

require.cache[require.resolve('../utils/settingsResponse')] = {
  exports: { shapeResponse: (row) => row },
};

// The switch is what schedules — or unschedules — the 08:00 pass (§3 rule 2b), so the write path
// has to re-sync the scheduler. Stubbed here to count the calls without registering a real timer.
let syncCalls = 0;
require.cache[require.resolve('../utils/emailAutoSendScheduler')] = {
  exports: { syncWithSettings() { syncCalls += 1; return true; } },
};

const { updateSettings } = require('../controllers/settingsController');

function call(body) {
  upserted = null;
  syncCalls = 0;
  const res = {
    statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(p) { this.body = p; return this; },
  };
  updateSettings({ body }, res);
  return { upserted, res };
}

test('the switch is stored as 0/1, whatever shape the client sent', () => {
  assert.equal(call({ emails: { autoSendEnabled: true } }).upserted.emailAutoSendEnabled, 1);
  assert.equal(call({ emails: { autoSendEnabled: false } }).upserted.emailAutoSendEnabled, 0);
  assert.equal(call({ emails: { autoSendEnabled: 1 } }).upserted.emailAutoSendEnabled, 1);
  assert.equal(call({ emails: { autoSendEnabled: 0 } }).upserted.emailAutoSendEnabled, 0);
  // Anything that is not an explicit yes lands as 0 — the safe direction.
  assert.equal(call({ emails: { autoSendEnabled: null } }).upserted.emailAutoSendEnabled, 0);
  assert.equal(call({ emails: { autoSendEnabled: 'oui' } }).upserted.emailAutoSendEnabled, 0);
});

test('a group that omits the switch does not write the column', () => {
  // Partial-group semantics: saving another section must never silently re-write this one.
  const { upserted: pl } = call({ emails: {} });
  assert.ok(!Object.prototype.hasOwnProperty.call(pl, 'emailAutoSendEnabled'));
});

test('saving another section leaves the switch untouched', () => {
  const { upserted: pl } = call({ company: { name: 'Domaine Solio' } });
  assert.ok(!Object.prototype.hasOwnProperty.call(pl, 'emailAutoSendEnabled'));
  assert.equal(pl.companyName, 'Domaine Solio');
});

test('the switch travels alongside other groups in one save', () => {
  const { upserted: pl, res } = call({
    emails: { autoSendEnabled: true },
    notifications: { enabled: false },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(pl.emailAutoSendEnabled, 1);
  assert.equal(pl.notificationsEnabled, 0);
});

test('writing the switch re-syncs the scheduler, so the change needs no restart', () => {
  call({ emails: { autoSendEnabled: true } });
  assert.equal(syncCalls, 1, 'ON must start the timer right away');

  call({ emails: { autoSendEnabled: false } });
  assert.equal(syncCalls, 1, 'OFF must clear it just as promptly');
});

test('saving a section that does not carry the switch leaves the scheduler alone', () => {
  call({ company: { name: 'Domaine Solio' } });
  assert.equal(syncCalls, 0);

  call({ emails: {} });
  assert.equal(syncCalls, 0, 'an empty group writes no column — nothing to re-sync');
});
