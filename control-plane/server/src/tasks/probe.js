/**
 * The probe, every minute (specs/hosting-h1-fleet-runtime.md rules 15–17, 20): it measures each
 * instance through the drivers — unit state, health, memory, last replicated backup, certificate,
 * disk, the platform emails of the day — stores what the fleet view shows, and opens or closes the
 * host alerts:
 *
 *   down      the instance does not answer for 3 minutes in a row;
 *   backup    the last replicated backup is older than 1 hour;
 *   disk      the host disk is above 85 %;
 *   cert      a certificate expires within 14 days;
 *   memory    the instance uses more than 90 % of its unit's limit;
 *   mail      the instance reached the platform's daily email limit.
 *
 * (`restore` — a failed weekly restore — is opened and closed by tasks/weeklyRestore.js.)
 */

const fs = require('fs');
const path = require('path');
const { probeOnce } = require('../utils/health');

const DOWN_AFTER_MS = 3 * 60 * 1000;
const BACKUP_MAX_AGE_MS = 60 * 60 * 1000;
const DISK_MAX_RATIO = 0.85;
const CERT_WARN_MS = 14 * 24 * 60 * 60 * 1000;
const MEMORY_MAX_RATIO = 0.9;
const DISK_MEASURE_MS = 60 * 60 * 1000;
// The replica is asked every 5 minutes, not every minute: a listing reads the object storage.
const BACKUP_CHECK_MS = 5 * 60 * 1000;
// Customers probed at once: ~50 instances fit in a round well under the minute.
const CONCURRENCY = 8;

// Asynchronous, so measuring a large uploads folder never blocks the console.
async function dirBytes(dir) {
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    let entries = [];
    try {
      entries = await fs.promises.readdir(d, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile()) {
        try { total += (await fs.promises.stat(p)).size; } catch { /* vanished */ }
      }
    }
  }
  return total;
}

async function inPool(items, size, fn) {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(size, queue.length) }, async () => {
    while (queue.length) await fn(queue.shift());
  });
  await Promise.all(workers);
}

function hostDiskRatio(root) {
  try {
    const s = fs.statfsSync(root);
    return s.blocks ? 1 - s.bavail / s.blocks : null;
  } catch {
    return null;
  }
}

const frDate = (iso) => new Date(iso).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' });

function createProbe({ models, drivers, provisioner, alerts, now, fetchImpl = fetch, root, today, diskRatio = hostDiskRatio, log = (msg) => console.log(msg) }) {
  const { customers, hosting, provisioning } = models;
  const backupCheckedAt = new Map();

  // The customers the probe watches: their process was started at least once.
  function watched() {
    return customers.list().filter((c) => {
      const row = provisioning.get(c.id, 'process');
      return row && row.status === 'ok';
    });
  }

  function toggle(key, on, alert) {
    if (on) alerts.open({ key, ...alert });
    else alerts.close(key);
  }

  async function probeCustomer(c) {
    const inst = provisioner.instanceOf(c);
    const row = hosting.get(c.id) || {};
    const t = now();
    const fields = { probed_at: t.toISOString() };
    const archived = Boolean(c.archivedAt);

    fields.unit_state = await drivers.process.state(inst).catch(() => 'unknown');

    // Rule 16: down for 3 minutes in a row. A deprovisioned customer is stopped on purpose.
    if (!archived) {
      const health = fields.unit_state === 'running' ? await probeOnce({ url: drivers.proxy.healthUrl(inst), fetchImpl, timeoutMs: 3000 }) : { ok: false };
      const downSince = health.ok ? null : (row.down_since || t.toISOString());
      fields.down_since = downSince;
      toggle(`down:${c.id}`, Boolean(downSince) && t - new Date(downSince) >= DOWN_AFTER_MS,
        { customerId: c.id, kind: 'down', text: `${c.companyName} ne répond plus depuis ${downSince ? Math.round((t - new Date(downSince)) / 60000) : 0} minutes.` });
    } else {
      fields.down_since = null;
      alerts.close(`down:${c.id}`);
    }

    // Rule 16: memory above 90 % of the unit's limit.
    const memory = await drivers.process.memory(inst).catch(() => null);
    fields.memory_bytes = memory ? memory.current : null;
    fields.memory_max_bytes = memory ? memory.max : null;
    toggle(`memory:${c.id}`, Boolean(memory && memory.max && memory.current / memory.max > MEMORY_MAX_RATIO),
      { customerId: c.id, kind: 'memory', severity: 'warning', text: `${c.companyName} utilise plus de 90 % de sa mémoire.` });

    // Rule 12 (local driver) and rule 16: the replica's age.
    const backupStep = provisioning.get(c.id, 'backup');
    const checked = backupCheckedAt.get(c.id);
    if (backupStep && backupStep.status === 'ok' && !archived && (!checked || t - checked >= BACKUP_CHECK_MS)) {
      backupCheckedAt.set(c.id, t.getTime());
      await drivers.backup.tick(inst).catch((err) => log(`[probe] ${c.slug} backup: ${err.message}`));
      // The reason a listing failed (keys, network) goes into the alert (review 2026-10-17).
      let why = null;
      const last = await drivers.backup.lastReplicatedAt(inst).catch((err) => { why = err.message; return null; });
      fields.last_backup_at = last || row.last_backup_at || null;
      const reference = last || row.last_backup_at || backupStep.at;
      const when = fields.last_backup_at ? `le ${new Date(fields.last_backup_at).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'short', timeStyle: 'short' })}` : 'jamais';
      toggle(`backup:${c.id}`, t - new Date(reference) > BACKUP_MAX_AGE_MS,
        { customerId: c.id, kind: 'backup', text: `${c.companyName} : dernière sauvegarde répliquée ${when}${why ? ` (${why})` : ''}.` });
    } else if (!backupStep || backupStep.status !== 'ok' || archived) {
      alerts.close(`backup:${c.id}`);
    }

    // Rule 16: a certificate expiring within 14 days.
    const cert = await drivers.proxy.certExpiry(c.slug);
    fields.cert_expires_at = cert;
    toggle(`cert:${c.id}`, Boolean(cert) && !archived && new Date(cert) - t < CERT_WARN_MS,
      { customerId: c.id, kind: 'cert', severity: 'warning', text: `${c.companyName} : certificat expirant le ${cert ? frDate(cert) : '?'}.` });

    // Rule 15: disk use, measured hourly (a walk of the directory is not free).
    if (!row.disk_measured_at || t - new Date(row.disk_measured_at) >= DISK_MEASURE_MS) {
      fields.disk_bytes = await dirBytes(inst.dir);
      fields.disk_measured_at = t.toISOString();
    }

    // Rule 20: the platform emails of the day, and the alert at the limit.
    const day = today();
    const count = drivers.mail.readCount(inst, day);
    hosting.setMailCount(c.id, day, count);
    toggle(`mail:${c.id}`, count >= drivers.mail.dailyLimit,
      { customerId: c.id, kind: 'mail', severity: 'warning', text: `${c.companyName} : limite de ${drivers.mail.dailyLimit} emails par jour atteinte, envois refusés.` });

    hosting.set(c.id, fields);
  }

  async function runOnce() {
    await inPool(watched(), CONCURRENCY, async (c) => {
      try {
        await probeCustomer(c);
      } catch (err) {
        log(`[probe] ${c.slug}: ${err.message}`);
      }
    });
    const ratio = diskRatio(root);
    toggle('disk', ratio !== null && ratio > DISK_MAX_RATIO,
      { kind: 'disk', severity: 'warning', text: `Disque de l’hôte rempli à ${Math.round((ratio || 0) * 100)} %.` });
    return alerts.sendDue();
  }

  return { runOnce, probeCustomer, dirBytes };
}

module.exports = { createProbe, BACKUP_CHECK_MS, CONCURRENCY, DOWN_AFTER_MS, BACKUP_MAX_AGE_MS, DISK_MAX_RATIO, CERT_WARN_MS, MEMORY_MAX_RATIO };
