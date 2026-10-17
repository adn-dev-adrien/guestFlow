/**
 * What the fleet and the customer page show of an instance (specs/hosting-h1-fleet-runtime.md rule
 * 15): every value comes ready to render — a label, a severity and a sort key — from the `instances`
 * row the probe keeps up to date.
 */

const UNIT = {
  running: { label: 'En marche', severity: 'success' },
  stopped: { label: 'Arrêté', severity: 'neutral' },
  failed: { label: 'En échec', severity: 'error' },
  absent: { label: 'Absent', severity: 'neutral' },
  unknown: { label: 'Inconnu', severity: 'warning' },
};
const HOUR = 3600000;
const DAY = 24 * HOUR;

const paris = (iso, opts) => new Date(iso).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', ...opts });
const frDate = (iso) => (iso ? paris(iso, { day: '2-digit', month: '2-digit', year: 'numeric' }) : null);
const frShort = (iso) => (iso ? paris(iso, { day: '2-digit', month: '2-digit' }) : null);

function ago(iso, now) {
  if (!iso) return null;
  const ms = now - new Date(iso);
  if (ms < 90 * 1000) return 'à l’instant';
  if (ms < HOUR) return `il y a ${Math.round(ms / 60000)} min`;
  if (ms < DAY) {
    const h = Math.floor(ms / HOUR);
    const m = Math.round((ms % HOUR) / 60000);
    return `il y a ${h} h${m ? ` ${String(m).padStart(2, '0')}` : ''}`;
  }
  return `le ${frShort(iso)}`;
}

function megabytes(bytes) {
  if (bytes === null || bytes === undefined) return null;
  const mb = bytes / 1048576;
  return mb < 10 ? `${mb.toFixed(1).replace('.', ',')} Mo` : `${Math.round(mb)} Mo`;
}

// The probe is down « down_since » ago; the unit says the rest.
function processOf(row) {
  if (!row || !row.unit_state || row.unit_state === 'absent') return null;
  const unit = UNIT[row.unit_state] || UNIT.unknown;
  if (row.unit_state === 'running' && row.down_since) return { label: 'Ne répond pas', severity: 'error' };
  return unit;
}

// The fleet row's columns. `null` renders « — ».
function hostColumns(row, now) {
  const t = now.getTime();
  const proc = processOf(row);
  const backupLate = row && row.last_backup_at && t - new Date(row.last_backup_at) > HOUR;
  const certSoon = row && row.cert_expires_at && new Date(row.cert_expires_at) - t < 14 * DAY;
  return {
    version: row ? row.version || null : null,
    process: proc ? proc.label : null,
    processSeverity: proc ? proc.severity : null,
    lastBackup: row ? ago(row.last_backup_at, t) : null,
    lastBackupAt: row ? row.last_backup_at || null : null,
    lastBackupSeverity: backupLate ? 'error' : null,
    verified: row ? frShort(row.last_backup_verified_at) : null,
    verifiedAt: row ? row.last_backup_verified_at || null : null,
    disk: row ? megabytes(row.disk_bytes) : null,
    diskBytes: row ? row.disk_bytes ?? null : null,
    cert: row ? frDate(row.cert_expires_at) : null,
    certAt: row ? row.cert_expires_at || null : null,
    certSeverity: certSoon ? 'warning' : null,
  };
}

// The customer page's « Hébergement » card.
function hostView(c, row, { now, lastCheck, dailyMailLimit, mailToday }) {
  if (!row) return null;
  const cols = hostColumns(row, now);
  const lines = [
    { label: 'Version', value: cols.version },
    { label: 'Port', value: row.port ? String(row.port) : null },
    { label: 'Processus', value: cols.process },
    { label: 'Dernière sauvegarde', value: cols.lastBackup },
    { label: 'Restauration vérifiée', value: lastCheck ? `${frDate(lastCheck.at)} — ${lastCheck.ok ? `${lastCheck.reservations} réservation(s)` : `échec : ${lastCheck.detail}`}` : null },
    { label: 'Disque', value: cols.disk },
    { label: 'Certificat', value: cols.cert ? `expire le ${cols.cert}` : null },
    { label: 'Emails par la plateforme', value: dailyMailLimit ? `${mailToday} / ${dailyMailLimit} aujourd’hui` : null },
  ];
  return {
    ...cols,
    port: row.port || null,
    previousVersion: row.previous_version || null,
    lines,
    canRestore: Boolean(row.version && row.port) && !c.archivedAt,
  };
}

module.exports = { hostColumns, hostView, ago, megabytes, UNIT };
