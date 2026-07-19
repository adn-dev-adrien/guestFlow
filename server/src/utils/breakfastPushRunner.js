/**
 * Breakfast push pass (specs/sas-breakfast-bread-and-push.md rules 7-9).
 *
 * Pure + injectable, mirroring `arrivalDeparturePushRunner`. For the current local day it takes
 * the breakfast planning items (breakfastModel.breakfastByDate), finds the ones whose
 * `serving time − lead` has been reached and that haven't been notified today, sends one push per
 * reservation (pref `breakfast`) and stamps `breakfastNotifiedDate` so it fires once per day.
 *
 * `firstRun = true` (first pass after boot) stamps without sending — a restart doesn't blast the
 * morning's already-due breakfasts. pushService.sendToPref never throws; each item is additionally
 * try/caught, and the reservation is stamped regardless (a missed push isn't retried forever).
 */

const { isoToday } = require('./emailAutoSendRunner');

function hhmm(date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

// '09:00' − 30 → '08:30'; clamped at '00:00' (no previous-day sends). Invalid time → null.
function subtractMinutes(time, minutes) {
  const m = /^(\d{2}):(\d{2})$/.exec(String(time || ''));
  if (!m) return null;
  const total = Math.max(0, Number(m[1]) * 60 + Number(m[2]) - (Number(minutes) || 0));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

async function runBreakfastPush({ breakfastModel, reservationsModel, pushService, now = new Date(), firstRun = false, logger = console } = {}) {
  const today = isoToday(now);
  const nowHHMM = hhmm(now);
  const lead = breakfastModel.notifyLeadMinutes();
  let sent = 0;
  let stamped = 0;

  const day = breakfastModel.breakfastByDate({ from: today, to: today })[today];
  const items = (day && day.items) || [];
  for (const item of items) {
    try {
      if (item.notifiedDate === today) continue;
      const sendAt = subtractMinutes(item.breakfastTime, lead);
      if (!sendAt || sendAt > nowHHMM) continue;

      if (!firstRun) {
        await pushService.sendToPref('breakfast', {
          title: `Petit déjeuner ${item.breakfastTime}`,
          body: `${item.clientName}${item.propertyName ? ` · ${item.propertyName}` : ''} — ${item.persons} petit${item.persons > 1 ? 's' : ''} déjeuner${item.persons > 1 ? 's' : ''}`,
          url: `/planning?breakfast=${Number(item.reservationId)}&date=${today}`,
          tag: `guestflow-breakfast-${Number(item.reservationId)}-${today}`,
        });
        sent += 1;
      }
      reservationsModel.stampBreakfastNotified(item.reservationId, today);
      stamped += 1;
    } catch (err) {
      logger.warn('[breakfastPush]', item && item.reservationId, err && err.message ? err.message : err);
    }
  }

  return { sent, stamped, firstRun, lead };
}

module.exports = { runBreakfastPush, subtractMinutes };
