/**
 * Laundry schedule controller — `GET / PUT /api/laundry/schedule` and `POST …/preview`
 * (specs/linen-laundry-days.md §4.3). Writes are admin-only: the reception allowlist only matches the
 * GETs.
 *
 * A save writes the version effective TOMORROW (rule 5); saving what is already in force deletes the
 * pending version instead. The server describes the cycle (rule 7), the client renders it.
 */

const { addDays } = require('./laundryWindow');
const {
  createSchedule, validateSchedule, describeCycle, firstLaundryDayFrom, sameSchedule,
} = require('./laundrySchedule');

const withCycle = (version) => ({ ...version, ...describeCycle(version) });

function createController({ scheduleModel, today }) {
  const view = (versions) => {
    const now = today();
    const tomorrow = addDays(now, 1);
    const schedule = createSchedule(versions);
    const current = schedule.versionOn(now);
    const pending = versions.find((v) => v.effectiveFrom > now) || null;
    return {
      current: withCycle(current),
      pending: pending ? withCycle(pending) : null,
      tomorrow,
    };
  };

  const refuse = (res, error) => res.status(400).json({ error: error.message, code: error.code, field: error.field });

  return {
    /** GET /api/laundry/schedule */
    get(req, res) {
      return res.json(view(scheduleModel.listAll()));
    },

    /** PUT /api/laundry/schedule — body `{ weekdays, turnaroundDays }`. */
    set(req, res) {
      const checked = validateSchedule(req.body);
      if (checked.error) return refuse(res, checked.error);
      const tomorrow = addDays(today(), 1);
      const current = createSchedule(scheduleModel.listAll()).versionOn(today());
      if (sameSchedule(checked.value, current)) scheduleModel.remove(tomorrow);
      else scheduleModel.upsert(tomorrow, checked.value);
      return res.json({ ok: true, ...view(scheduleModel.listAll()) });
    },

    /** POST /api/laundry/schedule/preview — the cycle a candidate would give, nothing written. */
    preview(req, res) {
      const checked = validateSchedule(req.body);
      if (checked.error) return refuse(res, checked.error);
      const { cycle, longestWaitDays } = describeCycle(checked.value);
      return res.json({
        cycle,
        longestWaitDays,
        firstTripOn: firstLaundryDayFrom(addDays(today(), 1), checked.value.weekdays),
      });
    },
  };
}

module.exports = { create: createController };
