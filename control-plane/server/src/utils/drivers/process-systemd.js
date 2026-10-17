/**
 * The `systemd` process driver (specs/hosting-h1-fleet-runtime.md H-D1): one template unit,
 * `guestflow@.service` (deploy/hosting/), instantiated per slug. The console runs as the `guestflow`
 * user and calls `systemctl` through the sudoers rule the bootstrap installs, limited to these units.
 *
 * Each instance runs as its own user `gf-c<customer id>` (rule 21): keyed on the customer, so a
 * rename keeps it. The root wrapper `guestflow-instance-identity` creates it (primary group
 * `guestflow-app`) and writes the unit's drop-in `User=`; the template itself runs as `nobody`, so a
 * unit without its identity fails closed.
 *
 * The database is initialised by running the instance's own code once, before the unit ever starts
 * (rule 1.4); the file is then shared with the instance's group (utils/instanceFiles.js).
 */

const path = require('path');
const { readEnv } = require('../instanceEnv');
const { splitCommand } = require('./exec');

const unitOf = (slug) => `guestflow@${slug}.service`;

const STATES = { active: 'running', activating: 'running', reloading: 'running', deactivating: 'stopped', failed: 'failed' };

// `systemctl show -p A -p B` → { A: '…', B: '…' }
function parseShow(stdout) {
  const out = {};
  for (const line of String(stdout).split('\n')) {
    const eq = line.indexOf('=');
    if (eq > 0) out[line.slice(0, eq)] = line.slice(eq + 1).trim();
  }
  return out;
}

function stateOf(props) {
  if (props.LoadState === 'not-found') return 'absent';
  if (STATES[props.ActiveState]) return STATES[props.ActiveState];
  return props.UnitFileState === 'enabled' ? 'failed' : 'stopped';
}

const bytes = (v) => (/^\d+$/.test(String(v || '')) ? Number(v) : null);

function createSystemdProcessDriver({
  exec, releasesDir, nodeBin = process.execPath, systemctl = 'sudo -n systemctl', showCommand = 'systemctl',
  identityCommand = 'sudo -n /usr/local/sbin/guestflow-instance-identity',
}) {
  const ctl = splitCommand(systemctl);
  const identity = splitCommand(identityCommand);
  const who = (inst, ...args) => exec(identity.file, [...identity.prefix, ...args]);
  const show = splitCommand(showCommand);
  const run = (...args) => exec(ctl.file, [...ctl.prefix, ...args]);

  async function props(inst) {
    const { stdout } = await exec(show.file, [...show.prefix, 'show', unitOf(inst.slug),
      '-p', 'LoadState', '-p', 'ActiveState', '-p', 'UnitFileState', '-p', 'MemoryCurrent', '-p', 'MemoryMax']);
    return parseShow(stdout);
  }

  return {
    name: 'systemd',
    unitOf,

    async initDatabase(inst) {
      const env = readEnv(inst.envFile);
      if (!env) throw new Error(`Fichier d’environnement introuvable (${inst.envFile}).`);
      const release = env.GUESTFLOW_RELEASE_DIR || path.join(releasesDir, env.GUESTFLOW_VERSION || '');
      await exec(nodeBin, [path.join(release, 'server', 'scripts', 'create-first-admin.js'), '--probe'],
        { env: { PATH: process.env.PATH, ...env }, timeout: 120000 });
    },
    async enableNow(inst) {
      await who(inst, 'ensure', inst.slug, inst.key);
      await run('enable', '--now', unitOf(inst.slug));
    },
    disableNow: (inst) => run('disable', '--now', unitOf(inst.slug)),
    start: (inst) => run('start', unitOf(inst.slug)),
    stop: (inst) => run('stop', unitOf(inst.slug)),
    restart: (inst) => run('restart', unitOf(inst.slug)),
    // `keepIdentity` at a rename: the unit of the old slug goes, the user stays for the new one.
    async remove(inst, { keepIdentity = false } = {}) {
      await run('disable', '--now', unitOf(inst.slug));
      await run('reset-failed', unitOf(inst.slug)).catch(() => {});
      await who(inst, keepIdentity ? 'forget' : 'remove', inst.slug, inst.key);
    },
    async state(inst) {
      return stateOf(await props(inst));
    },
    async memory(inst) {
      const p = await props(inst);
      const current = bytes(p.MemoryCurrent);
      return current === null ? null : { current, max: bytes(p.MemoryMax) };
    },
    // systemd restarts enabled units at boot by itself.
    async resumeEnabled() {},
  };
}

module.exports = { createSystemdProcessDriver, unitOf, parseShow, stateOf };
