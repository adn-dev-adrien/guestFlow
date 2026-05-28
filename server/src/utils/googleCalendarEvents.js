// Pure Google Calendar event builders + upsert, moved verbatim from routes/googleCalendar.js.
// No DB; `upsertReservationEvent` takes an authenticated calendar client.

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
  const startDateTime = `${reservation.startDate}T${reservation.checkInTime || '15:00'}:00`;
  const endDateTime = `${reservation.endDate}T${reservation.checkOutTime || '10:00'}:00`;

  return {
    summary: buildEventTitle(reservation),
    description: buildEventDescription(reservation, options),
    start: { dateTime: startDateTime, timeZone: 'Europe/Paris' },
    end: { dateTime: endDateTime, timeZone: 'Europe/Paris' },
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

module.exports = {
  formatCountLabel,
  formatOptionQuantity,
  buildEventTitle,
  buildEventDescription,
  buildGoogleEventPayload,
  getGoogleEventIdForReservation,
  getErrorStatus,
  upsertReservationEvent,
};
