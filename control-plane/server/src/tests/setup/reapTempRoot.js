/**
 * specs/server-test-isolation.md rule 20 — the reaper of a control-plane test file's temp root (see fileTempRoot.js).
 * `reap(root)` kills every live instance whose `instance.pid` (the `local` process driver's pid file) lies in the root,
 * then removes the root. Run as a script, it waits for its parent's IPC channel to close, then reaps.
 */
const fs = require('node:fs');
const path = require('node:path');

const PID_FILE = 'instance.pid';

function pidFiles(dir, depth = 6) {
  if (depth < 0) return [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  return entries.flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isFile() && e.name === PID_FILE) return [full];
    return e.isDirectory() && !e.isSymbolicLink() ? pidFiles(full, depth - 1) : [];
  });
}

function reap(root) {
  for (const file of pidFiles(root)) {
    let pid = 0;
    try { pid = Number(fs.readFileSync(file, 'utf8')); } catch { /* removed meanwhile */ }
    if (Number.isSafeInteger(pid) && pid > 1) {
      try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
    }
  }
  fs.rmSync(root, { recursive: true, force: true });
}

if (require.main === module) {
  const root = process.argv[2];
  const done = () => { reap(root); process.exit(0); };
  if (!root || !process.channel) process.exit(0);
  process.on('disconnect', done);
}

module.exports = { reap };
