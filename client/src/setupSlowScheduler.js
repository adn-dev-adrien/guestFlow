// Race sweep (specs/server-test-isolation.md rule 11): loaded before React by
// vitest.slow-scheduler.config.js only. React's scheduler posts its tasks — passive effects among
// them — with setImmediate under Node; delaying every one of them by SCHED_DELAY ms (default 2)
// replays a busy CI runner, where the testing library's drain timer can fire before an effect runs.
// A test that asserts an effect's outcome without awaiting it fails here every time.
const delay = Number(process.env.SCHED_DELAY || 2);
const setTimeoutReal = globalThis.setTimeout;
globalThis.setImmediate = (fn, ...args) => setTimeoutReal(fn, delay, ...args);
