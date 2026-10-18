/**
 * The host side of a customer's life (specs/hosting-h1-fleet-runtime.md rules 1–7): the creation
 * steps, run in order and shown live, then stopping (deprovisioning), restarting (reactivation),
 * renaming and erasing — every one through the drivers (H-D6), none by hand.
 *
 * Every step is idempotent — a directory that exists, a port already taken by this customer, a
 * secret already written, a unit already enabled are left as they are — so « Reprendre » after a
 * failure simply runs the sequence again from the failed step, and never duplicates anything.
 * One customer runs one sequence at a time; a second request waits for the first.
 */

const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const path = require('path');
const { readEnv, writeEnv, buildEnv, newSecrets, secretsOf, LEGACY_ENV_FILE } = require('./instanceEnv');
const { waitHealthy } = require('./health');
const { shareDatabase } = require('./instanceFiles');

// Rule 1, in order. The licence (control-plane rule 9) needs the data directory; the first
// administrator is created before the process ever starts, so the seeded bootstrap account of a
// new database is never reachable from outside (decided 2026-10-08 with H1).
const CREATE_STEPS = [
  { step: 'dir', label: 'Dossier, données et fichier d’environnement' },
  { step: 'secrets', label: 'Clé de chiffrement et secret de session' },
  { step: 'port', label: 'Port' },
  { step: 'licence', label: 'Licence signée' },
  { step: 'database', label: 'Base initialisée' },
  { step: 'admin', label: 'Premier compte administrateur et invitation' },
  { step: 'process', label: 'Processus' },
  { step: 'route', label: 'Route et certificat TLS' },
  { step: 'health', label: 'Contrôle de santé' },
  { step: 'backup', label: 'Sauvegarde continue' },
];
const DEPROVISION_STOP = { step: 'deprov-stop', label: 'Processus et route arrêtés, page « Cet espace a été fermé »' };
const RESTART = { step: 'restart', label: 'Processus et route relancés depuis le dossier' };
const RENAME = { step: 'rename', label: 'Dossier renommé, processus et route relancés, redirection 301 posée' };
const PROCESS_RESTART = { step: 'process-restart', label: 'Processus redémarré' };
const REDIRECT_DAYS = 90;

function parseRange(text) {
  const m = String(text || '').match(/^(\d{2,5})-(\d{2,5})$/);
  if (!m || Number(m[1]) > Number(m[2])) return [4400, 4499];
  return [Number(m[1]), Number(m[2])];
}

// A port another program listens on is skipped: the console is not alone on a laptop.
function portIsFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.listen(port, '127.0.0.1', () => srv.close(() => resolve(true)));
  });
}

function addDaysIso(day, n) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function createProvisioner({
  models, drivers, releases, instances, now, fetchImpl = fetch, hooks,
  portRange = '4400-4499', healthTimeoutMs = 60000, licencePublicKey = null, isPortFree = portIsFree, today,
  publicUrlOf = () => null, registryUrl = null,
}) {
  const { customers, provisioning, hosting } = models;
  const [portLo, portHi] = parseRange(portRange);
  const runs = new Map();
  const stamp = () => now().toISOString();

  // The shape every driver works on.
  function instanceOf(c, slug = c.slug) {
    const row = hosting.get(c.id) || {};
    return {
      customerId: c.id,
      key: `c${c.id}`,
      slug,
      dir: instances.dirOf(slug),
      envFile: instances.envFileOf(slug),
      dbPath: instances.dbPath(slug),
      port: row.port || null,
      version: row.version || null,
    };
  }

  // The env file, rewritten whole from the console's records; only the secrets are carried over.
  function syncEnv(c, inst = instanceOf(c)) {
    migrateLegacyEnv(inst);
    const existing = readEnv(inst.envFile) || {};
    const secrets = secretsOf(existing);
    // The header Caddy adds and the instance checks before believing X-Forwarded-* (rule 21).
    const proxySecret = existing.GUESTFLOW_PROXY_SECRET || crypto.randomBytes(24).toString('base64url');
    return writeEnv(inst.envFile, buildEnv({
      inst,
      releasesDir: releases.dir,
      secrets,
      licencePublicKey,
      publicUrl: publicUrlOf(inst.slug),
      registryUrl,
      extra: { ...drivers.proxy.instanceEnv(), ...drivers.mail.envFor(inst), GUESTFLOW_PROXY_SECRET: proxySecret },
    }));
  }

  // An instance created before 2026-10-17 kept its env file in its own directory, where the instance
  // could rewrite what PID 1 reads as root: moved once to the console's envs/ directory (M2).
  function migrateLegacyEnv(inst) {
    const legacy = path.join(inst.dir, LEGACY_ENV_FILE);
    if (!fs.existsSync(legacy)) return;
    if (!fs.existsSync(inst.envFile)) {
      const vars = readEnv(legacy);
      if (vars) writeEnv(inst.envFile, vars);
    }
    fs.rmSync(legacy, { force: true });
  }

  async function allocatePort(c) {
    const row = hosting.ensure(c.id);
    if (row.port) return row.port;
    // Two customers created at once may pick the same free port: the UNIQUE column decides, and
    // the loser takes the next one (review 2026-10-17).
    for (let p = portLo; p <= portHi; p += 1) {
      if (hosting.usedPorts().has(p) || !(await isPortFree(p))) continue;
      try {
        hosting.set(c.id, { port: p });
        return p;
      } catch (err) {
        if (err.code !== 'SQLITE_CONSTRAINT_UNIQUE') throw new Error(`Port ${p} impossible à réserver : ${err.message}`);
      }
    }
    throw new Error(`Plage de ports ${portLo}-${portHi} épuisée.`);
  }

  // The health check of rules 1.7, 4 and 5; an instance whose process already exited fails at once.
  function healthy(inst) {
    const gone = async () => ((await drivers.process.state(inst)) === 'failed' ? 'le processus s’est arrêté au démarrage' : null);
    return waitHealthy({ url: drivers.proxy.healthUrl(inst), expectVersion: inst.version, timeoutMs: healthTimeoutMs, fetchImpl, gone });
  }

  const RUNNERS = {
    async dir(c) {
      const inst = instanceOf(c);
      for (const sub of ['data', 'uploads', 'logs']) fs.mkdirSync(path.join(inst.dir, sub), { recursive: true });
      hosting.ensure(c.id);
      syncEnv(c);
      // specs/control-plane-plans-and-access.md rule 38 — no host path on the customer page.
      return 'Créés.';
    },
    async secrets(c) {
      const inst = instanceOf(c);
      migrateLegacyEnv(inst);
      const env = readEnv(inst.envFile);
      if (secretsOf(env)) return 'Déjà présents.';
      writeEnv(inst.envFile, { ...(env || {}), ...newSecrets() });
      syncEnv(c);
      return 'Générés.';
    },
    async port(c) {
      const port = await allocatePort(c);
      syncEnv(c);
      return String(port);
    },
    async licence(c) {
      const result = hooks.licence(c.id);
      if (!result.written) throw new Error(result.reason);
      return 'Écrite.';
    },
    async database(c) {
      const row = hosting.ensure(c.id);
      const version = row.version || releases.newest();
      if (!version || !releases.has(version)) throw new Error('Aucune version installée sur l’hôte : en installer une depuis « Versions ».');
      if (!row.version) hosting.set(c.id, { version });
      syncEnv(c);
      await drivers.process.initDatabase(instanceOf(c));
      shareDatabase(instanceOf(c).dbPath);
      return `Version ${version}`;
    },
    async admin(c) {
      const detail = await hooks.admin(c.id);
      shareDatabase(instanceOf(c).dbPath);
      return detail;
    },
    async process(c) {
      await drivers.process.enableNow(instanceOf(c));
      hosting.set(c.id, { unit_state: 'running' });
      return 'En marche.';
    },
    async route(c) {
      const inst = instanceOf(c);
      await drivers.proxy.writeSite(inst);
      return `${inst.slug} → port ${inst.port}`;
    },
    async health(c) {
      const inst = instanceOf(c);
      // Resumed after a failed start: the unit is started again (systemd would, on its own).
      if ((await drivers.process.state(inst)) !== 'running') await drivers.process.start(inst);
      const res = await healthy(inst);
      if (!res.ok) throw new Error(`${res.error.charAt(0).toUpperCase()}${res.error.slice(1)}.`);
      return `${res.version} répond.`;
    },
    async backup(c) {
      await drivers.backup.addReplica(instanceOf(c));
      hosting.set(c.id, { last_backup_at: await drivers.backup.lastReplicatedAt(instanceOf(c)).catch(() => null) });
      return 'Réplique ajoutée.';
    },
  };

  async function runStep(c, def, run) {
    provisioning.set(c.id, def.step, 'running', '', stamp());
    try {
      const detail = await run(c);
      provisioning.set(c.id, def.step, 'ok', detail || '', stamp());
      return true;
    } catch (err) {
      provisioning.set(c.id, def.step, 'failed', err.message, stamp());
      hooks.journal(c.id, 'système', 'step', `Étape « ${def.label} » en échec : ${err.message}`);
      return false;
    }
  }

  // One sequence per customer at a time.
  function exclusive(customerId, fn) {
    const previous = runs.get(customerId) || Promise.resolve();
    const next = previous.catch(() => {}).then(fn);
    runs.set(customerId, next);
    next.finally(() => { if (runs.get(customerId) === next) runs.delete(customerId); }).catch(() => {});
    return next;
  }

  // Rules 1–2: the creation sequence from the first step that is not done; a failure stops it.
  function create(customerId) {
    return exclusive(customerId, async () => {
      for (const def of CREATE_STEPS) {
        const c = customers.get(customerId);
        if (!c || c.erasedAt || c.archivedAt) return false;
        const row = provisioning.get(customerId, def.step);
        if (row && row.status === 'ok') continue;
        if (!(await runStep(c, def, RUNNERS[def.step]))) return false;
      }
      return true;
    });
  }

  // The steps not run yet are shown as « to do » from the first second.
  function plan(customerId) {
    for (const def of CREATE_STEPS) {
      if (!provisioning.get(customerId, def.step)) provisioning.set(customerId, def.step, 'todo', '', stamp());
    }
  }

  // Rule 22: a step still « running » when the console starts was cut short by the restart; it
  // becomes a failed step, so « Reprendre » is offered instead of a customer blocked forever.
  function recover() {
    const stuck = provisioning.running();
    for (const row of stuck) {
      provisioning.set(row.customerId, row.step, 'failed', 'Console redémarrée pendant l’étape.', stamp());
    }
    return stuck.length;
  }

  const running = (customerId) => runs.has(customerId);
  const whenIdle = (customerId) => (runs.get(customerId) || Promise.resolve()).catch(() => {});

  // Rule 3: unit stopped and disabled, the closed page, replication stopped (the copies stay).
  function stop(customerId) {
    return exclusive(customerId, async () => {
      const c = customers.get(customerId);
      return runStep(c, DEPROVISION_STOP, async () => {
        const inst = instanceOf(c);
        if (!fs.existsSync(inst.dir)) {
          await drivers.proxy.writeClosed(c.slug);
          return 'Aucune instance : page « Cet espace a été fermé » posée.';
        }
        await drivers.process.disableNow(inst);
        await drivers.proxy.writeClosed(c.slug);
        await drivers.backup.removeReplica(inst);
        hosting.set(c.id, { unit_state: 'stopped', down_since: null });
        return 'Processus arrêté, page « Cet espace a été fermé » posée.';
      });
    });
  }

  // Rule 4: the unit again, the site again, the replica again — then the health check.
  function restart(customerId) {
    return exclusive(customerId, async () => {
      const c = customers.get(customerId);
      return runStep(c, RESTART, async () => {
        const inst = instanceOf(c);
        if (!fs.existsSync(inst.dir) || !inst.port) {
          await drivers.proxy.remove(c.slug);
          return 'Aucune instance à relancer.';
        }
        syncEnv(c);
        await drivers.process.enableNow(inst);
        await drivers.proxy.writeSite(inst);
        await drivers.backup.addReplica(inst);
        hosting.set(c.id, { unit_state: 'running' });
        const res = await healthy(inst);
        if (!res.ok) throw new Error(`Contrôle de santé : ${res.error}.`);
        return `${res.version} répond.`;
      });
    });
  }

  // Rule 29: a process that failed (or no longer answers) is restarted, then checked; the env file
  // is rewritten first, so the restart also picks up what the console writes now.
  function restartProcess(customerId) {
    return exclusive(customerId, async () => {
      const c = customers.get(customerId);
      return runStep(c, PROCESS_RESTART, async () => {
        const inst = instanceOf(c);
        if (!fs.existsSync(inst.dir) || !inst.port) throw new Error('Aucune instance à redémarrer.');
        syncEnv(c);
        await drivers.process.restart(inst);
        hosting.set(c.id, { unit_state: 'running' });
        const res = await healthy(inst);
        if (!res.ok) {
          hosting.set(c.id, { unit_state: (await drivers.process.state(inst).catch(() => 'failed')) || 'failed' });
          throw new Error(`Contrôle de santé : ${res.error}.`);
        }
        hosting.set(c.id, { down_since: null });
        return `${res.version} répond.`;
      });
    });
  }

  // Rule 5: the directory moves, the unit runs under the new slug, the new site is added, and the
  // old address answers 301 for 90 days. `c.slug` is already the new one.
  function rename(customerId, oldSlug) {
    return exclusive(customerId, async () => {
      const c = customers.get(customerId);
      return runStep(c, RENAME, async () => {
        const from = instanceOf(c, oldSlug);
        const to = instanceOf(c);
        const until = addDaysIso(today(), REDIRECT_DAYS);
        if (fs.existsSync(from.dir)) {
          // The unit goes, its identity stays: the files keep their owner (rule 21).
          await drivers.process.remove(from, { keepIdentity: true });
          if (fs.existsSync(to.dir)) throw new Error(`Le dossier ${to.dir} existe déjà.`);
          fs.renameSync(from.dir, to.dir);
        }
        if (fs.existsSync(from.envFile) && !fs.existsSync(to.envFile)) fs.renameSync(from.envFile, to.envFile);
        if (!fs.existsSync(to.dir) || !to.port) {
          await drivers.proxy.writeRedirect(oldSlug, c.slug);
          hosting.addRedirect(oldSlug, c.id, until);
          return 'Aucune instance à déplacer ; redirection posée.';
        }
        syncEnv(c);
        await drivers.process.enableNow(to);
        await drivers.proxy.writeSite(to);
        await drivers.proxy.writeRedirect(oldSlug, c.slug);
        hosting.addRedirect(oldSlug, c.id, until);
        await drivers.backup.addReplica(to);
        const res = await healthy(to);
        if (!res.ok) throw new Error(`Contrôle de santé : ${res.error}.`);
        return `${oldSlug}/ → ${c.slug}/ ; ${oldSlug} redirige jusqu’au ${until.split('-').reverse().join('/')}.`;
      });
    });
  }

  // Rule 6: with the erasure of control-plane rule 20 go the unit, the site, the replica and the
  // environment file (the directory itself is removed by the eraser).
  async function erase(customerId) {
    const c = customers.get(customerId);
    const inst = instanceOf(c);
    await drivers.process.remove(inst).catch(() => {});
    await drivers.proxy.remove(c.slug);
    for (const r of hosting.redirectsOf(c.id)) {
      await drivers.proxy.remove(r.slug);
      hosting.dropRedirect(r.slug);
    }
    await drivers.backup.purge(inst);
    fs.rmSync(inst.envFile, { force: true });
    fs.rmSync(path.join(inst.dir, LEGACY_ENV_FILE), { force: true });
    hosting.remove(c.id);
  }

  // The 301 of an old address ends after its 90 days (rule 5).
  async function dropExpiredRedirects() {
    const expired = hosting.expiredRedirects(today());
    for (const r of expired) {
      await drivers.proxy.remove(r.slug);
      hosting.dropRedirect(r.slug);
    }
    return expired.length;
  }

  return {
    CREATE_STEPS,
    DEPROVISION_STOP,
    RESTART,
    RENAME,
    PROCESS_RESTART,
    REDIRECT_DAYS,
    instanceOf,
    syncEnv,
    exclusive,
    recover,
    plan,
    create,
    stop,
    restart,
    restartProcess,
    rename,
    erase,
    running,
    whenIdle,
    dropExpiredRedirects,
  };
}

module.exports = { createProvisioner, CREATE_STEPS, parseRange, portIsFree };
