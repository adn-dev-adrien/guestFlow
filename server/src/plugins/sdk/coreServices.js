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
const platformCommission = lazy('../../utils/platformCommission');
const clients = lazy('../../models/clientsModel');
const database = lazy('../../database');
const pricing = lazy('../../utils/pricing');

// specs/gites-de-france-mail-intake.md §4.1 — a plugin changes a reservation the way the operator's
// « Enregistrer » does: the stored state rebuilt as the fiche's PUT body, the patch on top, then the very
// same update path (validation, pricing, history, `reservation.updated`). Only for a stay that has not
// started: past and ongoing stays stay the operator's. `label` adds one history line naming the source.
//
// `client` (SDK 2.7.0, specs/airbnb-mail-intake.md rule 21): the guest's client, found by e-mail or created,
// and set as the fiche's client — in ONE transaction with the update, so a fiche the core refuses leaves no
// client behind holding a guest's personal data. The result then carries `clientId`.
const ROLLBACK = Symbol('rollback');

function applyReservationUpdate(id, patch, label) {
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

function updateReservation(id, patch, { label, client } = {}) {
  if (!client) return applyReservationUpdate(id, patch, label);
  let result = null;
  try {
    database().transaction(() => {
      const own = findOrCreateClient(client);
      result = { ...applyReservationUpdate(id, { ...patch, clientId: own.id }, label), clientId: own.id };
      if (result.status !== 200) throw ROLLBACK;
    })();
  } catch (err) {
    if (err !== ROLLBACK) throw err;
    delete result.clientId;
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

// specs/booking-extranet-intake.md §4.1 — a patch on a client, through the same normalisation as the
// client dialog: the stored fields underneath, the patch on top (an update writes every field).
function updateClient(id, patch) {
  const current = clients().findById(Number(id));
  if (!current) return null;
  return clients().update(Number(id), { ...current, ...patch });
}

module.exports = Object.freeze({
  reservations: Object.freeze({
    getByIdWithDetails: (id) => reservations().getByIdWithDetails(id),
    update: updateReservation,
    suggestBeds,
    platformCommission: (figures) => platformCommission().computePlatformCommission(figures),
    // specs/per-platform-tourist-tax-three-way.md — true in the `platform` mode only: the platform charges
    // the tax and remits it to the commune itself, so its payout leaves it out.
    platformWithholdsTouristTax: (propertyId, platformKey) => pricing().isPlatformCollectingTouristTax(database(), propertyId, platformKey)
      && !pricing().isTouristTaxRemittedByOwner(database(), propertyId, platformKey),
  }),
  clients: Object.freeze({
    findOrCreate: findOrCreateClient,
    update: updateClient,
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
