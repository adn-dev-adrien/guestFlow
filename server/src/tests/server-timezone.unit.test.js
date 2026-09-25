// specs/server-timezone.md — the process declares the zone its schedulers compare wall-clock times in.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  applyServerTimezone,
  resolveServerTimezone,
  DEFAULT_TIMEZONE,
} = require('../utils/serverTimezone');

// --- rule 1: nothing configured → Europe/Paris ---

test('resolveServerTimezone defaults to Europe/Paris when GUESTFLOW_TZ is unset', () => {
  assert.equal(DEFAULT_TIMEZONE, 'Europe/Paris');
  for (const configured of [undefined, '', '   ']) {
    assert.deepEqual(resolveServerTimezone(configured), { timezone: 'Europe/Paris', source: 'default' });
  }
});

// --- rule 4: GUESTFLOW_TZ is the only override ---

test('resolveServerTimezone honours a usable GUESTFLOW_TZ', () => {
  assert.deepEqual(resolveServerTimezone('America/Martinique'), {
    timezone: 'America/Martinique',
    source: 'configured',
  });
  assert.deepEqual(resolveServerTimezone('  UTC  '), { timezone: 'UTC', source: 'configured' });
});

test('applyServerTimezone lets GUESTFLOW_TZ beat an inherited TZ (rule 4)', () => {
  const env = { TZ: 'Europe/Paris', GUESTFLOW_TZ: 'Indian/Reunion' };
  assert.deepEqual(applyServerTimezone({ env }), { timezone: 'Indian/Reunion', source: 'configured' });
  assert.equal(env.TZ, 'Indian/Reunion');
});

// --- rule 3: an inherited TZ never decides ---

test('applyServerTimezone overwrites a TZ inherited from the host', () => {
  // The regression itself: a host (or a base image) whose clock is UTC must not drag the schedulers
  // with it — 16:00 has to mean 16:00 in Corsica.
  const env = { TZ: 'UTC' };
  assert.deepEqual(applyServerTimezone({ env }), { timezone: 'Europe/Paris', source: 'default' });
  assert.equal(env.TZ, 'Europe/Paris');
});

// --- rule 5: an unusable value falls back instead of crashing the boot ---

test('applyServerTimezone warns once on the fallback and never throws', () => {
  const env = { GUESTFLOW_TZ: 'Mars/Olympus_Mons' };
  const warnings = [];
  const result = applyServerTimezone({ env, logger: { warn: (m) => warnings.push(m) } });
  assert.deepEqual(result, { timezone: 'Europe/Paris', source: 'fallback' });
  assert.equal(env.TZ, 'Europe/Paris');
  assert.equal(warnings.length, 1);
});

// --- rule 2: applied before anything reads the clock, and the clock follows ---

test('after applyServerTimezone a 16:00 Paris check-in reads as 16:00, not 14:00 (rule 2)', () => {
  const previousTz = process.env.TZ;
  const previousConfigured = process.env.GUESTFLOW_TZ;
  try {
    // Start from the production situation: a process whose clock is UTC.
    process.env.TZ = 'UTC';
    delete process.env.GUESTFLOW_TZ;
    // 2026-09-25T14:00:00Z is 16:00 in Paris (CEST) — the instant the check-in of the stay that
    // exposed this bug became due.
    assert.equal(new Date('2026-09-25T14:00:00Z').getHours(), 14);

    applyServerTimezone();
    assert.equal(new Date('2026-09-25T14:00:00Z').getHours(), 16);

    // And in winter (CET) the same instant is 15:00, so the offset is not hard-coded.
    assert.equal(new Date('2026-01-25T14:00:00Z').getHours(), 15);
  } finally {
    if (previousTz === undefined) delete process.env.TZ;
    else process.env.TZ = previousTz;
    if (previousConfigured !== undefined) process.env.GUESTFLOW_TZ = previousConfigured;
  }
});

test('index.js applies the timezone before it requires anything else (rule 2)', () => {
  // A require added above this line would load modules — and, one day, read the clock — while the
  // process is still in the host's zone. The ordering IS the rule, so it is the thing under test.
  const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
  const firstRequire = source.indexOf('require(');
  assert.notEqual(firstRequire, -1);
  assert.equal(
    source.slice(firstRequire, firstRequire + 40).includes('./utils/serverTimezone'),
    true,
    'the first require of index.js must be ./utils/serverTimezone',
  );
  assert.ok(source.indexOf('applyServerTimezone()') < source.indexOf("require('express')"));
});

// --- rule 6: the boot marker says which zone the process ended up in ---

test('the boot marker reports the effective timezone', () => {
  // Next time a trigger looks late, the answer must be in the first line of `pm2 logs guestflow`
  // rather than in an SSH session comparing /etc/localtime to a check-in time.
  const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
  const marker = source.split('\n').find((l) => l.includes('SERVER BOOT START'));
  assert.ok(marker, 'index.js must still log a boot marker');
  assert.match(marker, /timezone \$\{serverTimezone\}/);
});
