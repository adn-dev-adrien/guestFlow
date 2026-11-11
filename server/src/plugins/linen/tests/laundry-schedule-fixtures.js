// Shared fixtures of the laundry-days suites (not a test file: `npm test` only runs `*.test.js`).
const { createSchedule, BEGINNING_OF_TIME, DEFAULT_WEEKDAY } = require('../laundrySchedule');

/** A schedule that never changes: the migrated shape of the former single `laundryWeekday`. */
function constantSchedule(weekdays = DEFAULT_WEEKDAY, turnaroundDays = 1) {
  return createSchedule([{
    effectiveFrom: BEGINNING_OF_TIME,
    weekdays: Array.isArray(weekdays) ? weekdays : [weekdays],
    turnaroundDays,
  }]);
}

/** The model-shaped stand-in a controller or inventory model reads the schedule from. */
function fakeScheduleModel(weekdays = DEFAULT_WEEKDAY, turnaroundDays = 1) {
  return {
    listAll: () => [{
      effectiveFrom: BEGINNING_OF_TIME,
      weekdays: Array.isArray(weekdays) ? weekdays : [weekdays],
      turnaroundDays,
    }],
  };
}

module.exports = { constantSchedule, fakeScheduleModel };
