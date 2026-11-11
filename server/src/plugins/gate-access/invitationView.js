/**
 * What guestFlow shows of a stay's gate key (specs/gate-access-sowel-connector.md §3.5).
 *
 * Three surfaces read the same stored result: the email, the SAS and the fiche. None of them reaches
 * the house — it accepts nothing inbound. What is displayed here was reported by the house; when it
 * reported nothing, we show nothing rather than invent.
 *
 * The rest of the application's tests run on minimal in-memory schemas, so every read here
 * tolerates a missing table and answers « no key ».
 */

const createGateKeysModel = require('./keysModel');
const { errorReason } = require('./keys');

const PARIS = 'Europe/Paris';
/** Sowel states in which the key is dead or opens nothing: never shown as usable (rule 28). */
const UNUSABLE_STATES = new Set(['revoked', 'ended', 'no_gate']);

/** The stored result as it stands, or `null` — including when the table does not exist. */
function readInvitation(database, reservationId) {
  try {
    return createGateKeysModel(database).get(reservationId);
  } catch {
    return null;
  }
}

/**
 * The key a guest may be shown: a successful create, still alive, with a code or a link. A dead code
 * in an email is worse than no code at all.
 */
function usableInvitation(database, reservationId) {
  const row = readInvitation(database, reservationId);
  if (!row || String(row.action) !== 'create' || Number(row.ok) !== 1) return null;
  if (UNUSABLE_STATES.has(String(row.state))) return null;
  if (!row.code && !row.url) return null;
  return row;
}

const dateTime = (lang) => new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'fr-FR', {
  timeZone: PARIS, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
});

/** « Du lundi 4 septembre à 16:00 au vendredi 11 septembre à 11:00 ». */
function windowLabel(row, lang = 'fr') {
  if (!row || (!row.startsAt && !row.endsAt)) return '';
  const fmt = dateTime(lang);
  const from = row.startsAt ? fmt.format(new Date(row.startsAt)) : null;
  const to = row.endsAt ? fmt.format(new Date(row.endsAt)) : null;
  if (from && to) return lang === 'en' ? `From ${from} to ${to}` : `Du ${from} au ${to}`;
  if (from) return lang === 'en' ? `From ${from}` : `À partir du ${from}`;
  return lang === 'en' ? `Until ${to}` : `Jusqu'au ${to}`;
}

/** Sowel's access states, in the fiche's words. */
const STATE_LABELS = Object.freeze({
  live: 'Actif',
  outside_hours: 'Hors horaires',
  not_yet: 'À venir',
  ended: 'Terminé',
  suspended: 'Suspendu',
  revoked: 'Révoqué',
  no_gate: 'Sans portail',
});

/**
 * The fiche's card: what the key is doing, or why it could not be made — with no action at all, the
 * actions live in Sowel (rule 26).
 */
function ficheCard(database, reservationId) {
  const row = readInvitation(database, reservationId);
  if (!row) return { configured: false };
  const ok = Number(row.ok) === 1;
  const state = ok ? String(row.state || '') : 'failed';
  return {
    configured: true,
    ok,
    action: String(row.action),
    state,
    stateLabel: ok ? (STATE_LABELS[state] || state || 'Inconnu') : 'Échec',
    reason: ok ? null : errorReason(row),
    code: ok ? row.code || null : null,
    url: ok ? row.url || null : null,
    windowLabel: windowLabel(row),
    receivedAt: row.receivedAt || null,
  };
}

/**
 * The SAS step: the code in large type, and a QR of the very address the email carries (rule 24).
 * The QR is rendered on demand and is never stored, never printed on a PDF, never logged.
 */
async function sasStep(database, reservationId) {
  const row = usableInvitation(database, reservationId);
  if (!row) {
    const known = readInvitation(database, reservationId);
    return {
      status: known ? 'unusable' : 'not_received',
      state: known ? String(known.state || '') : null,
    };
  }
  let qrDataUri = null;
  if (row.url) {
    try {
      const QRCode = require('qrcode');
      qrDataUri = await QRCode.toDataURL(row.url, { margin: 1, width: 440 });
    } catch {
      // A missing QR stops nothing: the code can be dictated and typed.
      qrDataUri = null;
    }
  }
  return {
    status: 'ok',
    code: row.code || null,
    url: row.url || null,
    qrDataUri,
    windowLabel: windowLabel(row),
  };
}

module.exports = {
  readInvitation,
  usableInvitation,
  windowLabel,
  ficheCard,
  sasStep,
  STATE_LABELS,
};
