// specs/plugin-removal-resilience.md rule 11 — an Airbnb mail intake applied to the platform stay.
module.exports = {
  seed(db, { stays }) {
    db.prepare(`INSERT INTO airbnb_intakes (messageId, receivedAt, confirmationCode, parsed, status, reservationId, appliedAt)
      VALUES ('removal-seed-airbnb', datetime('now'), 'HMREMOVAL01', '{}', 'applied', ?, datetime('now'))`).run(stays.platform.id);
  },
};
