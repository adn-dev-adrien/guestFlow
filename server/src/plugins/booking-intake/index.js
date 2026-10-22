/**
 * Saisie Booking (specs/booking-extranet-intake.md). Booking sends no recap and its extranet sits behind
 * the operator's password and 2FA, so a userscript in the operator's own browser hands the reservation page
 * to GuestFlow, which fills the matching iCal fiche. GuestFlow never holds a Booking credential and never
 * logs in on the operator's behalf.
 */

const crypto = require('crypto');
const { buildModel, TABLE_SQL } = require('./intakesModel');
const { createIntakeService } = require('./intakeService');
const { listPending } = require('./pendingFiches');
const { buildUserscript } = require('./userscript');
const { publicRouter, adminRouter } = require('./routes');

const id = 'booking-intake';

const parseJson = (raw, fallback) => { try { return JSON.parse(raw); } catch { return fallback; } };
const validateHotelIds = (v) => {
  const map = parseJson(v || '{}', null);
  const ok = map && typeof map === 'object' && !Array.isArray(map)
    && Object.entries(map).every(([k, h]) => /^\d+$/.test(k) && /^\d*$/.test(String(h)));
  return ok ? null : 'Un identifiant d’établissement Booking est fait de chiffres.';
};
const validateSourceKeys = (v) => {
  const list = parseJson(v || '[]', null);
  return Array.isArray(list) && list.every((k) => typeof k === 'string' && /^[a-z0-9-]+$/i.test(k)) ? null : 'Liste de sources illisible.';
};

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function register(ctx) {
  ctx.migrations([{ name: 'booking_intakes_tables_v1', up: (db) => db.exec(TABLE_SQL) }]);

  ctx.settings.declare([
    { key: 'hotelIds', default: '{}', validate: validateHotelIds },
    { key: 'sourceKeys', default: '["booking","lodgify"]', validate: validateSourceKeys },
    { key: 'key', secret: true },
  ]);

  let model = null;
  const intakes = () => { if (!model) model = buildModel(ctx.db); return model; };
  const hotelIds = () => parseJson(ctx.settings.get('hotelIds') || '{}', {});

  const newSecret = () => crypto.randomBytes(24).toString('base64url');
  const secret = () => ctx.settings.get('key');
  // Born the first time the script is asked for: nothing is authenticated before that.
  const ensureSecret = () => { if (!secret()) ctx.settings.set('key', newSecret()); return secret(); };

  const service = () => createIntakeService({
    intakes: intakes(),
    hotelIds,
    today: todayIso,
    findReservations: ({ propertyId, startDate, endDate }) => ctx.db
      .prepare("SELECT id FROM reservations WHERE kind = 'reservation' AND propertyId = ? AND startDate = ? AND endDate = ?")
      .all(propertyId, startDate, endDate),
    getReservation: (reservationId) => ctx.core.reservations.getByIdWithDetails(reservationId),
    // Rule 25 — does a reservation other than this one use the client?
    clientShared: (clientId, reservationId) => Boolean(ctx.db
      .prepare('SELECT 1 FROM reservations WHERE clientId = ? AND id != ? LIMIT 1')
      .get(clientId, reservationId == null ? -1 : reservationId)),
    core: {
      updateReservation: ctx.core.reservations.update,
      findOrCreateClient: ctx.core.clients.findOrCreate,
      updateClient: ctx.core.clients.update,
      suggestBeds: ctx.core.reservations.suggestBeds,
      platformCommission: ctx.core.reservations.platformCommission,
      withholdsTouristTax: (propertyId) => ctx.core.reservations.platformWithholdsTouristTax(propertyId, 'booking'),
    },
  });

  const pending = () => listPending({
    db: ctx.db,
    hotelIds: hotelIds(),
    sourceKeys: parseJson(ctx.settings.get('sourceKeys') || '[]', []),
    today: todayIso(),
  });

  ctx.mount('/public/booking-intake', publicRouter({
    secret,
    handlePage: (page) => service().handlePage(page),
    log: (line) => ctx.log.warn(line),
  }), { public: true });

  ctx.mount('/api/booking-intake', adminRouter({
    service,
    pending,
    dismissFiche: (reservationId) => intakes().dismissFiche(reservationId),
    intakeLog: (limit) => intakes().list(limit).map(({ id: rowId, resId, reservationId, status, error, createdAt }) => (
      { id: rowId, resId, reservationId, status, error, createdAt })),
    userscript: () => {
      const publicUrl = ctx.core.settings.publicUrl();
      if (!publicUrl) return { ok: false, error: 'URL publique de GuestFlow non renseignée (Paramètres › Société).' };
      return { ok: true, source: buildUserscript({ publicUrl, secret: ensureSecret() }) };
    },
    regenerateSecret: () => ctx.settings.set('key', newSecret()),
  }));

  ctx.data({
    tables: ['booking_intakes', 'booking_dismissals'],
    purge: () => { model = null; },
    describe: () => {
      const n = intakes().count();
      return n > 0 ? [{ label: n > 1 ? `${n} pages Booking reçues` : '1 page Booking reçue', count: n }] : [];
    },
  });
}

module.exports = { id, register };
