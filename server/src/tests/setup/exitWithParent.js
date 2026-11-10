/**
 * specs/server-test-isolation.md rule 18 (audit R37-S2) — an app a test file starts stops with that file. The child
 * gets an IPC channel from its parent; the channel closes when the parent dies, however it dies (`--test-timeout`, the
 * exit watchdog, a SIGKILL), and the child leaves at once instead of running on under ppid 1. Required first by
 * inputShapeAppChild.js, and preloaded (`-r`) by a test spawning `src/index.js` with an 'ipc' stdio slot.
 */
if (process.channel) process.on('disconnect', () => process.exit(0));
