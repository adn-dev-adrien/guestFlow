// specs/plugin-removal-resilience.md rule 11 — a lodging in the app, the direct stay's link and a session opened from it.
module.exports = {
  seed(db, { stays }) {
    const { propertyId, id } = stays.direct;
    db.prepare("INSERT INTO guest_app_lodgings (propertyId, enabled, lodgingCode) VALUES (?, 1, 'removal-seed-code')").run(propertyId);
    const link = db.prepare(`INSERT INTO guest_stay_links (reservationId, tokenEncrypted, tokenHash, createdAt)
      VALUES (?, 'removal-seed-blob', 'removal-seed-link-hash', datetime('now'))`).run(id).lastInsertRowid;
    db.prepare(`INSERT INTO guest_sessions (tokenHash, propertyId, reservationId, mode, origin, stayLinkId, createdAt, lastSeenAt, expiresAt)
      VALUES ('removal-seed-hash', ?, ?, 'stay', 'link', ?, datetime('now'), datetime('now'), datetime('now', '+1 day'))`).run(propertyId, id, link);
  },
};
