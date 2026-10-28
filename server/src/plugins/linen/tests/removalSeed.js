// specs/plugin-removal-resilience.md rule 11 — laundry skips, additions, an extra trip and a schedule version.
module.exports = {
  seed(db) {
    db.prepare("INSERT INTO laundry_trip_skips (tripDate) VALUES ('2030-01-07')").run();
    db.prepare("INSERT INTO laundry_trip_manual_additions (tripDate, singleBeds, doubleBeds) VALUES ('2030-01-14', 1, 2)").run();
    db.prepare("INSERT INTO laundry_extra_trips (tripDate, pickUpAll, singleBeds) VALUES ('2030-01-21', 1, 3)").run();
    db.prepare("INSERT OR REPLACE INTO laundry_schedule_versions (effectiveFrom, weekdays, turnaroundDays) VALUES ('2030-01-01', '[1]', 2)").run();
  },
};
