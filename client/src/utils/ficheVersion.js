/**
 * The version of an open fiche after a write (specs/reservation-fiche-concurrency.md rule 4).
 *
 * `detail` is what `api.js` puts on the data-changed event: the stay a write touched and its `updatedAt`
 * before and after. The fiche adopts `after` only when `before` is the version it holds — its own write,
 * made on what it loaded. A write that started from another version means something else wrote in
 * between: the held version is kept, so the next save is still refused as stale.
 *
 * @param {number|string} reservationId  the stay the fiche shows
 * @param {string|null} held             the `updatedAt` the fiche was built on
 * @param {{reservationId:number,before:string,after:string}|null} detail
 * @returns {string|null} the version to hold from now on
 */
export function versionAfterOwnWrite(reservationId, held, detail) {
  if (!detail || Number(detail.reservationId) !== Number(reservationId)) return held;
  return held !== null && String(detail.before) === String(held) ? detail.after : held;
}
