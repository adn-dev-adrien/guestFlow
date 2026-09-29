/**
 * The console's daily job (specs/control-plane-plans-and-access.md rules 9, 14, 20): at 04:00 Paris
 * time — or at start-up when today's run was missed — every customer's state is recomputed and its
 * licence re-issued (a licence is valid 7 days, so a daily re-issue keeps a week of margin), and the
 * archived customers whose 90 days are over are erased. C2b adds invoices, reminders and the
 * operator's email to the same run.
 */

const { parisDay } = require('../utils/days');

const RUN_HOUR = 4;

function parisHour(date) {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', hourCycle: 'h23' }).format(date));
}

function createScheduler(ctx, log = (msg) => console.log(msg)) {
  const { models, now, controllers } = ctx;

  function runDaily() {
    const day = parisDay(now());
    const refreshed = controllers.customers.reissueAll('système');
    const erased = controllers.customers.eraseDue('système');
    models.meta.set('lastDailyRun', day);
    log(`[scheduler] ${day}: ${refreshed.length} licence(s) re-issued, ${erased.length} erased`);
    return { day, refreshed: refreshed.length, erased: erased.length };
  }

  // Due when today's run has not happened and it is past the run hour (or the console was down).
  function isDue() {
    const t = now();
    return models.meta.get('lastDailyRun') !== parisDay(t) && parisHour(t) >= RUN_HOUR;
  }

  function tick() {
    if (!isDue()) return null;
    try {
      return runDaily();
    } catch (err) {
      log(`[scheduler] daily run failed: ${err.message}`);
      return null;
    }
  }

  function start(intervalMs = 60000) {
    tick();
    const timer = setInterval(tick, intervalMs);
    timer.unref();
    return () => clearInterval(timer);
  }

  return { runDaily, isDue, tick, start };
}

module.exports = { createScheduler, RUN_HOUR };
