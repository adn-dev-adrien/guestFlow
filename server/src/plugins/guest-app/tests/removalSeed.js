// specs/plugin-removal-resilience.md rule 11 — a lodging in the app and a session on the direct stay.
module.exports = {
  seed(db, { stays }) {
    const { propertyId, id } = stays.direct;
    db.prepare("INSERT INTO guest_app_lodgings (propertyId, enabled, lodgingCode) VALUES (?, 1, 'removal-seed-code')").run(propertyId);
    db.prepare(`INSERT INTO guest_sessions (tokenHash, propertyId, reservationId, mode, origin, createdAt, lastSeenAt, expiresAt)
      VALUES ('removal-seed-hash', ?, ?, 'stay', 'qr', datetime('now'), datetime('now'), datetime('now', '+1 day'))`).run(propertyId, id);
  },
};
