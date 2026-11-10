/**
 * specs/server-test-isolation.md rule 20 (audit R39-S1) — rule 18 for the control-plane suite. Preloaded (`--require`)
 * by `npm test` and required first by a test that starts real instances. In a test file's process (`NODE_TEST_CONTEXT`)
 * it gives the file its own temp root (`TMPDIR`, so every `os.tmpdir()` of the file lands in it) and a reaper: the
 * `local` process driver starts instances detached, like the systemd units it stands for, so a file cut off before its
 * `finally` (`--test-timeout`, the exit watchdog, a kill) left its instance running under ppid 1 and its tree (≈ 1.6 GB)
 * on disk. At the file's exit, and from the reaper when the file dies without one, every instance whose pid file sits
 * in the root is killed and the root removed. The runner's own process is left alone.
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { reap } = require('./reapTempRoot');

if (process.env.NODE_TEST_CONTEXT && !process.env.CP_TEST_TEMP_ROOT_OF) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  process.env.TMPDIR = root;
  process.env.CP_TEST_TEMP_ROOT_OF = String(process.pid);
  // The reaper's IPC channel closes when this process dies, however it dies.
  const reaper = spawn(process.execPath, [path.join(__dirname, 'reapTempRoot.js'), root], {
    detached: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], env: { PATH: process.env.PATH },
  });
  reaper.unref();
  reaper.channel.unref();
  process.on('exit', () => reap(root));
}
