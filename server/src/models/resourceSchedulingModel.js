/**
 * Arrival-SAS resource scheduling — the DB-facing half of
 * specs/hourly-resource-quantity-and-sas-scheduling.md §3.4.
 *
 * An hourly resource is sold by the hour on the quote; the hours are placed on real slots with the
 * guest at check-in. This model assembles what the picker needs (hours still owed + every slot of the
 * stay, classified) and re-validates what comes back, so a stale payload can never double-book.
 *
 * All the time reasoning lives in `utils/resourceAvailability` (pure, clock injected). Here we only
 * fetch: the resource row, its per-property rate, the reservation's sold hours, and the occupancy.
 */

const db = require('../database');
const resourcesModel = require('./resourcesModel');
const resourceOccupancyModel = require('./resourceOccupancyModel');
const { buildDays, validateBlock, toAbsMinutes } = require('../utils/resourceAvailability');
const { eveningSupplement, toMinutes } = require('../utils/resourceHourlyPricing');

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function eachDate(startDate, endDate) {
  if (!ISO_DATE.test(String(startDate))) return [];
  const out = [];
  const last = ISO_DATE.test(String(endDate)) ? endDate : startDate;
  for (let d = startDate; d <= last && out.length < 62; ) {
    out.push(d);
    const next = new Date(`${d}T12:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    d = next.toISOString().slice(0, 10);
  }
  return out;
}

function round2(v) {
  return Math.round((Number(v) || 0) * 100) / 100;
}

function createModel(database) {
  const resources = resourcesModel.create(database);
  const occupancy = resourceOccupancyModel.create(database);

  const hasColumn = (table, column) => {
    try { return database.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column); }
    catch { return false; }
  };
  const HAS_SESSIONS = hasColumn('reservation_resources', 'sessions');

  /** The hourly-schedulable resources sold on this reservation, with what they still owe. */
  function soldSchedulableResources(reservation) {
    let rows;
    try {
      rows = database.prepare(`
        SELECT rr.resourceId, rr.quantity, rr.unitPrice, rr.billedUnits, rr.totalPrice, rr.offered,
          ${HAS_SESSIONS ? 'rr.sessions' : 'NULL AS sessions'}
        FROM reservation_resources rr
        JOIN resources r ON r.id = rr.resourceId
        WHERE rr.reservationId = ? AND r.showsPlanningCard = 1 AND r.priceType = 'per_hour'
      `).all(Number(reservation.id));
    } catch { return []; }

    return rows.map((row) => {
      const resource = resources.list(Number(reservation.propertyId))
        .find((r) => Number(r.id) === Number(row.resourceId));
      if (!resource) return null;
      const sessions = occupancy.parseSessions(row.sessions);
      const placedMinutes = sessions.reduce(
        (sum, s) => sum + Math.max(0, toMinutes(s.end) - toMinutes(s.start)),
        0,
      );
      const hoursSold = Math.max(0, Number(row.quantity) || 0);
      const hoursPlaced = round2(placedMinutes / 60);
      // What the sold line already bills above the day rate — a line priced from evening sessions
      // before the sale carries its evening difference in its own amount (rule 30). An offered line
      // keeps its real amount in unitPrice × billedUnits.
      const billedUnits = Math.max(0, Number(row.billedUnits) || 0);
      const lineAmount = Number(row.offered) === 1
        ? round2((Number(row.unitPrice) || 0) * billedUnits)
        : round2(row.totalPrice);
      const eveningCredit = Math.max(0, round2(lineAmount - Number(resource.price || 0) * billedUnits));
      return {
        resource,
        sessions,
        hoursSold,
        hoursPlaced,
        hoursRemaining: Math.max(0, round2(hoursSold - hoursPlaced)),
        eveningCredit,
      };
    }).filter(Boolean);
  }

  const supplementLabel = (entry) => `${entry.resource.name} — supplément soirée`;

  function eveningOf(entry, blocks) {
    return eveningSupplement(blocks, {
      dayRate: Number(entry.resource.price || 0),
      eveningRate: Number(entry.resource.hourlyEveningRate) || 0,
      eveningStart: entry.resource.hourlyEveningStart || null,
      slotMinutes: Number(entry.resource.slotDuration || 60),
    });
  }

  /**
   * The evening supplements a stay owes (§3.4 rules 22, 30): for each sold schedulable resource, the
   * evening difference of ALL its hours on a slot — `blocksByResource` for the resources the SAS
   * re-placed, the stored sessions for the others — minus what the sold line already bills for the
   * evening. Recomputed from scratch, so it is billed once whatever the number of commits.
   */
  function supplementsFor(entries, blocksByResource = new Map()) {
    return entries.map((entry) => {
      const id = Number(entry.resource.id);
      const blocks = blocksByResource.has(id) ? blocksByResource.get(id) : entry.sessions;
      const amount = supplementOf(entry, blocks);
      return { resourceId: id, label: supplementLabel(entry), amount };
    }).filter((s) => s.amount > 0);
  }

  /** One resource's supplement for a set of blocks, what the SAS recap shows as it changes. */
  function supplementOf(entry, blocks) {
    return Math.max(0, round2(eveningOf(entry, blocks) - entry.eveningCredit));
  }

  /** The supplements of the stored sessions — a commit whose scheduling step did not run. */
  function storedSupplements(reservation) {
    return supplementsFor(soldSchedulableResources(reservation));
  }

  /** The labels the supplements of this stay are written under, owed or not. */
  function supplementLabels(reservation) {
    return soldSchedulableResources(reservation).map(supplementLabel);
  }

  /**
   * `notBefore` = max(now, check-in) and `notAfter` = check-out, both in absolute minutes.
   * `now` is injectable so the payload is reproducible under test.
   */
  function stayBounds(reservation, now = new Date()) {
    const checkIn = toAbsMinutes(reservation.startDate, reservation.checkInTime || '15:00');
    const checkOut = toAbsMinutes(reservation.endDate || reservation.startDate, reservation.checkOutTime || '10:00');
    const nowIso = now.toISOString().slice(0, 10);
    const nowAbs = toAbsMinutes(nowIso, `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`);
    return { notBefore: Math.max(checkIn, nowAbs), notAfter: checkOut };
  }

  /**
   * Days + classified slots for one resource of one reservation.
   * `pending` are the blocks already placed in the current SAS run: they are not persisted yet, but
   * they occupy their slot and — crucially — keep the resource warm for the next one (§3.4 rule 25).
   */
  function daysFor({ reservation, entry, pending = [], now = new Date() }) {
    const { notBefore, notAfter } = stayBounds(reservation, now);
    const stored = occupancy.listForStay({
      resourceId: entry.resource.id,
      startDate: reservation.startDate,
      endDate: reservation.endDate,
      // This reservation's own hours are replaced by what the SAS commits, so they must not block it.
      excludeReservationId: Number(reservation.id),
    });
    return buildDays({
      resource: entry.resource,
      dayRate: Number(entry.resource.price || 0),
      stayDates: eachDate(reservation.startDate, reservation.endDate),
      occupancy: stored,
      pending: pending.map((b) => ({ date: b.date, start: b.start, end: b.end })),
      notBefore,
      notAfter,
    });
  }

  /** The whole « Planifier les ressources » step payload. `applicable: false` → the step is skipped. */
  function getSchedulingPayload(reservation, { now = new Date() } = {}) {
    const entries = soldSchedulableResources(reservation);
    const pending = [];
    const resourcesPayload = entries.map((entry) => ({
      resourceId: Number(entry.resource.id),
      name: entry.resource.name,
      hoursSold: entry.hoursSold,
      hoursPlaced: entry.hoursPlaced,
      hoursRemaining: entry.hoursRemaining,
      slotDuration: Number(entry.resource.slotDuration || 60),
      minimumUsageMinutes: Number(entry.resource.minimumUsageMinutes || 0),
      // Re-opening the SAS starts from the hours already placed (§3.4 rule 26), each with its own
      // « +X € » badge, as a freshly placed block shows it.
      sessions: entry.sessions.map((session) => ({ ...session, supplement: eveningOf(entry, [session]) })),
      // What the stored hours owe now — the recap's line until the operator moves a block (rule 32).
      supplement: supplementOf(entry, entry.sessions),
      supplementLabel: supplementLabel(entry),
      days: daysFor({ reservation, entry, pending, now }),
    }));
    return {
      applicable: resourcesPayload.some((r) => r.hoursRemaining > 0),
      resources: resourcesPayload,
    };
  }

  /** Slots for ONE resource, refreshed as the operator places blocks. */
  function getFreeSlots({ reservation, resourceId, pending = [], now = new Date() }) {
    const entry = soldSchedulableResources(reservation)
      .find((e) => Number(e.resource.id) === Number(resourceId));
    if (!entry) return null;
    // `pending` is every block on the picker (rule 26), so its supplement is the resource's.
    return { days: daysFor({ reservation, entry, pending, now }), supplement: supplementOf(entry, pending) };
  }

  /**
   * Authoritative check of everything the SAS wants to write. Blocks are validated **cumulatively**:
   * each one sees the ones before it, so two blocks in the same payload cannot overlap each other.
   * Returns the first offender, or `{ ok: true }` with the per-resource evening supplements.
   */
  function validateBlocks({ reservation, blocks = [], now = new Date() }) {
    const entries = soldSchedulableResources(reservation);
    const { notBefore, notAfter } = stayBounds(reservation, now);
    const accepted = new Map(); // resourceId → blocks accepted so far

    for (const block of blocks) {
      const entry = entries.find((e) => Number(e.resource.id) === Number(block?.resourceId));
      if (!entry) return { ok: false, block, reason: 'unknown' };

      const already = accepted.get(Number(block.resourceId)) || [];
      const usedMinutes = already.reduce((sum, b) => sum + (toMinutes(b.end) - toMinutes(b.start)), 0);
      // The SAS REPLACES this reservation's sessions, so the budget is the full sold hours, not the
      // remainder — re-opening a completed SAS must be able to move a block, not just add one.
      const budgetMinutes = Math.max(0, Math.round(entry.hoursSold * 60) - usedMinutes);

      const stored = occupancy.listForStay({
        resourceId: entry.resource.id,
        startDate: reservation.startDate,
        endDate: reservation.endDate,
        excludeReservationId: Number(reservation.id),
      });

      const verdict = validateBlock({
        resource: entry.resource,
        block,
        occupancy: [...stored, ...already.map((b) => ({ date: b.date, start: b.start, end: b.end }))],
        notBefore,
        notAfter,
        remainingMinutes: budgetMinutes,
      });
      if (!verdict.ok) return { ok: false, block, reason: verdict.reason };

      accepted.set(Number(block.resourceId), [...already, block]);
    }

    return { ok: true, supplements: supplementsFor(entries, accepted) };
  }

  return {
    getSchedulingPayload, getFreeSlots, validateBlocks, soldSchedulableResources, stayBounds,
    storedSupplements, supplementLabels,
  };
}

const defaultModel = createModel(db);
defaultModel.create = createModel;

module.exports = defaultModel;
