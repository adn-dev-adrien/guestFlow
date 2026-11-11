// specs/plugin-removal-resilience.md rule 11 — a Gîtes de France mail intake applied to the platform stay.
module.exports = {
  seed(db, { stays }) {
    db.prepare(`INSERT INTO gdf_intakes (messageId, receivedAt, dossierNumber, parsed, status, reservationId, appliedAt)
      VALUES ('removal-seed-gdf', datetime('now'), 'G0000001', '{}', 'applied', ?, datetime('now'))`).run(stays.platform.id);
  },
};
