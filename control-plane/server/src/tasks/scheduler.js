/**
 * The console's jobs (specs/control-plane-plans-and-access.md rules 9, 14, 17, 18, 20, 34).
 *
 * Daily, at 04:00 Paris time — or at start-up when today's run was missed:
 *   1. every customer's state is recomputed and its licence re-issued (a licence is valid 7 days, so
 *      a daily re-issue keeps a week of margin);
 *   2. the archived customers whose 90 days are over are erased;
 *   3. the invoices that come due are created in Qonto, and their emails prepared or sent;
 *   4. the operators get the day's email when there is something in it.
 *
 * Every 15 minutes: the open invoices are checked in Qonto, so a payment renews within the quarter
 * hour even when the webhook never came.
 *
 * Every minute: the directory is read from the instances' active accounts (rule 26).
 */

const { parisDay } = require('../utils/days');

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
    const erased = controllers.customers.eraseDue('système');
    models.meta.set('lastDailyRun', day);
    const invoiced = await controllers.billing.runDaily(log);
    const notified = await controllers.billing.sendDigest(controllers.alerts.digestLines(), day)
      .catch((err) => { log(`[scheduler] daily email failed: ${err.message}`); return 0; });
    log(`[scheduler] ${day}: ${refreshed.length} licence(s) re-issued, ${erased.length} erased, ${invoiced} invoice(s) open, ${notified} operator email(s)`);
    return { day, refreshed: refreshed.length, erased: erased.length, invoiced, notified };
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
    tick();
    readDirectory();
    const timers = [setInterval(tick, intervalMs), setInterval(checkPayments, PAYMENT_CHECK_MS), setInterval(readDirectory, intervalMs)];
    for (const t of timers) t.unref();
    return () => timers.forEach(clearInterval);
  }

  return { runDaily, isDue, tick, checkPayments, readDirectory, start };
}

module.exports = { createScheduler, RUN_HOUR, PAYMENT_CHECK_MS };
