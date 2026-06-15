/**
 * Arrival / departure push pass (specs/pwa-push-notifications.md §3.3 + §3.4).
 *
 * Pure + injectable so it can be unit-tested without timers. For the current local day it finds the
 * reservations whose check-in (resp. check-out) time has been reached and that haven't been push-notified
 * yet, sends one push per event (to users with the matching pref ON), and stamps the reservation so it
 * fires once.
 *
 * `firstRun = true` (the first pass after boot) **stamps without sending** every already-due event, so a
 * restart doesn't blast the day's past arrivals/departures (rule 12). Only events crossing their time
 * while the server runs notify.
 *
 * pushService.sendToPref is itself isolated (never throws); each event is additionally try/caught so one
 * bad row can't abort the pass, and the reservation is stamped regardless (the event time has passed —
 * we don't retry a missed push forever).
 */

const { isoToday } = require('./emailAutoSendRunner');

function hhmm(date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function clientName(r) {
  return `${String(r.firstName || '').trim()} ${String(r.lastName || '').trim()}`.trim();
}

async function runArrivalDeparturePush({ reservationsModel, pushService, now = new Date(), firstRun = false, logger = console } = {}) {
  const today = isoToday(now);
  const nowHHMM = hhmm(now);
  let sent = 0;
  let stamped = 0;

  const arrivals = reservationsModel.dueArrivals(today, nowHHMM) || [];
  for (const r of arrivals) {
    try {
      if (!firstRun) {
        const name = clientName(r);
        await pushService.sendToPref('arrivals', {
          title: `Arrivée ${r.checkInTime}`,
          body: `${name}${r.propertyName ? ` · ${r.propertyName}` : ''}`.trim(),
          url: `/planning?sas=arrival&reservationId=${Number(r.id)}`,
        });
        sent += 1;
      }
      reservationsModel.stampArrivalNotified(r.id, today);
      stamped += 1;
    } catch (err) {
      logger.warn('[arrivalDeparturePush] arrival', r && r.id, err && err.message ? err.message : err);
    }
  }

  const departures = reservationsModel.dueDepartures(today, nowHHMM) || [];
  for (const r of departures) {
    try {
      if (!firstRun) {
        const name = clientName(r);
        await pushService.sendToPref('departures', {
          title: `Départ ${r.checkOutTime}`,
          body: `${name}${r.propertyName ? ` · ${r.propertyName}` : ''}`.trim(),
          url: `/planning?sas=departure&reservationId=${Number(r.id)}`,
        });
        sent += 1;
      }
      reservationsModel.stampDepartureNotified(r.id, today);
      stamped += 1;
    } catch (err) {
      logger.warn('[arrivalDeparturePush] departure', r && r.id, err && err.message ? err.message : err);
    }
  }

  return { sent, stamped, firstRun };
}

module.exports = { runArrivalDeparturePush };
