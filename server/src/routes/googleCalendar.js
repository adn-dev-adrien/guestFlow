const router = require('express').Router();
const db = require('../database');
const {
  getGoogleCalendarConfig,
  getGoogleCalendarClient,
} = require('../utils/googleCalendarClient');
const googleCalendarController = require('../controllers/googleCalendarController');

function formatCountLabel(count, singular, plural) {
  const safe = Number(count || 0);
  return `${safe} ${safe > 1 ? plural : singular}`;
}

function formatOptionQuantity(quantity) {
  const safe = Number(quantity || 0);
  return Number.isInteger(safe) ? String(safe) : safe.toFixed(2).replace(/\.00$/, '');
}

function buildEventTitle(reservation) {
  const propertyName = String(reservation.propertyName || '').trim() || 'Logement';
  const fullName = `${String(reservation.clientLastName || '').trim()} ${String(reservation.clientFirstName || '').trim()}`.trim() || 'Client inconnu';
  return `${propertyName} - ${fullName}`;
}

function buildEventDescription(reservation, options) {
  const adults = Number(reservation.adults || 0);
  const children = Number(reservation.children || 0);
  const teens = Number(reservation.teens || 0);
  const babies = Number(reservation.babies || 0);
  const totalPeople = adults + children + teens + babies;

  const singleBeds = Number(reservation.singleBeds || 0);
  const doubleBeds = Number(reservation.doubleBeds || 0);
  const babyBeds = Number(reservation.babyBeds || 0);

  const optionLines = Array.isArray(options) && options.length > 0
    ? options.map((opt) => `- ${opt.title} x${formatOptionQuantity(opt.quantity)}`)
    : ['- Aucune option'];

  return [
    'Voyageurs',
    `${formatCountLabel(adults, 'adulte', 'adultes')}, ${formatCountLabel(children, 'enfant', 'enfants')}, ${formatCountLabel(teens, 'ado', 'ados')}, ${formatCountLabel(babies, 'bebe', 'bebes')}`,
    `Total: ${totalPeople}`,
    '',
    'Lits',
    `Doubles: ${doubleBeds}`,
    `Simples: ${singleBeds}`,
    `Bebe: ${babyBeds}`,
    '',
    'Options',
    ...optionLines,
  ].join('\n');
}

function buildGoogleEventPayload(reservation, options) {
  // Construire les heures ISO 8601 avec timezone
  const startDateTime = `${reservation.startDate}T${reservation.checkInTime || '15:00'}:00`;
  const endDateTime = `${reservation.endDate}T${reservation.checkOutTime || '10:00'}:00`;

  return {
    summary: buildEventTitle(reservation),
    description: buildEventDescription(reservation, options),
    start: {
      dateTime: startDateTime,
      timeZone: 'Europe/Paris', // Adapter à ta timezone si nécessaire
    },
    end: {
      dateTime: endDateTime,
      timeZone: 'Europe/Paris', // Adapter à ta timezone si nécessaire
    },
    extendedProperties: {
      private: {
        guestflowSource: 'guestflow',
        guestflowReservationId: String(reservation.id),
      },
    },
  };
}

function getGoogleEventIdForReservation(reservationId) {
  return `guestflow-r${String(reservationId)}`.toLowerCase();
}

function getErrorStatus(error) {
  return Number(error?.response?.status || error?.code || 500);
}

async function upsertReservationEvent(calendar, calendarId, reservation, options) {
  const eventId = getGoogleEventIdForReservation(reservation.id);
  const payload = buildGoogleEventPayload(reservation, options);

  try {
    await calendar.events.get({ calendarId, eventId });
    await calendar.events.update({ calendarId, eventId, requestBody: payload });
    return 'updated';
  } catch (error) {
    if (getErrorStatus(error) !== 404) {
      throw error;
    }
    await calendar.events.insert({ calendarId, requestBody: { ...payload, id: eventId } });
    return 'created';
  }
}

router.get('/status', (req, res) => {
  const config = getGoogleCalendarConfig();
  res.json({
    configured: config.configured,
    calendarId: config.calendarId || null,
    serviceAccountEmail: config.clientEmail || null,
  });
});

router.post('/test-connection', googleCalendarController.testConnection);

router.post('/sync-reservations', async (req, res) => {
  const config = getGoogleCalendarConfig(req.body || {});
  if (!config.configured) {
    return res.status(400).json({
      error: 'Configuration Google Calendar incomplete. Required: GOOGLE_CALENDAR_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.',
      code: 'GOOGLE_CALENDAR_NOT_CONFIGURED',
    });
  }

  try {
    const reservations = db.prepare(`
      SELECT
        r.id,
        r.startDate,
        r.endDate,
        r.checkInTime,
        r.checkOutTime,
        r.adults,
        r.children,
        r.teens,
        r.babies,
        r.singleBeds,
        r.doubleBeds,
        r.babyBeds,
        p.name AS propertyName,
        c.lastName AS clientLastName,
        c.firstName AS clientFirstName
      FROM reservations r
      JOIN properties p ON p.id = r.propertyId
      JOIN clients c ON c.id = r.clientId
      ORDER BY r.startDate ASC, r.id ASC
    `).all();

    const optionRows = db.prepare(`
      SELECT
        ro.reservationId,
        o.title,
        ro.quantity
      FROM reservation_options ro
      JOIN options o ON o.id = ro.optionId
      ORDER BY ro.reservationId ASC, o.title ASC
    `).all();

    const optionsByReservation = new Map();
    for (const row of optionRows) {
      const key = Number(row.reservationId);
      if (!optionsByReservation.has(key)) optionsByReservation.set(key, []);
      optionsByReservation.get(key).push({
        title: String(row.title || 'Option').trim(),
        quantity: Number(row.quantity || 0),
      });
    }

    const calendar = getGoogleCalendarClient(config);

    let createdCount = 0;
    let updatedCount = 0;
    for (const reservation of reservations) {
      const options = optionsByReservation.get(Number(reservation.id)) || [];
      const mode = await upsertReservationEvent(calendar, config.calendarId, reservation, options);
      if (mode === 'created') createdCount += 1;
      else updatedCount += 1;
    }

    return res.json({
      ok: true,
      synced: reservations.length,
      created: createdCount,
      updated: updatedCount,
      message: `Synchronisation terminee: ${reservations.length} reservation(s) envoyee(s) vers Google Calendar.`,
    });
  } catch (error) {
    const message = error?.response?.data?.error?.message || error?.message || 'Erreur Google Calendar';
    return res.status(500).json({ error: message, code: 'GOOGLE_CALENDAR_SYNC_FAILED' });
  }
});

module.exports = router;
module.exports.__test = {
  buildEventTitle,
  buildEventDescription,
  buildGoogleEventPayload,
  getGoogleEventIdForReservation,
  formatOptionQuantity,
  getGoogleCalendarConfig,
};
