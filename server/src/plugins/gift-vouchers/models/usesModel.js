/**
 * `gift_voucher_uses` — what a recipient asked of a composed voucher on « Mon bain » (specs/gift-voucher-campaigns.md rule 29): the slot, the extra time and add-ons, the
 * contact, the terms version, and where the 15 minutes stand. A use is `held` while its remainder is being paid, `booked` once the bank confirmed and the session exists,
 * `lapsed` when the 15 minutes ended unpaid (slot and voucher free again), `refund_owed` when money came after the lapse and the booking could not be made.
 */

const iso = (date) => (date instanceof Date ? date.toISOString() : date);

function createUsesModel(db, { now = () => new Date() } = {}) {
  const find = (id) => db.prepare('SELECT * FROM gift_voucher_uses WHERE id = ?').get(Number(id)) || null;

  function insert({
    voucherId, resourceId, date, startTime, endTime, extraMinutes, addOns, name, email, phone, termsVersionId, userAgent, ip, dueCents, heldUntil,
  }) {
    const id = Number(db.prepare(`INSERT INTO gift_voucher_uses (voucherId, state, resourceId, date, startTime, endTime, extraMinutes, addOns, name, email, phone, termsVersionId,
      userAgent, ip, holdRef, dueCents, heldUntil, createdAt) VALUES (?, 'held', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?)`)
      .run(Number(voucherId), Number(resourceId), date, startTime, endTime, extraMinutes, JSON.stringify(addOns || []), name || '', email, phone || '', termsVersionId || null,
        userAgent || null, ip || null, dueCents, iso(heldUntil), iso(now())).lastInsertRowid);
    db.prepare('UPDATE gift_voucher_uses SET holdRef = ? WHERE id = ?').run(`voucher-use:${id}`, id);
    return find(id);
  }

  const setLink = (id, linkId) => db.prepare('UPDATE gift_voucher_uses SET linkId = ? WHERE id = ?').run(linkId, Number(id));

  const setBooked = (id, { bookingId, saleId }) => db.prepare("UPDATE gift_voucher_uses SET state = 'booked', bookingId = ?, saleId = ?, settledAt = ? WHERE id = ?")
    .run(bookingId, saleId, iso(now()), Number(id));

  /** → whether the use left the state it was in (a use already `booked` never goes back). */
  const setState = (id, state, note = null) => db.prepare("UPDATE gift_voucher_uses SET state = ?, note = ?, settledAt = ? WHERE id = ? AND state != 'booked'")
    .run(state, note, iso(now()), Number(id)).changes > 0;

  const heldOf = (voucherId) => db.prepare("SELECT * FROM gift_voucher_uses WHERE voucherId = ? AND state = 'held' ORDER BY id").all(Number(voucherId));
  const dueLapsed = (at) => db.prepare("SELECT * FROM gift_voucher_uses WHERE state = 'held' AND heldUntil <= ? ORDER BY id").all(iso(at));
  const listByVoucher = (voucherId) => db.prepare('SELECT * FROM gift_voucher_uses WHERE voucherId = ? ORDER BY id').all(Number(voucherId));
  const bookedOf = (voucherId) => db.prepare("SELECT * FROM gift_voucher_uses WHERE voucherId = ? AND state = 'booked' ORDER BY id DESC").get(Number(voucherId)) || null;

  return {
    find, insert, setLink, setBooked, setState, heldOf, dueLapsed, listByVoucher, bookedOf,
  };
}

module.exports = createUsesModel;
