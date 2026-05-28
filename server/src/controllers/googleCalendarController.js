/**
 * Google Calendar controller — status, test-connection, and reservation sync.
 * Event building lives in utils/googleCalendarEvents; the reservations+options read in googleCalendarModel.
 */

const { getGoogleCalendarConfig, getGoogleCalendarClient, testConnection } = require('../utils/googleCalendarClient');
const { upsertReservationEvent } = require('../utils/googleCalendarEvents');
const model = require('../models/googleCalendarModel');

function status(req, res) {
  const config = getGoogleCalendarConfig();
  res.json({
    configured: config.configured,
    calendarId: config.calendarId || null,
    serviceAccountEmail: config.clientEmail || null,
  });
}

async function testConnectionAction(req, res) {
  try {
    const config = getGoogleCalendarConfig();
    const result = await testConnection(config);
    if (result.ok) return res.json(result);
    const httpStatus = result.code === 'UNKNOWN' ? 500 : 400;
    return res.status(httpStatus).json(result);
  } catch (err) {
    return res.status(500).json({ ok: false, code: 'UNKNOWN', error: `Erreur serveur : ${err.message}` });
  }
}

async function syncReservations(req, res) {
  const config = getGoogleCalendarConfig(req.body || {});
  if (!config.configured) {
    return res.status(400).json({
      error: 'Configuration Google Calendar incomplete. Required: GOOGLE_CALENDAR_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.',
      code: 'GOOGLE_CALENDAR_NOT_CONFIGURED',
    });
  }

  try {
    const reservations = model.listReservationsForSync();
    const calendar = getGoogleCalendarClient(config);

    let createdCount = 0;
    let updatedCount = 0;
    for (const reservation of reservations) {
      const mode = await upsertReservationEvent(calendar, config.calendarId, reservation, reservation.options);
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
}

module.exports = {
  status,
  testConnection: testConnectionAction,
  syncReservations,
};
