#!/usr/bin/env node
/**
 * stop-dev — free the GuestFlow dev ports.
 *
 * Kills whatever process is LISTENING on the app's dev ports (client Vite :3000,
 * API :4000), so a stale `npm run dev` left running by either of us can't block a
 * fresh start ("port already in use").
 *
 * Run it with:  npm run stop
 *
 * Notes:
 *   - Pure Node + `lsof` (present on macOS and the Raspberry Pi / Linux). No deps.
 *   - Idempotent: ports already free → nothing to do, exits 0.
 *   - Override the ports with args or PORTS env, e.g. `npm run stop -- 3000 4000 5000`
 *     or `PORTS=3000,4000 npm run stop`.
 */

import { execFileSync } from 'node:child_process';

// Keep in sync with client/vite.config.js (server.port) and server/src/index.js (PORT).
const DEFAULT_PORTS = [3000, 4000];

function resolvePorts() {
  const fromArgs = process.argv.slice(2);
  const fromEnv = (process.env.PORTS || '').split(',');
  const raw = (fromArgs.length ? fromArgs : fromEnv).map((p) => Number(String(p).trim())).filter((p) => Number.isInteger(p) && p > 0);
  return raw.length ? [...new Set(raw)] : DEFAULT_PORTS;
}

// PIDs LISTENING on a TCP port (empty when the port is free). `lsof` exits non-zero
// when it finds nothing — treat that as "no PID", not an error.
function listeningPids(port) {
  try {
    const out = execFileSync('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' });
    return [...new Set(out.split('\n').map((s) => s.trim()).filter(Boolean).map(Number))];
  } catch {
    return [];
  }
}

function kill(pid, signal) {
  try { process.kill(pid, signal); return true; } catch { return false; }
}

const ports = resolvePorts();
let killedAny = false;

for (const port of ports) {
  const pids = listeningPids(port);
  if (pids.length === 0) {
    console.log(`port ${port} : libre`);
    continue;
  }
  for (const pid of pids) {
    kill(pid, 'SIGTERM');
  }
  // Give them a beat to exit cleanly, then SIGKILL whatever is still holding the port.
  const deadline = Date.now() + 1500;
  while (Date.now() < deadline && listeningPids(port).length > 0) { /* spin briefly */ }
  for (const pid of listeningPids(port)) {
    kill(pid, 'SIGKILL');
  }
  const survivors = listeningPids(port);
  if (survivors.length === 0) {
    console.log(`port ${port} : arrêté (PID ${pids.join(', ')})`);
    killedAny = true;
  } else {
    console.error(`port ${port} : ÉCHEC, encore occupé par PID ${survivors.join(', ')} (droits insuffisants ?)`);
    process.exitCode = 1;
  }
}

if (!killedAny && process.exitCode !== 1) {
  console.log('Rien à arrêter — tous les ports de dev sont déjà libres.');
}
