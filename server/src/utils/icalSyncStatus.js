/**
 * The status line of an imported calendar (specs/ical-import-hardening.md rule 9).
 *
 * The row used to print the engine's own sentence — « 0 créé(s), 0 mis à jour, 0 verrouillé(s),
 * 0 annulation(s) à valider, 15 inchangé(s) » — with a date and no time, wrapping over three lines on a
 * phone. The line now says when, and only what changed; the full sentence stays available as `detail`
 * for the tooltip. Pure: the row and the clock in, the line out.
 */

const { resolveServerTimezone } = require('./serverTimezone');

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// What the operator acts on, in that order. Unchanged stays, echoes and locked re-reads are routine.
const PARTS = [
  ['created', (n) => plural(n, 'nouvelle', 'nouvelles')],
  ['updated', (n) => plural(n, 'modifiée', 'modifiées')],
  ['takenOver', (n) => plural(n, 'reprise', 'reprises')],
  ['removed', (n) => plural(n, 'annulation à valider', 'annulations à valider')],
  ['conflicts', (n) => `${n} en conflit`],
  ['skippedClosure', (n) => `${n} sur une fermeture`],
  ['repeatedUids', (n) => `${n} au même identifiant`],
];

// SQLite `datetime('now')` is « YYYY-MM-DD HH:MM:SS » in UTC.
function parseSqliteUtc(value) {
  if (!value) return null;
  const date = new Date(`${String(value).trim().replace(' ', 'T')}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function whenLabel(date, now, timeZone) {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const time = new Intl.DateTimeFormat('fr-FR', { timeZone, hour: '2-digit', minute: '2-digit' }).format(date);
  if (day.format(date) === day.format(now)) return `à ${time}`;
  const date2 = new Intl.DateTimeFormat('fr-FR', { timeZone, day: '2-digit', month: '2-digit' }).format(date);
  return `le ${date2} à ${time}`;
}

function changesLabel(counts) {
  if (!counts || typeof counts !== 'object') return '';
  return PARTS
    .filter(([key]) => Number(counts[key]) > 0)
    .map(([key, label]) => label(Number(counts[key])))
    .join(', ');
}

/**
 * @param {{ url?: string, isActive?: boolean|number, lastSyncAt?: string, lastSyncStatus?: string,
 *           lastSyncMessage?: string, syncCounts?: object|null }} row
 * @returns {{ tone: 'manual'|'stopped'|'never'|'error'|'success', text: string, detail: string }}
 */
function describeIcalSync(row, { now = new Date(), timeZone = resolveServerTimezone(process.env.GUESTFLOW_TZ).timezone } = {}) {
  const detail = String(row.lastSyncMessage || '');
  if (!String(row.url || '').trim()) return { tone: 'manual', text: 'Saisie manuelle : pas de synchronisation.', detail: '' };
  if (row.isActive === false || Number(row.isActive) === 0) {
    return { tone: 'stopped', text: 'Calendrier arrêté : plus rien n’est importé.', detail };
  }
  const at = parseSqliteUtc(row.lastSyncAt);
  if (row.lastSyncStatus === 'error') {
    return { tone: 'error', text: `Échec${at ? ` ${whenLabel(at, now, timeZone)}` : ''} : ${detail || 'erreur de synchronisation'}`, detail };
  }
  if (row.lastSyncStatus !== 'success') return { tone: 'never', text: 'Jamais synchronisé', detail: '' };
  const changes = changesLabel(row.syncCounts);
  return {
    tone: 'success',
    text: `Synchronisé${at ? ` ${whenLabel(at, now, timeZone)}` : ''}${changes ? ` · ${changes}` : ''}`,
    detail,
  };
}

module.exports = { describeIcalSync };
