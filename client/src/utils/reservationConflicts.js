function formatDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function shiftDate(dateStr, daysDelta) {
  if (!dateStr) return '';
  const date = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(date.getTime())) return '';
  date.setDate(date.getDate() + daysDelta);
  return formatDate(date);
}

function timeToHour(timeStr) {
  if (!timeStr) return 0;
  const [hours, minutes] = timeStr.split(':').map(Number);
  return hours + (minutes || 0) / 60;
}

function getEffectiveReservationBounds(reservation) {
  const occupiedStartDate = timeToHour(reservation.checkInTime || '15:00') <= 10
    ? shiftDate(reservation.startDate, -1)
    : reservation.startDate;
  const occupiedEndDate = timeToHour(reservation.checkOutTime || '10:00') >= 17
    ? shiftDate(reservation.endDate, 1)
    : reservation.endDate;

  return { occupiedStartDate, occupiedEndDate };
}

export function getBlockedNightConflictInfo(dateStr, reservations = []) {
  const nextDateStr = shiftDate(dateStr, 1);
  const prevDateStr = shiftDate(dateStr, -1);

  const earlyArrivalReservation = reservations.find(
    (reservation) => reservation.startDate === nextDateStr && timeToHour(reservation.checkInTime || '15:00') <= 10,
  );
  if (earlyArrivalReservation) {
    return {
      type: 'early-arrival',
      reservation: earlyArrivalReservation,
    };
  }

  const lateDepartureReservation = reservations.find(
    (reservation) => reservation.endDate === dateStr && timeToHour(reservation.checkOutTime || '10:00') >= 17,
  );
  if (lateDepartureReservation) {
    return {
      type: 'late-departure-evening',
      reservation: lateDepartureReservation,
    };
  }

  const lateDepartureMorningReservation = reservations.find(
    (reservation) => reservation.endDate === prevDateStr && timeToHour(reservation.checkOutTime || '10:00') >= 17,
  );
  if (lateDepartureMorningReservation) {
    return {
      type: 'late-departure-morning',
      reservation: lateDepartureMorningReservation,
    };
  }

  return null;
}

export function findFirstOccupiedDateInRange(startDate, endDate, occupiedDates = []) {
  if (!startDate || !endDate) return null;

  const occupiedDateSet = occupiedDates instanceof Set ? occupiedDates : new Set(occupiedDates);
  for (let cursor = startDate; cursor < endDate; cursor = shiftDate(cursor, 1)) {
    if (occupiedDateSet.has(cursor)) {
      return cursor;
    }
  }

  return null;
}

export function getRangeOccupancyConflictInfo({
  startDate,
  endDate,
  occupiedDates = [],
  reservations = [],
  excludeReservationId = null,
}) {
  const occupiedDate = findFirstOccupiedDateInRange(startDate, endDate, occupiedDates);
  if (!occupiedDate) return null;

  const relevantReservations = excludeReservationId
    ? reservations.filter((reservation) => reservation.id !== excludeReservationId)
    : reservations;

  const reservationOverlapsRange = (reservation) => {
    if (!reservation) return false;
    const { occupiedStartDate, occupiedEndDate } = getEffectiveReservationBounds(reservation);
    return occupiedStartDate < endDate && occupiedEndDate > startDate;
  };

  const blockedNightInfoCandidate = getBlockedNightConflictInfo(occupiedDate, relevantReservations);
  const blockedNightInfo = reservationOverlapsRange(blockedNightInfoCandidate?.reservation)
    ? blockedNightInfoCandidate
    : null;
  const overlappingReservation = blockedNightInfo?.reservation || relevantReservations.find(reservationOverlapsRange) || null;

  if (!blockedNightInfo && !overlappingReservation) {
    return null;
  }

  let message = 'Ce logement est déjà réservé pour ces dates.';
  if (blockedNightInfo?.type === 'early-arrival') {
    message = 'Ce logement n\'est pas disponible pour ces dates : une arrivée anticipée bloque une nuit supplémentaire.';
  } else if (blockedNightInfo?.type === 'late-departure-evening' || blockedNightInfo?.type === 'late-departure-morning') {
    message = 'Ce logement n\'est pas disponible pour ces dates : un départ tardif bloque une nuit supplémentaire.';
  }

  return {
    occupiedDate,
    blockedNightInfo,
    reservation: overlappingReservation,
    message,
  };
}

export function getDayOccupancyConflictMessage({
  dateStr,
  today,
  occupiedDates = [],
  reservations = [],
}) {
  if (today && dateStr < today) return 'Impossible de réserver dans le passé.';
  if (!occupiedDates.includes(dateStr)) return '';

  const blockedNightInfo = getBlockedNightConflictInfo(dateStr, reservations);
  if (blockedNightInfo?.type === 'early-arrival') {
    return 'Ce logement n\'est pas disponible à cette date : la nuit est bloquée par une arrivée anticipée.';
  }
  if (blockedNightInfo?.type === 'late-departure-evening' || blockedNightInfo?.type === 'late-departure-morning') {
    return 'Ce logement n\'est pas disponible à cette date : la nuit est bloquée par un départ tardif.';
  }

  return 'Ce logement est déjà réservé pour cette date.';
}
