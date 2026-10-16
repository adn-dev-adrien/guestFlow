/**
 * `ctx.core` — the ONLY core services a plugin may call (specs/plugins-phase-1-sdk.md rule 11). A
 * plugin needing more asks for it here, in one reviewed place, instead of requiring a core file.
 * Requires are lazy: the plugins register while the core is still booting.
 */

const lazy = (path) => () => require(path);
const reservations = lazy('../../models/reservationsModel');
const settings = lazy('../../models/settingsModel');
const textFormatters = lazy('../../utils/textFormatters');
const pushService = lazy('../../utils/pushService');
const reservationsController = lazy('../../controllers/reservationsController');
const updateBody = lazy('../../utils/reservationUpdateBody');
const reservationHelpers = lazy('../../utils/reservationHelpers');
const bedDistribution = lazy('../../utils/bedDistribution');
const clients = lazy('../../models/clientsModel');
const database = lazy('../../database');

// specs/gites-de-france-mail-intake.md §4.1 — a plugin changes a reservation the way the operator's
// « Enregistrer » does: the stored state rebuilt as the fiche's PUT body, the patch on top, then the very
// same update path (validation, pricing, history, `reservation.updated`). Only for a stay that has not
// started: past and ongoing stays stay the operator's. `label` adds one history line naming the source.
function updateReservation(id, patch, { label } = {}) {
  const current = reservations().getByIdWithDetails(Number(id));
  if (!current || current.kind !== 'reservation') return { status: 404, body: { error: 'Réservation introuvable' } };
  if (String(current.startDate) <= reservationHelpers().getTodayIsoDate()) {
    return { status: 409, body: { error: 'Séjour commencé ou passé', code: 'PAST_RESERVATION' } };
  }
  const autoEnabled = new Set(database().prepare('SELECT id FROM options WHERE COALESCE(autoEnabled, 0) = 1').all().map((o) => o.id));
  const body = { ...updateBody().toUpdateBody(current, autoEnabled), ...patch };
  const result = reservationsController().performUpdate(Number(id), body);
  if (result.status === 200 && label) {
    reservations().addHistoryEntry(Number(id), 'update', [{ field: 'source', label: 'Origine', from: null, to: String(label) }]);
  }
  return result;
}

function suggestBeds(propertyId, { adults, children, teens }) {
  const beds = reservations().getPropertyBeds(Number(propertyId)) || {};
  return bedDistribution().suggestBedDistribution({
    adults, children, teens, maxSingleBeds: beds.singleBeds, maxDoubleBeds: beds.doubleBeds,
  });
}

function findOrCreateClient(payload) {
  return clients().findByEmail(payload.email) || clients().insert(payload);
}

module.exports = Object.freeze({
  reservations: Object.freeze({
    getByIdWithDetails: (id) => reservations().getByIdWithDetails(id),
    update: updateReservation,
    suggestBeds,
  }),
  clients: Object.freeze({
    findOrCreate: findOrCreateClient,
  }),
  settings: Object.freeze({
    companyAddress: () => String(settings().read().companyAddress || ''),
    publicUrl: () => settings().publicUrl(),
    // The mailbox GuestFlow sends from, for a plugin that reads it (same account, IMAP side).
    mailbox: () => {
      const smtp = settings().decryptedSmtpSettings();
      return { host: smtp.host, user: smtp.user, password: smtp.passwordDecryptFailed ? '' : smtp.password };
    },
  }),
  push: Object.freeze({
    sendToUser: (userId, payload) => pushService().sendToUser(userId, payload),
  }),
  text: Object.freeze({
    sentenceCase: (s) => textFormatters().sentenceCase(s),
  }),
});
