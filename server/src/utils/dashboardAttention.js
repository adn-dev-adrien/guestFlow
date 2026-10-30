/**
 * The home's attention payload — which subjects ask for the operator, in which order, with which words
 * (specs/shell-and-home-day-first.md §3.B). Pure: the controller reads each source, this module turns
 * the payloads into `{ pinned, items, total, unavailable, unavailableLabel, declared }`.
 *
 * A summary is `{ count, title, detail, severity, pinned? }`; `null` (or a count under 1) means the
 * subject has nothing to say and is left out. A source that could not be read is never dropped in
 * silence (rule 20): it is named in `unavailable`, or drawn from `FAILURE_SUMMARIES` when missing it
 * would strand a guest.
 */

const { attentionSummary: vatFranchiseSummary } = require('./vatFranchise');

const SEVERITIES = ['urgent', 'todo', 'info'];

// Decision 2 of the 2026-10-18 review: what can strand a guest or lose money stays unfolded. Only
// these keys may be pinned, and only while their summary does not say `pinned: false` (rule 21).
const PINNABLE_KEYS = new Set(['gate-keys', 'payment-deadlines']);

// What a subject becomes when its source cannot be read and silence would cost a guest (rule 20).
const FAILURE_SUMMARIES = {
  'gate-keys': { count: 1, title: 'Clés portail', detail: 'Lecture des clés impossible', severity: 'urgent' },
};

// A payment line that is truly late — not a request still to send, not an amount still to type
// (rule 21).
const OVERDUE_STATES = new Set(['deposit_overdue', 'balance_overdue', 'cancel_due', 'unpaid_at_arrival', 'platform_payout_overdue']);

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
    const state = (row) => String(row.state || '');
    const late = rows.filter((row) => OVERDUE_STATES.has(state(row))).length;
    const toRequest = rows.filter((row) => state(row).endsWith('_to_request')).length;
    const missing = rows.filter((row) => state(row) === 'platform_amount_missing').length;
    const worst = ['error', 'warning', 'info'].find((level) => rows.some((row) => row.severity === level)) || 'warning';
    return {
      count: rows.length,
      title: 'Échéances de paiement',
      detail: [
        late ? `${late} en retard` : null,
        toRequest ? `${toRequest} à demander` : null,
        missing ? `${plural(missing, 'montant à saisir', 'montants à saisir')}` : null,
      ].filter(Boolean).join(' · '),
      severity: ROW_SEVERITY[worst],
      // Unfolded above the day only while something is truly late; otherwise a row of the box.
      pinned: late > 0,
    };
  },
  'vat-franchise': (payload) => vatFranchiseSummary(payload),
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
  'plugins-switched-off': (payload) => {
    const items = listOf(payload, 'items');
    if (!items.length) return null;
    return {
      count: items.length,
      title: items.length === 1
        ? `${items[0].name} éteint : nécessite ${items[0].requires}${items[0].need ? ` ${items[0].need}` : ''}.`
        : `Plugins éteints : ${items.length}`,
      detail: items.every((i) => i.need)
        ? `À mettre à jour puis réactiver ${payload.managed ? 'par l’exploitant' : 'depuis la page Plugins'}.`
        : `À réactiver ${payload.managed ? 'par l’exploitant' : 'depuis la page Plugins'}`,
      severity: 'todo',
    };
  },
  'two-factor': (status) => (status && status.nudge
    ? { count: 1, title: 'Validation en deux étapes', detail: 'Compte protégé par le seul mot de passe.', severity: 'info' }
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
 * entries: [{ key, rank, summary, failed? }] → { pinned, items, total, unavailable, unavailableLabel,
 * declared }. Ordered by severity, then rank, then key (a stable tie-break); `total` counts the box
 * only (rule 5); `declared` lists every key that was asked, so the client can tell a subject with
 * nothing to say from a plugin that declares none (rule 22).
 */
function buildAttention(entries) {
  const list = (entries || []).filter((entry) => entry && entry.key);
  const unavailable = [];
  const resolved = list.map((entry) => {
    if (!entry.failed) return entry;
    if (FAILURE_SUMMARIES[entry.key]) return { ...entry, summary: FAILURE_SUMMARIES[entry.key] };
    unavailable.push(entry.key);
    return { ...entry, summary: null };
  });
  const subjects = resolved
    .filter((entry) => isUsable(entry.summary))
    .map((entry) => ({
      key: entry.key,
      rank: Number.isFinite(entry.rank) ? entry.rank : 1000,
      severity: entry.summary.severity,
      count: entry.summary.count,
      title: entry.summary.title,
      detail: entry.summary.detail || '',
      pin: PINNABLE_KEYS.has(entry.key) && entry.summary.pinned !== false,
    }))
    .sort((a, b) => (SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity))
      || (a.rank - b.rank)
      || a.key.localeCompare(b.key));
  const strip = ({ rank, pin, ...subject }) => subject; // eslint-disable-line no-unused-vars
  const pinned = subjects.filter((s) => s.pin).map(strip);
  const items = subjects.filter((s) => !s.pin).map(strip);
  return {
    pinned,
    items,
    total: items.reduce((sum, s) => sum + s.count, 0),
    unavailable,
    unavailableLabel: unavailable.length ? plural(unavailable.length, 'sujet indisponible', 'sujets indisponibles') : '',
    declared: [...new Set(list.map((entry) => entry.key))],
  };
}

module.exports = {
  SEVERITIES, PINNABLE_KEYS, FAILURE_SUMMARIES, OVERDUE_STATES, CORE_SUMMARIES, plural, buildAttention, isUsable,
};
