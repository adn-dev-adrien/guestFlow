// Pure Google Calendar event builders + upsert/delete/diff helpers
// (specs/google-calendar-oauth-rework.md §3 rules 12-17).
// No DB; the mutating helpers take an authenticated calendar client.

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

// Deterministic per-property color from Google's fixed event palette (colorId '1'..'11').
function getColorIdForProperty(propertyId) {
  const id = Number(propertyId);
  if (!Number.isFinite(id) || id < 1) return '1';
  return String(((Math.floor(id) - 1) % 11) + 1);
}

function buildGoogleEventPayload(reservation, options) {
  const startDateTime = `${reservation.startDate}T${reservation.checkInTime || '15:00'}:00`;
  const endDateTime = `${reservation.endDate}T${reservation.checkOutTime || '10:00'}:00`;

  return {
    summary: buildEventTitle(reservation),
    description: buildEventDescription(reservation, options),
    start: { dateTime: startDateTime, timeZone: 'Europe/Paris' },
    end: { dateTime: endDateTime, timeZone: 'Europe/Paris' },
    colorId: getColorIdForProperty(reservation.propertyId),
    // Explicit so an update on a Google-side-cancelled event resurrects it — GuestFlow is
    // the source of truth (spec rule 15).
    status: 'confirmed',
    extendedProperties: {
      private: {
        guestflowSource: 'guestflow',
        guestflowReservationId: String(reservation.id),
      },
    },
  };
}

// Google event ids only allow base32hex characters (0-9, a-v) — `gfres` qualifies. The old
// `guestflow-r<id>` scheme ('w', '-') was rejected by the API, so no legacy events exist.
function getGoogleEventIdForReservation(reservationId) {
  return `gfres${String(reservationId)}`;
}

function getErrorStatus(error) {
  return Number(error?.response?.status || error?.code || 500);
}

// Update-first (1 API call in steady state); 404 → insert with the fixed id; insert 409
// (id already used by a cancelled event Google still remembers) → retry the update once,
// which resurrects it thanks to `status: 'confirmed'` in the payload. `prebuiltPayload`
// lets reconcile reuse the payload it already built for the diff.
async function upsertReservationEvent(calendar, calendarId, reservation, options, prebuiltPayload) {
  const eventId = getGoogleEventIdForReservation(reservation.id);
  const payload = prebuiltPayload || buildGoogleEventPayload(reservation, options);

  try {
    await calendar.events.update({ calendarId, eventId, requestBody: payload });
    return 'updated';
  } catch (error) {
    if (getErrorStatus(error) !== 404) {
      throw error;
    }
  }

  try {
    await calendar.events.insert({ calendarId, requestBody: { ...payload, id: eventId } });
    return 'created';
  } catch (error) {
    if (getErrorStatus(error) !== 409) {
      throw error;
    }
    await calendar.events.update({ calendarId, eventId, requestBody: payload });
    return 'updated';
  }
}

// 404 (never existed) and 410 (already deleted/cancelled) are both success for our purpose.
async function deleteReservationEventById(calendar, calendarId, reservationId) {
  const eventId = getGoogleEventIdForReservation(reservationId);
  try {
    await calendar.events.delete({ calendarId, eventId });
    return 'deleted';
  } catch (error) {
    const status = getErrorStatus(error);
    if (status === 404 || status === 410) return 'absent';
    throw error;
  }
}

// Local wall-clock comparison: we send `2026-06-01T15:00:00` + timeZone Europe/Paris and
// Google echoes `2026-06-01T15:00:00+02:00` in that zone — slicing to 19 chars compares the
// wall-clock part without depending on the server's own timezone.
function sameLocalDateTime(remoteDateTime, desiredDateTime) {
  return String(remoteDateTime || '').slice(0, 19) === String(desiredDateTime || '').slice(0, 19);
}

// True when the remote event no longer matches what we would push (reconcile skips
// unchanged events to stay quota-friendly — spec rule 17b).
function eventDiffers(remoteEvent, desiredPayload) {
  const remote = remoteEvent || {};
  return (
    String(remote.summary || '') !== desiredPayload.summary
    || String(remote.description || '') !== desiredPayload.description
    || String(remote.colorId || '') !== desiredPayload.colorId
    || String(remote.status || 'confirmed') !== desiredPayload.status
    || !sameLocalDateTime(remote.start && remote.start.dateTime, desiredPayload.start.dateTime)
    || !sameLocalDateTime(remote.end && remote.end.dateTime, desiredPayload.end.dateTime)
  );
}

module.exports = {
  formatCountLabel,
  formatOptionQuantity,
  buildEventTitle,
  buildEventDescription,
  buildGoogleEventPayload,
  getColorIdForProperty,
  getGoogleEventIdForReservation,
  getErrorStatus,
  upsertReservationEvent,
  deleteReservationEventById,
  eventDiffers,
};
