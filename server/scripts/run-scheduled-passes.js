#!/usr/bin/env node
/**
 * run-scheduled-passes.js — one run of every pass the server schedules, for the removal matrix
 * (specs/plugin-removal-resilience.md rules 9, 17). Boots the plugins the way `index.js` does, then
 * runs, once and in turn: the core passes (iCal sync, arrival/departure and breakfast pushes, email
 * auto-send, digests) and the job of every live plugin. A pass that throws is reported; none stops
 * the others.
 *
 *   DB_PATH=… GUESTFLOW_PLUGINS=packages node server/scripts/run-scheduled-passes.js
 *
 * Prints `{ ran: [names], failed: { name: message } }` and exits 1 when something failed. Never
 * used by the app itself.
 */

const db = require('../src/database');
const loader = require('../src/plugins/loader');
const registry = require('../src/plugins/sdk/registry');

require('../src/plugins/host').boot({
  db,
  loader,
  registry,
  model: require('../src/models/pluginsModel'),
  catalogue: require('../src/constants/plugins').PLUGIN_CATALOG,
});

const scheduled = require('../src/scheduledTasks');
const emailAutoSend = require('../src/utils/emailAutoSendScheduler');
const notificationService = require('../src/utils/notificationService');

async function main() {
  const passes = [
    ['ical-sync', () => scheduled.performAutoSync()],
    ['arrival-departure-push', () => scheduled.runArrivalDeparturePushPass('boot')],
    ['breakfast-push', () => scheduled.runBreakfastPushPass('boot')],
    ['email-auto-send', () => emailAutoSend.runPass('removal')],
    ['digests', () => notificationService.flushDueDigests()],
    ...registry.all()
      .filter((record) => registry.isLive(record.id))
      .flatMap((record) => record.jobs.map((job) => [`${record.id}:${job.name}`, () => job.run()])),
  ];
  const ran = [];
  const failed = {};
  for (const [name, run] of passes) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await run();
      ran.push(name);
    } catch (err) {
      failed[name] = err && err.message ? err.message : String(err);
    }
  }
  console.log(JSON.stringify({ ran, failed }));
  process.exit(Object.keys(failed).length ? 1 : 0);
}

main();
