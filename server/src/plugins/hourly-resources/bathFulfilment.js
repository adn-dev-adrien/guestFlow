/**
 * The `hourly-slot` fulfilment adapter (specs/pricing-components.md §3 rule 49, SDK 2.28.0): a resource sold by the hour and placed on a
 * planning takes a slot, and a sale of it is refused when the slot is taken.
 *
 *   reserve(draft)         validates the sessions against the planning (stays' sessions, standalone bookings, the holds other plugins
 *                          declare through `resourceHolds`, heat-up and turnover — all the occupancy's) → { hold } | { refusal }
 *   confirm(hold, line)    the same judgement again, authoritative, inside the sale transaction and before the line is written →
 *                          { ok } | { refusal: SLOT_TAKEN }
 *   release(hold, reason)  nothing to free: the slot belongs to the sessions of the line, which leave with it. A card hold of the guest
 *                          app is that plugin's own `resourceHolds` entry and lapses with it.
 *
 * `draft` and `line` are `{ resourceId, propertyId, stay: { startDate, endDate, checkInTime, checkOutTime }, sessions, now? }`.
 */
const SLOT_TAKEN = Object.freeze({ code: 'SLOT_TAKEN', message: 'Ce créneau n’est plus disponible.' });

const holdIdOf = (draft) => `hourly-slot:${draft.resourceId}:${(draft.sessions || []).map((s) => `${s.date}@${s.start}-${s.end}`).join(',')}`;

function createBathFulfilment({ slotAvailability }) {
  const judge = (draft) => {
    const verdict = slotAvailability.validate({
      resourceId: draft.resourceId, propertyId: draft.propertyId, stay: draft.stay, sessions: draft.sessions || [], now: draft.now,
    });
    if (!verdict) return { ok: true, unmanaged: true };
    return verdict.ok ? { ok: true } : { ok: false, results: verdict.results };
  };
  return {
    id: 'hourly-slot',
    reserve(draft) {
      if (!Array.isArray(draft.sessions) || draft.sessions.length === 0) return { hold: null };
      const verdict = judge(draft);
      if (!verdict.ok) return { refusal: { ...SLOT_TAKEN, results: verdict.results } };
      return { hold: verdict.unmanaged ? null : { id: holdIdOf(draft), expiresAt: null } };
    },
    confirm(hold, line) {
      if (!hold) return { ok: true };
      const verdict = judge(line);
      return verdict.ok ? { ok: true } : { refusal: { ...SLOT_TAKEN, results: verdict.results } };
    },
    release() {},
  };
}

module.exports = { createBathFulfilment, SLOT_TAKEN };
