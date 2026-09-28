/**
 * Weather-alert controller (specs/checkin-weather-alerts.md §4.1).
 *
 * Resolves the domain address → département, fetches the (cached) Météo-France vigilance, filters
 * the Orange/Red phenomena overlapping the reservation's stay, and returns ready-to-render alerts.
 * Designed to NEVER break the check-in: any missing key / unresolvable address / upstream failure
 * degrades to `{ alerts: [] }` (the SAS just skips the weather page).
 */

const vigilance = require('./meteoVigilance');

// deps: { getReservation(id), companyAddress(), apiKey(), cache() } — injected by the plugin's register.
function createController({ getReservation, companyAddress, apiKey: readApiKey, cache }) {
  async function getReservationAlerts(req, res) {
    const reservation = getReservation(req.params.id);
    if (!reservation) return res.status(404).json({ error: 'RESERVATION_NOT_FOUND' });

    try {
      const apiKey = readApiKey();
      if (!apiKey) {
        return res.json({ configured: false, resolved: false, department: null, alerts: [] });
      }

      const address = String(companyAddress() || '').trim();
      const department = await vigilance.geocodeDepartment(address);
      if (!department) {
        return res.json({ configured: true, resolved: false, department: null, alerts: [] });
      }

      const phenomena = await vigilance.getVigilanceForDepartment(department, apiKey, cache());
      const filtered = vigilance.filterAlertsForStay(phenomena, {
        start: reservation.startDate,
        end: reservation.endDate,
      });
      const alerts = filtered.map(vigilance.buildAlertDisplay);
      return res.json({ configured: true, resolved: true, department, alerts });
    } catch (err) {
      // A weather lookup must never block a check-in — log and degrade to no alerts.
      console.error('[plugin:weather-alerts] getReservationAlerts', err);
      return res.json({ configured: true, resolved: false, department: null, alerts: [] });
    }
  }

  return { getReservationAlerts };
}

module.exports = { createController };
