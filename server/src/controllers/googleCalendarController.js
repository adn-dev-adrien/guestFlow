/**
 * Google Calendar controller — currently hosts only the `testConnection` action
 * (introduced by the Settings spec). The legacy `/status` and `/sync-reservations`
 * routes still live inline in routes/googleCalendar.js and will be migrated in
 * the Bloc 6 Google Calendar spec.
 */

const { getGoogleCalendarConfig, testConnection } = require('../utils/googleCalendarClient');

async function testConnectionAction(req, res) {
  try {
    const config = getGoogleCalendarConfig();
    const result = await testConnection(config);
    if (result.ok) return res.json(result);
    const status = result.code === 'UNKNOWN' ? 500 : 400;
    return res.status(status).json(result);
  } catch (err) {
    return res.status(500).json({
      ok: false,
      code: 'UNKNOWN',
      error: `Erreur serveur : ${err.message}`,
    });
  }
}

module.exports = {
  testConnection: testConnectionAction,
};
