/**
 * The home's attention payload — which subjects ask for the operator, in which order, with which words
 * (specs/shell-and-home-day-first.md §3.B). Pure: the controller reads each source, this module turns
 * the payloads into `{ pinned, items, total }`.
 *
 * A summary is `{ count, title, detail, severity }`; `null` (or a count under 1) means the subject has
 * nothing to say and is left out.
 */

const SEVERITIES = ['urgent', 'todo', 'info'];

// Decision 2 of the 2026-10-18 review: what can strand a guest or lose money stays unfolded.
const PINNED_KEYS = new Set(['gate-keys', 'payment-deadlines']);

/** « 1 clé » / « 3 clés » — the noun follows the number, the number is always written. */
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

const listOf = (payload, field) => (payload && Array.isArray(payload[field]) ? payload[field] : []);

// The row severities of the payment-deadline card (error / warning / info) in the home's words.
const ROW_SEVERITY = { error: 'urgent', warning: 'todo', info: 'info' };

/** The core subjects' summaries, keyed like the client components that unfold them. */
const CORE_SUMMARIES = {
  'payment-deadlines': (payload) => {
    const rows = listOf(payload, 'rows');
    if (!rows.length) return null;
    const late = rows.filter((row) => !String(row.state || '').endsWith('_to_request')).length;
    const toRequest = rows.length - late;
    const worst = ['error', 'warning', 'info'].find((level) => rows.some((row) => row.severity === level)) || 'warning';
    return {
      count: rows.length,
      title: 'Échéances de paiement',
      detail: [late ? `${late} en retard` : null, toRequest ? `${toRequest} à demander` : null].filter(Boolean).join(' · '),
      severity: ROW_SEVERITY[worst],
    };
  },
  'ical-date-drift': (payload) => {
    const n = listOf(payload, 'alerts').length;
    return n ? { count: n, title: 'Dates iCal à valider', detail: plural(n, 'changement de dates', 'changements de dates'), severity: 'todo' } : null;
  },
  'ical-cancellation': (payload) => {
    const n = listOf(payload, 'alerts').length;
    return n ? {
      count: n,
      title: 'Annulations iCal à valider',
      detail: `${plural(n, 'réservation annulée', 'réservations annulées')} sur la plateforme`,
      severity: 'todo',
    } : null;
  },
  'cancellation-compensations': (payload) => {
    const n = listOf(payload, 'pending').length;
    return n ? { count: n, title: 'Indemnités d’annulation en attente', detail: plural(n, 'versement attendu', 'versements attendus'), severity: 'todo' } : null;
  },
  'repaired-reservation-numbers': (payload) => {
    const n = listOf(payload, 'alerts').length;
    return n ? {
      count: n,
      title: 'Réservations restées sans numéro',
      detail: 'Un séjour fantôme bloque ses dates : vérifier qu’il s’agit d’un vrai séjour.',
      severity: 'todo',
    } : null;
  },
  'email-readiness': (payload) => {
    const n = Number(payload && payload.soonCount) || 0;
    return n > 0 ? {
      count: n,
      title: 'Emails incomplets',
      detail: `${plural(n, 'point', 'points')} à compléter avant les prochaines arrivées`,
      severity: 'todo',
    } : null;
  },
  'new-reservations': (payload) => {
    const n = listOf(payload, 'alerts').length;
    return n ? { count: n, title: 'Nouvelles réservations', detail: 'Sur les dernières 24 h', severity: 'info' } : null;
  },
  'email-pending': (payload) => {
    const rows = Array.isArray(payload) ? payload : [];
    if (!rows.length) return null;
    const noAddress = rows.filter((row) => !row.clientEmail).length;
    return {
      count: rows.length,
      title: 'Emails à vérifier',
      detail: [
        `${plural(rows.length, 'message', 'messages')} à envoyer`,
        noAddress ? `${plural(noAddress, 'client', 'clients')} sans adresse` : null,
      ].filter(Boolean).join(' · '),
      severity: 'info',
    };
  },
  'update-available': (info) => {
    if (!info || !info.updateAvailable || info.updateInProgress) return null;
    if (info.dismissedVersion && info.dismissedVersion === info.latest) return null;
    return { count: 1, title: `GuestFlow ${info.latest} disponible`, detail: `Version installée : ${info.current}`, severity: 'info' };
  },
  'two-factor': (status) => (status && status.nudge
    ? { count: 1, title: 'Second code de connexion', detail: 'Protéger le compte par un second code', severity: 'info' }
    : null),
};

/** A summary is usable when it has a positive whole count, words and a known severity. */
function isUsable(summary) {
  return Boolean(summary)
    && Number.isInteger(summary.count) && summary.count > 0
    && typeof summary.title === 'string' && summary.title.length > 0
    && SEVERITIES.includes(summary.severity);
}

/**
 * entries: [{ key, rank, summary }] → { pinned, items, total }. Ordered by severity, then rank, then
 * key (a stable tie-break); `total` counts the box only (rule 5).
 */
function buildAttention(entries) {
  const subjects = (entries || [])
    .filter((entry) => entry && entry.key && isUsable(entry.summary))
    .map((entry) => ({
      key: entry.key,
      rank: Number.isFinite(entry.rank) ? entry.rank : 1000,
      severity: entry.summary.severity,
      count: entry.summary.count,
      title: entry.summary.title,
      detail: entry.summary.detail || '',
    }))
    .sort((a, b) => (SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity))
      || (a.rank - b.rank)
      || a.key.localeCompare(b.key));
  const strip = ({ rank, ...subject }) => subject; // eslint-disable-line no-unused-vars
  const pinned = subjects.filter((s) => PINNED_KEYS.has(s.key)).map(strip);
  const items = subjects.filter((s) => !PINNED_KEYS.has(s.key)).map(strip);
  return { pinned, items, total: items.reduce((sum, s) => sum + s.count, 0) };
}

module.exports = { SEVERITIES, PINNED_KEYS, CORE_SUMMARIES, plural, buildAttention, isUsable };
