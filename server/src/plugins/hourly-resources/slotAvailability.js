/**
 * The SlotAvailabilityProvider of the hourly resources (specs/pricing-components.md §3 rule 48, SDK 2.28.0): what a planning can
 * offer and refuse, asked by the bath fulfilment adapter and, from the core, by `ctx.core.slotAvailability()`.
 *
 *   slots({ resourceId, propertyId, stay, now? })        the free slots of each day of a stay, priced (the scheduler's `slotsForStay`)
 *   validate({ resourceId, propertyId, stay, sessions, now? })  `{ ok, results }` for the requested sessions, in time order (rule 29), or null
 *                                                         when the resource is not an hourly resource of that lodging
 *
 * A thin face over the scheduler: the slot walk, the occupancy (standalone bookings, stays' sessions, the slots other plugins hold),
 * the heat-up and the turnover are the scheduler's; nothing is decided twice.
 */
function createSlotAvailability(scheduler) {
  return {
    slots: (args) => scheduler().slotsForStay(args),
    validate: (args) => scheduler().validateSessions(args),
  };
}

module.exports = { createSlotAvailability };
