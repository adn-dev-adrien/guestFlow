// specs/plugin-removal-resilience.md rule 11 — what the Google Vacation Rentals feed remembers having sent.
module.exports = {
  seed(db, { stays }) {
    const propertyId = stays.direct.propertyId;
    // A partner id and an enabled property: the feed has something to send, so a catch-up after a
    // reactivation leaves a trace in the push log (specs/plugin-removal-resilience.md rule 17).
    const setting = db.prepare("INSERT OR REPLACE INTO plugin_settings (plugin_id, key, value) VALUES ('google-vacation-rentals', ?, ?)");
    setting.run('partnerId', 'removal_partner');
    setting.run('properties', JSON.stringify({ [propertyId]: { enabled: true } }));
    db.prepare("INSERT INTO gvr_day_snapshot (propertyId, date, inventory, minLos, sentAt) VALUES (?, '2030-01-10', 1, 2, datetime('now'))").run(propertyId);
    db.prepare("INSERT INTO gvr_rate_snapshot (propertyId, checkin, nights, guests, amountCents, sentAt) VALUES (?, '2030-01-10', 3, 2, 60000, datetime('now'))").run(propertyId);
    db.prepare("INSERT INTO gvr_push_log (propertyId, startedAt, finishedAt, mode, reason, messages, rates, days, result) VALUES (?, datetime('now'), datetime('now'), 'live', 'removal seed', 1, 1, 1, 'ok')").run(propertyId);
  },
};
