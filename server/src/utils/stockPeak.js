/**
 * What a shared stock has out on a range (specs/reservations-backend-mvc.md rule 21): the peak of one night, never the
 * sum of every stay touching the range, or two stays that never meet would hold it twice. The one reading of the cots
 * and of the per-stay resources, for the save, the fiche's hint, the conversion and « Rétablir ».
 */

/**
 * @param {Array<{startDate: string, endDate: string, count: number}>} rows  stays holding the stock
 * @returns {number} the most held on one night of [startDate, endDate)
 */
function peakPerNight(rows, startDate, endDate) {
  const inRange = rows.filter((row) => row.startDate < endDate && row.endDate > startDate);
  const heldOn = (night) => inRange.reduce(
    (sum, row) => (row.startDate <= night && row.endDate > night ? sum + Number(row.count || 0) : sum),
    0,
  );
  // The total only rises on the range's first night or on an arrival.
  const nights = [startDate, ...inRange.map((row) => row.startDate).filter((night) => night > startDate)];
  return Math.max(...nights.map(heldOn));
}

function peakCotsHeld(database, { startDate, endDate, propertyId = null, excludeId = null }) {
  let sql = "SELECT startDate, endDate, babyBeds AS count FROM reservations WHERE kind = 'reservation' AND startDate < ? AND endDate > ? AND COALESCE(babyBeds, 0) > 0";
  const params = [endDate, startDate];
  if (propertyId) { sql += ' AND propertyId = ?'; params.push(propertyId); }
  if (excludeId) { sql += ' AND id != ?'; params.push(Number(excludeId)); }
  return peakPerNight(database.prepare(sql).all(...params), startDate, endDate);
}

function peakResourceHeld(database, { resourceId, startDate, endDate, excludeId = null }) {
  let sql = `
    SELECT r.startDate, r.endDate, rr.quantity AS count
    FROM reservation_resources rr
    JOIN reservations r ON r.id = rr.reservationId
    WHERE r.kind = 'reservation' AND rr.resourceId = ? AND r.startDate < ? AND r.endDate > ?
  `;
  const params = [resourceId, endDate, startDate];
  if (excludeId) { sql += ' AND rr.reservationId != ?'; params.push(Number(excludeId)); }
  return peakPerNight(database.prepare(sql).all(...params), startDate, endDate);
}

const cotsRefusal = (available) => `Lits bébé indisponibles: ${Math.max(0, available)} restant(s) pour cette période.`;
const resourceRefusal = (name, available) => `Ressource '${name}' indisponible: ${Math.max(0, available)} restant(s) pour cette période.`;

module.exports = { peakPerNight, peakCotsHeld, peakResourceHeld, cotsRefusal, resourceRefusal };
