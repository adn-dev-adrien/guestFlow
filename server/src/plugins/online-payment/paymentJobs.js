/**
 * The two jobs that talk to the payment provider on a timer (specs/plugins-phase-3a-online-payment.md
 * rule 14, specs/payment-link-lifecycle.md rules 16, 22).
 *
 * - `payment-poll`: the reconciliation pass, three times a day (it opens with the lifecycle pass);
 * - `payment-link-lifecycle`: the lifecycle pass alone every 15 minutes, so a link lapses within 15
 *   minutes of its 36 hours instead of at the next poll.
 * Both share ONE in-progress flag: the lifecycle job skips while a poll pass runs, and the other way
 * round. Neither runs while the provider is not connected (rule 23: nothing is deactivated nor read).
 *
 * @param {object} deps
 * @param {() => boolean} deps.isConnected
 * @param {() => Promise<object>} deps.runPoll      one poll pass → its summary
 * @param {() => Promise<object>} deps.runLifecycle one lifecycle pass → { moved, results, stoppedBy }
 * @param {object} deps.log                         ctx.log
 * @param {number} deps.pollIntervalMs
 * @returns {object[]} the job definitions, for `ctx.jobs.every`
 */

const LIFECYCLE_INTERVAL_MS = 15 * 60 * 1000;
const POLL_BOOT_DELAY_MS = 110 * 1000;

function createPaymentJobs({ isConnected, runPoll, runLifecycle, log, pollIntervalMs }) {
  let inProgress = false;
  const exclusive = (work, label) => async () => {
    if (inProgress || !isConnected()) return;
    inProgress = true;
    try {
      await work();
    } catch (err) {
      log.error(`${label} error:`, err && err.message ? err.message : err);
    } finally {
      inProgress = false;
    }
  };

  const poll = async () => {
    const summary = await runPoll();
    if (summary.retired > 0) log.info(`${summary.retired} link(s) lapsed or withdrawn by the lifecycle pass`);
    if (summary.stoppedBy) log.warn(`pass stopped by ${summary.stoppedBy} after ${summary.checked} link(s); the rest wait for the next tick`);
    if (summary.paid > 0) log.info(`${summary.paid} paid / ${summary.checked} checked`);
  };

  const lifecycle = async () => {
    const summary = await runLifecycle();
    if (summary.moved.length > 0) log.info(`${summary.moved.length} link(s) lapsed or withdrawn`);
    if (summary.stoppedBy) log.warn(`lifecycle pass stopped by ${summary.stoppedBy}; the rest wait for the next run`);
  };

  return [
    { name: 'payment-poll', intervalMs: pollIntervalMs, bootDelayMs: POLL_BOOT_DELAY_MS, run: exclusive(poll, 'poll pass') },
    { name: 'payment-link-lifecycle', intervalMs: LIFECYCLE_INTERVAL_MS, bootDelayMs: LIFECYCLE_INTERVAL_MS, run: exclusive(lifecycle, 'lifecycle pass') },
  ];
}

module.exports = { createPaymentJobs, LIFECYCLE_INTERVAL_MS };
