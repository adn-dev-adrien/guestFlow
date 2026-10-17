/**
 * The application restarts itself after a plugin update (specs/plugins-phase-4-registry.md rule 13).
 *
 * A plugin's server code cannot be unloaded from a running Node process, so an update ends with a
 * graceful shutdown and the supervisor starts the process again: PM2 in production (it sets `pm_id`, and
 * restarts a process that exits), or the E2E harness (`GUESTFLOW_SUPERVISED=1`). Without a
 * supervisor the exit would leave the instance down, so the update is refused before anything moves.
 */

// SIGINT goes through the server's own shutdown (index.js): the HTTP server stops accepting, the
// requests in flight finish, then the process exits — never an abrupt exit mid-request.
const gracefulStop = () => process.kill(process.pid, 'SIGINT');

function createRestarter({ env = process.env, stop = gracefulStop, setTimeoutFn = setTimeout, log = console } = {}) {
  const supervised = env.pm_id !== undefined || env.GUESTFLOW_SUPERVISED === '1';
  return {
    supervised,
    /** Exit after `delayMs`, long enough for the HTTP answer to leave. */
    schedule({ reason = 'plugin update', delayMs = 400 } = {}) {
      if (!supervised) return false;
      log.error(`[GuestFlow][${new Date().toISOString()}][pid:${process.pid}] === RESTART (${reason}) ===`);
      setTimeoutFn(stop, delayMs);
      return true;
    },
  };
}

module.exports = { createRestarter };
