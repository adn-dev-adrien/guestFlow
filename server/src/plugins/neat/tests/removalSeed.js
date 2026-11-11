// specs/plugin-removal-resilience.md rule 11 — an insurance subscription of the direct stay and a cached premium.
module.exports = {
  seed(db, { stays }) {
    db.prepare(`INSERT INTO neat_subscriptions (reservationId, environment, externalId, status, neatSubscriptionId, premiumAmount, billedAmount)
      VALUES (?, 'staging', 'removal-seed-neat', 'active', 'sub_removal', 24, 24)`).run(stays.direct.id);
    db.prepare("INSERT INTO neat_price_cache (environment, contractId, fieldsHash, premium, fetchedAt) VALUES ('staging', 'contract', 'hash', 24, datetime('now'))").run();
  },
};
