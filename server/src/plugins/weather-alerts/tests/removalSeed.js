// specs/plugin-removal-resilience.md rule 11 — a cached vigilance answer.
module.exports = {
  seed(db) {
    db.prepare("INSERT INTO weather_vigilance_cache (departmentCode, payload, fetchedAt) VALUES ('34', '{}', datetime('now'))").run();
  },
};
