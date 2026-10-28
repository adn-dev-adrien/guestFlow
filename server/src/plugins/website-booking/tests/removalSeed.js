// specs/plugin-removal-resilience.md rule 11 — a request that created the direct stay, its throttle
// trace, and the terms the guest accepted for it (terms are the stay's record, they stay on removal).
module.exports = {
  seed(db, { stays }) {
    db.prepare("INSERT INTO public_request_stays (reservationId, fingerprint) VALUES (?, 'removal-seed-fingerprint')").run(stays.direct.id);
    db.prepare("INSERT INTO public_request_log (at, ipKey) VALUES (datetime('now'), 'removal-seed')").run();
    db.prepare("INSERT INTO public_request_challenges_used (challengeId, expiresAt) VALUES ('removal-seed', datetime('now', '+1 day'))").run();
    const version = db.prepare(`INSERT INTO terms_versions (version, markdownFr, markdownEn, htmlFr, htmlEn, variablesJson, contentHash, publishedAt)
      VALUES (1, 'CGV', 'Terms', '<p>CGV</p>', '<p>Terms</p>', '{}', 'removal-seed-hash', datetime('now'))`).run();
    db.prepare("INSERT INTO terms_acceptances (reservationId, termsVersionId, acceptedAt, pluginVersion) VALUES (?, ?, datetime('now'), '1.0.0')").run(stays.direct.id, version.lastInsertRowid);
  },
};
