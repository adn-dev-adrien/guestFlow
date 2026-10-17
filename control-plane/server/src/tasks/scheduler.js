/**
 * The console's jobs (specs/control-plane-plans-and-access.md rules 9, 14, 17, 18, 20, 34).
 *
 * Daily, at 04:00 Paris time — or at start-up when today's run was missed:
 *   1. every customer's state is recomputed and its licence re-issued (a licence is valid 7 days, so
 *      a daily re-issue keeps a week of margin);
 *   2. the archived customers whose 90 days are over are erased (once their process is marked
 *      stopped), and the export archives whose link expired are deleted;
 *   3. the invoices that come due are created in Qonto, and their emails prepared or sent;
 *   4. the operators get the day's email when there is something in it.
 *
 * Every 15 minutes: the open invoices are checked in Qonto, so a payment renews within the quarter
 * hour even when the webhook never came.
 *
 * Every minute: the directory is read from the instances' active accounts (rule 26), and the probe
 * measures the instances and raises the host alerts (specs/hosting-h1-fleet-runtime.md rules 15–17).
 *
 * The hosting adds to the daily run: the uploads synced to the backup storage (H1 rule 12), the
 * weekly restore check on Sundays (rule 13), and the 301 of renamed addresses past their 90 days
 * removed (rule 5). At start-up, a fleet update cut short by a restart is closed, and the `local`
 * process driver starts the enabled instances again, as systemd does at boot.
 */

const fs = require('fs');
const path = require('path');
const { parisDay } = require('../utils/days');
const { backupTo } = require('../utils/sqliteBackup');

const CONSOLE_COPIES = 7;

const RUN_HOUR = 4;
const PAYMENT_CHECK_MS = 15 * 60 * 1000;

function parisHour(date) {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', hourCycle: 'h23' }).format(date));
}

function createScheduler(ctx, log = (msg) => console.log(msg)) {
  const { models, now, controllers } = ctx;
  let running = null;

  async function runDaily() {
    const day = parisDay(now());
    const refreshed = controllers.customers.reissueAll('système');
    // Rule 23: an erasure that fails is an alert, never the end of the daily run.
    const erased = await controllers.customers.eraseDue('système', log).catch((err) => { log(`[scheduler] erasure failed: ${err.message}`); return []; });
    controllers.customers.purgeExpiredExports();
    models.meta.set('lastDailyRun', day);
    await runHostDaily().catch((err) => log(`[scheduler] host daily run failed: ${err.message}`));
    const invoiced = await controllers.billing.runDaily(log);
    const notified = await controllers.billing.sendDigest(controllers.alerts.digestLines(), day)
      .catch((err) => { log(`[scheduler] daily email failed: ${err.message}`); return 0; });
    log(`[scheduler] ${day}: ${refreshed.length} licence(s) re-issued, ${erased.length} erased, ${invoiced} invoice(s) open, ${notified} operator email(s)`);
    return { day, refreshed: refreshed.length, erased: erased.length, invoiced, notified };
  }

  async function runHostDaily() {
    for (const c of models.customers.list().filter((x) => !x.archivedAt)) {
      const row = models.provisioning.get(c.id, 'backup');
      if (!row || row.status !== 'ok') continue;
      await ctx.drivers.backup.syncUploads(ctx.provisioner.instanceOf(c)).catch((err) => log(`[backup] ${c.slug} uploads: ${err.message}`));
    }
    await ctx.provisioner.dropExpiredRedirects().catch((err) => log(`[proxy] redirects: ${err.message}`));
    await ctx.weeklyRestore.runIfDue().catch((err) => log(`[restore-check] failed: ${err.message}`));
    await copyConsoleDatabase().catch((err) => log(`[backup] console database: ${err.message}`));
  }

  // The console's own database, copied every night and sent to the backup storage; 7 copies kept.
  async function copyConsoleDatabase() {
    if (!ctx.consoleDbFile || !fs.existsSync(ctx.consoleDbFile)) return null;
    const file = path.join(ctx.consoleBackupDir, `control-plane-${parisDay(now())}.db`);
    await backupTo(ctx.consoleDbFile, file);
    const copies = fs.readdirSync(ctx.consoleBackupDir).filter((f) => /^control-plane-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort();
    for (const f of copies.slice(0, Math.max(0, copies.length - CONSOLE_COPIES))) fs.rmSync(path.join(ctx.consoleBackupDir, f), { force: true });
    await ctx.drivers.backup.syncConsole(file);
    return file;
  }

  let probing = false;
  async function probe() {
    if (probing) return 0;
    probing = true;
    try {
      return await ctx.probe.runOnce();
    } catch (err) {
      log(`[probe] failed: ${err.message}`);
      return 0;
    } finally {
      probing = false;
    }
  }

  // Due when today's run has not happened and it is past the run hour (or the console was down).
  function isDue() {
    const t = now();
    return models.meta.get('lastDailyRun') !== parisDay(t) && parisHour(t) >= RUN_HOUR;
  }

  async function tick() {
    if (running || !isDue()) return null;
    running = runDaily();
    try {
      return await running;
    } catch (err) {
      log(`[scheduler] daily run failed: ${err.message}`);
      return null;
    } finally {
      running = null;
    }
  }

  async function checkPayments() {
    try {
      return await controllers.billing.checkPayments(log);
    } catch (err) {
      log(`[scheduler] payment check failed: ${err.message}`);
      return 0;
    }
  }

  function readDirectory() {
    try {
      return controllers.login.readDirectory();
    } catch (err) {
      log(`[scheduler] directory read failed: ${err.message}`);
      return 0;
    }
  }

  function start(intervalMs = 60000) {
    ctx.fleetUpdater.recover();
    ctx.provisioner.recover();
    const live = models.customers.list().filter((c) => !c.archivedAt).map((c) => ctx.provisioner.instanceOf(c));
    ctx.drivers.process.resumeEnabled(live).catch((err) => log(`[process] resume failed: ${err.message}`));
    tick();
    readDirectory();
    const timers = [setInterval(tick, intervalMs), setInterval(checkPayments, PAYMENT_CHECK_MS), setInterval(readDirectory, intervalMs),
      setInterval(probe, intervalMs)];
    for (const t of timers) t.unref();
    return () => timers.forEach(clearInterval);
  }

  return { runDaily, runHostDaily, copyConsoleDatabase, isDue, tick, checkPayments, readDirectory, probe, start };
}

module.exports = { createScheduler, RUN_HOUR, PAYMENT_CHECK_MS };
