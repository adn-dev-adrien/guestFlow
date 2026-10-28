// specs/plugin-removal-resilience.md rule 11 — a gate key result for the direct stay and the connector state.
module.exports = {
  seed(db, { stays }) {
    db.prepare(`INSERT INTO gate_key_results (reservationId, action, ok, state, code, url, receivedAt, propertyId)
      VALUES (?, 'create', 1, 'active', '4242', 'https://gate.example.test/k/removal', datetime('now'), ?)`).run(stays.direct.id, stays.direct.propertyId);
    db.prepare("INSERT INTO gate_connector_state (id, lastReadAt) VALUES (1, datetime('now'))").run();
  },
};
