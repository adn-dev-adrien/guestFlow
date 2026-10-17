/**
 * The `local` process driver (specs/hosting-h1-fleet-runtime.md H-D6): each instance is a child
 * `node <release>/server/src/index.js` started with the variables of its env file — for development
 * and the test suites, where there is no systemd.
 *
 * It behaves like the systemd units it stands for: a pid file says whether the instance runs, an
 * `.enabled` marker whether it should, and `resumeEnabled` starts the enabled ones when the console
 * starts (what systemd does at boot). Children are detached, so restarting the console in
 * development does not take the instances down with it.
 */

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { readEnv } = require('../instanceEnv');

const PID_FILE = 'instance.pid';
const ENABLED_FILE = '.enabled';

function alive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

function createLocalProcessDriver({ releasesDir, nodeBin = process.execPath, stopTimeoutMs = 8000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const pidOf = (inst) => {
    try {
      return Number(fs.readFileSync(path.join(inst.dir, PID_FILE), 'utf8')) || null;
    } catch {
      return null;
    }
  };
  const enabled = (inst) => fs.existsSync(path.join(inst.dir, ENABLED_FILE));
  const running = (inst) => alive(pidOf(inst));

  function childEnv(inst) {
    const env = readEnv(inst.dir);
    if (!env) throw new Error(`Fichier d’environnement introuvable dans ${inst.dir}.`);
    return { PATH: process.env.PATH, HOME: process.env.HOME || inst.dir, ...env };
  }

  function entry(env) {
    const file = path.join(env.GUESTFLOW_RELEASE_DIR || path.join(releasesDir, env.GUESTFLOW_VERSION || ''), 'server', 'src', 'index.js');
    if (!fs.existsSync(file)) throw new Error(`Version ${env.GUESTFLOW_VERSION || '?'} introuvable sur l’hôte.`);
    return file;
  }

  async function start(inst) {
    if (running(inst)) return;
    const env = childEnv(inst);
    const file = entry(env);
    fs.mkdirSync(path.join(inst.dir, 'logs'), { recursive: true });
    const log = fs.openSync(path.join(inst.dir, 'logs', 'instance.log'), 'a');
    try {
      const child = spawn(nodeBin, [file], { cwd: inst.dir, env, detached: true, stdio: ['ignore', log, log] });
      child.unref();
      fs.writeFileSync(path.join(inst.dir, PID_FILE), String(child.pid));
    } finally {
      fs.closeSync(log);
    }
  }

  async function stop(inst) {
    const pid = pidOf(inst);
    if (alive(pid)) {
      try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ }
      const deadline = Date.now() + stopTimeoutMs;
      while (alive(pid) && Date.now() < deadline) await sleep(100);
      if (alive(pid)) {
        try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
        while (alive(pid)) await sleep(50);
      }
    }
    fs.rmSync(path.join(inst.dir, PID_FILE), { force: true });
  }

  return {
    name: 'local',

    // Rule 1.4: the database is created by the instance's own code, run once.
    async initDatabase(inst) {
      const env = childEnv(inst);
      const script = path.join(path.dirname(entry(env)), '..', 'scripts', 'create-first-admin.js');
      const res = spawnSync(nodeBin, [script, '--probe'], { cwd: inst.dir, env, encoding: 'utf8', timeout: 120000 });
      if (res.status !== 0) throw new Error(String(res.stderr || res.error || 'échec').trim().split('\n').pop());
    },

    // Rule 1.5: enabled and started.
    async enableNow(inst) {
      fs.writeFileSync(path.join(inst.dir, ENABLED_FILE), '');
      await start(inst);
    },
    // Rule 3: stopped and disabled.
    async disableNow(inst) {
      fs.rmSync(path.join(inst.dir, ENABLED_FILE), { force: true });
      await stop(inst);
    },
    start,
    stop,
    async restart(inst) {
      await stop(inst);
      await start(inst);
    },
    // Rule 6: nothing left of the unit.
    async remove(inst) {
      await stop(inst);
      fs.rmSync(path.join(inst.dir, ENABLED_FILE), { force: true });
    },

    // running | stopped | failed (enabled but not running) | absent (never installed)
    async state(inst) {
      if (running(inst)) return 'running';
      if (enabled(inst)) return 'failed';
      return fs.existsSync(inst.dir) ? 'stopped' : 'absent';
    },

    // Resident memory of the child; no limit locally, so no « memory » alert.
    async memory(inst) {
      const pid = pidOf(inst);
      if (!alive(pid)) return null;
      const res = spawnSync('ps', ['-o', 'rss=', '-p', String(pid)], { encoding: 'utf8' });
      const kb = Number(String(res.stdout).trim());
      return Number.isFinite(kb) && kb > 0 ? { current: kb * 1024, max: null } : null;
    },

    // What systemd does at boot.
    async resumeEnabled(list) {
      for (const inst of list) {
        if (enabled(inst) && !running(inst)) await start(inst).catch(() => {});
      }
    },
  };
}

module.exports = { createLocalProcessDriver, PID_FILE, ENABLED_FILE };
