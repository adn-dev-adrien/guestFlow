// specs/plugin-removal-resilience.md rule 11 — a per-hour session carried by the direct stay, and a
// booking of the same resource that belongs to no stay.
module.exports = {
  seed(db, { stays }) {
    const { resourceId, id, propertyId, startDate } = stays.direct;
    db.prepare(`INSERT INTO resource_bookings (resourceId, reservationId, propertyId, date, startTime, endTime, totalPrice)
      VALUES (?, ?, ?, ?, '18:00', '19:00', 30)`).run(resourceId, id, propertyId, startDate);
    db.prepare(`INSERT INTO resource_bookings (resourceId, clientName, propertyId, date, startTime, endTime, totalPrice, notes)
      VALUES (?, 'Visiteur externe', ?, ?, '20:00', '21:00', 30, 'external booking')`).run(resourceId, propertyId, startDate);
  },
};
