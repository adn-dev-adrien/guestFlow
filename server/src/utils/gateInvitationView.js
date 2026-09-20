/**
 * What guestFlow shows of the gate access (specs/gate-access-sowel-connector.md §3.4).
 *
 * Three surfaces read the same local copy: the email, the SAS and the fiche. None of them reaches
 * the house — it accepts nothing inbound, and that is precisely what used to make emails wait in
 * the previous version. What is displayed here was pushed by the house; when it pushed nothing, we
 * show nothing rather than invent.
 *
 * The rest of the application's tests run on minimal in-memory schemas, so every read here
 * tolerates a missing table and answers « no access » — the same way the arrival-complement detail
 * already does.
 */

const createGateInvitationModel = require('../models/gateInvitationModel');

const PARIS = 'Europe/Paris';
/** The states where there is still something to show the guest. */
const SHOWABLE = new Set(['active', 'scheduled', 'suspended']);

function modelFor(database) {
  return createGateInvitationModel(database || require('../database'));
}

/** The row as it stands, or `null` — including when the table does not exist (test schema). */
function readInvitation(database, reservationId) {
  try {
    return modelFor(database).get(reservationId);
  } catch {
    return null;
  }
}

/**
 * The one a guest may be shown. A deleted, revoked or finished access is not one: printing a dead
 * code in an email is worse than printing nothing at all.
 */
function usableInvitation(database, reservationId) {
  const row = readInvitation(database, reservationId);
  if (!row || !row.code) return null;
  return SHOWABLE.has(String(row.state)) ? row : null;
}

const dateTime = (lang) => new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'fr-FR', {
  timeZone: PARIS, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
});

/** « Du lundi 4 septembre à 16:00 au vendredi 11 septembre à 11:00 ». */
function windowLabel(row, lang = 'fr') {
  if (!row || (!row.validFrom && !row.validUntil)) return '';
  const fmt = dateTime(lang);
  const from = row.validFrom ? fmt.format(new Date(row.validFrom)) : null;
  const to = row.validUntil ? fmt.format(new Date(row.validUntil)) : null;
  if (from && to) return lang === 'en' ? `From ${from} to ${to}` : `Du ${from} au ${to}`;
  if (from) return lang === 'en' ? `From ${from}` : `À partir du ${from}`;
  return lang === 'en' ? `Until ${to}` : `Jusqu'au ${to}`;
}

/** The word the fiche shows, in French, for a state the house pushed. */
const STATE_LABELS = {
  active: 'Actif',
  scheduled: 'À venir',
  suspended: 'Suspendu',
  revoked: 'Révoqué',
  ended: 'Terminé',
  deleted: 'Supprimé dans la liste',
};

/**
 * The fiche's card: what the access is doing right now, with no action at all — the actions live in
 * Sowel, the only place where they can be applied.
 */
function ficheCard(database, reservationId) {
  const row = readInvitation(database, reservationId);
  if (!row) return { configured: false };
  return {
    configured: true,
    state: String(row.state),
    stateLabel: STATE_LABELS[String(row.state)] || String(row.state),
    code: row.code || null,
    url: row.url || null,
    windowLabel: windowLabel(row),
    validFrom: row.validFrom || null,
    validUntil: row.validUntil || null,
    devices: Number(row.devices || 0),
    lastUsedAt: row.lastUsedAt || null,
    receivedAt: row.receivedAt || null,
    // An access deleted from the list has to be visible on the fiche: the guest has nothing left,
    // and the only way to make another is through Sowel.
    deleted: String(row.state) === 'deleted',
  };
}

/**
 * The SAS step: the code in large type, and a QR of the very address the email carries. Flashing it
 * sets the access up with nothing to type.
 *
 * The QR is rendered on demand and is **never** stored, never printed on a PDF, never logged: it is
 * a key for as long as the stay lasts.
 */
async function sasStep(database, reservationId) {
  const row = usableInvitation(database, reservationId);
  if (!row) {
    const known = readInvitation(database, reservationId);
    return {
      status: known ? 'unusable' : 'not_received',
      state: known ? String(known.state) : null,
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
    code: row.code,
    url: row.url || null,
    qrDataUri,
    windowLabel: windowLabel(row),
    devices: Number(row.devices || 0),
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
