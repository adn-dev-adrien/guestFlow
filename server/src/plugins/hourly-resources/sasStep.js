/**
 * The arrival SAS « Planifier » step (specs/plugins-phase-3c-hourly-resources.md rule 12; the feature
 * itself is specs/hourly-resource-quantity-and-sas-scheduling.md §3.4 and §3.6).
 *
 *   - `data`: what the step shows, under `pluginData['hourly-resources']` of the SAS payload — the
 *     hours sold, placed and owed per resource, every slot of the stay already classified, and the
 *     evening supplement the placed hours owe;
 *   - `hook`: the commit contract (rule 6). The step sends `{ blocks, resourceIds }`: every block on
 *     the picker and the resources it showed, whose sessions the commit REPLACES.
 */

const NO_STEP = { applicable: false, resources: [] };

function createSasStep({ scheduling, reservations }) {
  const data = (reservationId) => {
    const reservation = reservations.getByIdWithDetails(reservationId);
    return reservation ? scheduling().getSchedulingPayload(reservation) : NO_STEP;
  };

  const blocksOf = (payload) => (payload && Array.isArray(payload.blocks) ? payload.blocks : []);
  // The resources the picker showed: each one's sessions are replaced, even by none.
  const resourceIdsOf = (payload) => (payload && Array.isArray(payload.resourceIds) ? payload.resourceIds.map(Number) : []);
  const verdictFor = (reservation, payload) => scheduling().validateBlocks({
    reservation, blocks: blocksOf(payload), resourceIds: resourceIdsOf(payload),
  });

  const hook = {
    step: 'resourceScheduling',
    // Rule 27 of the feature spec — the picker offers bookable slots only, but its payload may be
    // stale by the time it commits: everything is re-checked and a conflict aborts the whole commit.
    validate(reservation, payload) {
      const verdict = verdictFor(reservation, payload);
      return verdict.ok
        ? { ok: true }
        : { ok: false, status: 409, body: { error: 'SLOT_CONFLICT', block: verdict.block, reason: verdict.reason } };
    },
    // Rules 30, 32 — the evening supplement of every hour on a slot, recomputed on every commit: the
    // step's blocks when it ran, the stored sessions otherwise.
    complementItems(reservation, payload) {
      const supplements = payload === undefined
        ? scheduling().storedSupplements(reservation)
        : verdictFor(reservation, payload).supplements;
      return supplements.map((s) => ({ key: `evening:${s.resourceId}`, label: s.label, amount: s.amount }));
    },
    // Rule 26 — replace, never append, and only for the resources the payload names: a resource the
    // operator never saw keeps its sessions.
    write(db, reservation, payload) {
      const byResource = new Map(resourceIdsOf(payload).map((id) => [id, []]));
      for (const block of blocksOf(payload)) {
        const key = Number(block && block.resourceId);
        if (!key) continue;
        if (!byResource.has(key)) byResource.set(key, []);
        byResource.get(key).push({ date: block.date, start: block.start, end: block.end });
      }
      const writeSessions = db.prepare('UPDATE reservation_resources SET sessions = ? WHERE reservationId = ? AND resourceId = ?');
      for (const [resourceId, sessions] of byResource) {
        sessions.sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.start).localeCompare(String(b.start)));
        writeSessions.run(JSON.stringify(sessions), Number(reservation.id), resourceId);
      }
    },
  };

  return { data, hook };
}

module.exports = { createSasStep };
