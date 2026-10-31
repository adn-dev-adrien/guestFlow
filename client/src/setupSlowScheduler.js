// Race sweep (specs/server-test-isolation.md rule 11): loaded before React by
// vitest.slow-scheduler.config.js only. React's scheduler posts its tasks — passive effects among
// them — with setImmediate under Node; delaying every one of them by SCHED_DELAY ms (default 8)
// replays a busy CI runner, where the testing library's drain timer can fire before an effect runs.
// A test that asserts an effect's outcome without awaiting it fails here every time.
const delay = Number(process.env.SCHED_DELAY || 8);
const setTimeoutReal = globalThis.setTimeout;
let pending = 0;
globalThis.setImmediate = (fn, ...args) => {
  pending += 1;
  return setTimeoutReal((...a) => { pending -= 1; fn(...a); }, delay, ...args);
};

// A task still delayed when the file ends would run after jsdom is gone (« window is not defined »).
if (typeof afterAll === 'function') {
  afterAll(async () => {
    for (let i = 0; pending > 0 && i < 100; i += 1) {
      await new Promise((resolve) => { setTimeoutReal(resolve, delay); });
    }
  });
}
