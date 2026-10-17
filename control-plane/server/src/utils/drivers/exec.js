/**
 * The one way the drivers run a host command (specs/hosting-h1-fleet-runtime.md H-D6). Injected, so
 * the tests assert the exact command lines without running systemctl, caddy, litestream or rclone.
 *
 *   exec(file, args, { env, timeout }) → Promise<{ stdout, stderr }>
 *
 * A failure rejects with the command's last stderr line as its message — that is what the step
 * shows the operator (a Caddy refusal, a systemd error).
 */

const { execFile } = require('child_process');

function createExec({ timeoutMs = 120000 } = {}) {
  return function exec(file, args = [], { env, timeout = timeoutMs } = {}) {
    return new Promise((resolve, reject) => {
      execFile(file, args, { env: env || process.env, timeout, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) {
          const lines = String(stderr || '').trim().split('\n').filter(Boolean);
          const e = new Error(lines.length ? lines[lines.length - 1] : err.message);
          e.stderr = String(stderr || '');
          e.stdout = String(stdout || '');
          return reject(e);
        }
        return resolve({ stdout: String(stdout), stderr: String(stderr) });
      });
    });
  };
}

// `sudo -n systemctl` → ['sudo', ['-n', 'systemctl']]: a configured command prefix, split once.
function splitCommand(command) {
  const parts = String(command).trim().split(/\s+/).filter(Boolean);
  return { file: parts[0], prefix: parts.slice(1) };
}

module.exports = { createExec, splitCommand };
