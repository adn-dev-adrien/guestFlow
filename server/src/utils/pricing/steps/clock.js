/**
 * STEP clock — STAY CLOCK (specs/pricing-components.md §3 rule 52).
 *
 * The clock-derived values the caller injects (the booking day, the stored acompte deadline, the arrival
 * baseline): the engine reads no clock of its own. The resolver's phase is not fed in PR A (the controller
 * derives these with the process time zone).
 * `apply(ctx)` returns a new context and never mutates the one it receives.
 */

const step = {
  id: 'clock',
  requires: ['input'],
  provides: ['clock'],
  apply(ctx) {
    const {
      // specs/mid-stay-extras-to-end-of-stay-complement.md — the extras as they stood when the STAY
      // STARTED (`reservations.arrivalExtrasBaseline`, JSON `{ key → TTC }`). Whatever exceeds it was
      // sold while the guest was in the property: it leaves the pre-arrival + arrival-complement
      // pipeline and is billed in the END-OF-STAY complement instead. NULL / absent (stay not started,
      // devis, public quote) → the split is a no-op and every formula below reduces to its former self.
      arrivalExtrasBaseline,
      // specs/payment-schedule-and-cancellation.md §3.1 — the day the stay was BOOKED (the reservation's
      // `createdAt`, or today for a creation). The engine has no clock, so the caller injects it: it
      // anchors the acompte deadline and clamps the solde one. Absent → both fall back to a stay-relative
      // derivation, which is what a stateless quote (public site preview) wants.
      bookingDate = null,
      // The acompte deadline ALREADY stored on the reservation. Present → it wins, always: the date was
      // promised on the booking day and no later edit may push it around (rule 4).
      existingDepositDueDate = null,
    } = ctx.input;
    const clock = Object.freeze({ bookingDate, existingDepositDueDate, arrivalExtrasBaseline });

    return { ...ctx, clock };
  },
};

module.exports = step;
