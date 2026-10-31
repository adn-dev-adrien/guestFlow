/**
 * Preloaded (`node --require`) by the server and control-plane `npm test` scripts —
 * specs/server-test-isolation.md rule 5. In each test file's child process, once the file's last test
 * has been reported, the process gets a grace period to exit by itself; past it, a handle left open (a
 * listening server, an interval, typically behind a timed-out test on Node 24) is what keeps it alive,
 * so the watchdog names the file and exits 1, and the run fails instead of stalling until the CI
 * cancels the job.
 *
 * It replaces `--test-force-exit`, which exited the child as soon as the runner believed the file
 * finished, and under load that was before its last tests (audit R9 M-1, rule 10).
 *
 * `GUESTFLOW_TEST_EXIT_GRACE_MS` overrides the 30 s grace (the rule 5 tests use 300 ms). The runner's
 * own process (no `NODE_TEST_CONTEXT`) is left alone.
 */
if (process.env.NODE_TEST_CONTEXT) {
  const path = require('node:path');
  const graceMs = Number(process.env.GUESTFLOW_TEST_EXIT_GRACE_MS) || 30000;
  require('node:test').after(() => {
    setTimeout(() => {
      const file = path.relative(process.cwd(), process.argv[1] || '<unknown file>');
      process.stderr.write(`${file} is still running ${graceMs} ms after its last test: a handle it left open (a server, an interval, a socket) keeps it alive.\n`);
      process.exit(1);
    }, graceMs).unref();
  });
}
