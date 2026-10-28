// specs/plugin-removal-resilience.md rule 11 — a Booking extranet intake applied to the platform stay.
module.exports = {
  seed(db, { stays }) {
    db.prepare("INSERT INTO booking_intakes (resId, hotelId, reservationId, status, parsed) VALUES ('5550000001', '1234567', ?, 'applied', '{}')").run(stays.platform.id);
    db.prepare('INSERT INTO booking_dismissals (reservationId) VALUES (?)').run(stays.direct.id);
  },
};
