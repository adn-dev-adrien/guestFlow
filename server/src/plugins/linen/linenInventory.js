/**
 * Linen inventory simulation engine
 * (specs/linen-inventory-shortage-tracking.md §3.2–3.6).
 *
 * Pure functional core: no DB access. The caller assembles the inputs (stock, reservations,
 * options, propertyDefaults, schedule, from, to) and the engine walks day-by-day through
 * the horizon, returning a per-day snapshot of every bucket + shortage detection.
 *
 * The walk starts 42 days before `from` (28-day skip lookback + the 14-day maximum laundry
 * turnaround) from a neutral state — the stays in progress installed, everything else clean — and
 * replays every day with one loop, so the state on `from` needs no seed and no special case
 * (specs/linen-laundry-days.md §3.3 rule 16). The linen at the laundry is a list of batches, each
 * ready `turnaroundDays` after its drop (rule 15).
 *
 * Data shape conventions:
 *   - Dates are ISO YYYY-MM-DD strings throughout. Internal arithmetic uses UTC-anchored Date
 *     objects (same convention as `laundryWindow.js`) to stay DST-safe.
 *   - The six tracked types are keyed `single`, `double`, `baby`, `large`, `medium`, `small`.
 *     Bed types map to `singleBeds`, `doubleBeds`, `babyBeds`; towel types are integers per
 *     person multiplied by qty.
 *
 * Conservation invariant: for every type `t` and every day `d`,
 *   stock[t] = clean[t] + inCirculation[t] + dirty[t] + atLaundry[t]
 * Asserted by the tests on every day of every scenario.
 */

const { addBatch, collectBatches, totalOf } = require('./laundryBatches');
const { REPLAY_DAYS } = require('./laundrySchedule');

const BED_TYPES = Object.freeze(['single', 'double', 'baby']);
// `bathMat` (specs/laundry-bath-mat.md) is a towel-family type: flat per-stay quantity from the
// reservation's property, contributed when the "Tapis de bain" option is active.
const TOWEL_TYPES = Object.freeze(['large', 'medium', 'small', 'bathMat']);
const ALL_TYPES = Object.freeze([...BED_TYPES, ...TOWEL_TYPES]);

function zeroByType() {
  return { single: 0, double: 0, baby: 0, large: 0, medium: 0, small: 0, bathMat: 0 };
}

function addInto(target, addend) {
  for (const t of ALL_TYPES) target[t] += Number(addend[t] || 0);
  return target;
}

function subtractInto(target, subtrahend) {
  for (const t of ALL_TYPES) target[t] -= Number(subtrahend[t] || 0);
  return target;
}

function cloneByType(src) {
  return { ...src };
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function parseIso(iso) {
  if (!ISO_DATE_RE.test(String(iso || ''))) throw new Error(`INVALID_ISO_DATE:${iso}`);
  return new Date(`${iso}T00:00:00Z`);
}
function toIso(date) { return date.toISOString().slice(0, 10); }
function addDays(iso, n) {
  const d = parseIso(iso);
  d.setUTCDate(d.getUTCDate() + Number(n));
  return toIso(d);
}

/**
 * Compute the linen contract for ONE reservation: how many of each type it consumes for the
 * duration of the stay. The contract reuses the rules pinned by
 * `weekly-bed-linen-tracking.md`:
 *   - Bed: singleBeds × linenIncludesSingle + doubleBeds × linenIncludesDouble + babyBeds × linenIncludesBaby
 *     iff a bed-linen-flagged option applies (explicit row OR property default — §3.7).
 *   - Bathroom: persons × Σqty × towel<Size>PerPerson per size, where persons = adults + teens
 *     + children and Σqty is the SUM of `reservation_options.quantity` over bathroom-flagged
 *     options on the reservation (or 1.0 when only the property default applies).
 *
 * Inputs:
 *   reservation — { adults, teens, children, singleBeds, doubleBeds, babyBeds, propertyId }
 *   bedLinenContext — { flagsByOption: Map<optionId, {linenIncludesSingle, ...}>,
 *                       explicitOptionIds: Set<number>, propertyDefaultOption: { ... } | null }
 *   bathroomContext — same shape with towel<Size>PerPerson + explicit qtySum
 */
function computeReservationContract({ reservation, bedLinenContext, bathroomContext, bathMatContext }) {
  const out = zeroByType();

  // --- bed-linen contract ---
  let bedOption = null;
  if (bedLinenContext.explicitOption) bedOption = bedLinenContext.explicitOption;
  else if (bedLinenContext.propertyDefaultOption) bedOption = bedLinenContext.propertyDefaultOption;
  if (bedOption) {
    out.single = Math.max(0, Number(reservation.singleBeds || 0)) * (Number(bedOption.linenIncludesSingle) === 1 ? 1 : 0);
    out.double = Math.max(0, Number(reservation.doubleBeds || 0)) * (Number(bedOption.linenIncludesDouble) === 1 ? 1 : 0);
    out.baby   = Math.max(0, Number(reservation.babyBeds   || 0)) * (Number(bedOption.linenIncludesBaby)   === 1 ? 1 : 0);
  }

  // --- bathroom-linen contract ---
  let bathOption = null;
  let qtySum = 0;
  if (bathroomContext.explicitOption) {
    bathOption = bathroomContext.explicitOption;
    qtySum = Number(bathroomContext.explicitQtySum || 0);
  } else if (bathroomContext.propertyDefaultOption) {
    bathOption = bathroomContext.propertyDefaultOption;
    qtySum = 1.0;
  }
  if (bathOption) {
    const persons = Math.max(0, Number(reservation.adults || 0))
                  + Math.max(0, Number(reservation.teens   || 0))
                  + Math.max(0, Number(reservation.children|| 0));
    out.large  = Math.max(0, Math.round(persons * qtySum * Number(bathOption.towelLargePerPerson  || 0)));
    out.medium = Math.max(0, Math.round(persons * qtySum * Number(bathOption.towelMediumPerPerson || 0)));
    out.small  = Math.max(0, Math.round(persons * qtySum * Number(bathOption.towelSmallPerPerson  || 0)));
  }

  // --- bath-mat contract (specs/laundry-bath-mat.md §3 rules 5-6) ---
  // Flat per-stay quantity (the reservation's property quantity), contributed iff the bath-mat
  // option is active on the reservation (explicit row OR property default). Independent of guests.
  if (bathMatContext && bathMatContext.active) {
    out.bathMat = Math.max(0, Math.floor(Number(bathMatContext.quantity || 0)));
  }
  return out;
}

/**
 * Given the raw reservations + options + property defaults, build a per-reservation lookup of
 * its linen contract (a `{ single, double, baby, large, medium, small }` object). Skips
 * devis-stage reservations entirely.
 *
 * Inputs:
 *   reservations — array of { id, kind, propertyId, startDate, endDate, singleBeds, doubleBeds,
 *                  babyBeds, adults, teens, children }
 *   options — array of { id, countsAsBedLinen, countsAsBathroomLinen, linenIncludes*,
 *             towel<Size>PerPerson }
 *   reservationOptions — array of { reservationId, optionId, quantity }
 *   propertyDefaults — array of { propertyId, optionId }  (the offered flag is irrelevant here)
 */
function buildContractsByReservationId({ reservations, options, reservationOptions, propertyDefaults, bathMatByProperty = new Map() }) {
  const optionsById = new Map(options.map((o) => [Number(o.id), o]));

  // Index reservation_options per reservation for fast lookup.
  const explicitByReservation = new Map();
  for (const ro of reservationOptions) {
    const rid = Number(ro.reservationId);
    if (!explicitByReservation.has(rid)) explicitByReservation.set(rid, []);
    explicitByReservation.get(rid).push(ro);
  }

  // Property-default options per property.
  const defaultsByProperty = new Map();
  for (const pd of propertyDefaults) {
    const pid = Number(pd.propertyId);
    if (!defaultsByProperty.has(pid)) defaultsByProperty.set(pid, []);
    defaultsByProperty.get(pid).push(Number(pd.optionId));
  }

  const out = new Map();
  for (const r of reservations) {
    if (String(r.kind || 'reservation') !== 'reservation') continue;

    // Resolve the bed-linen + bathroom-linen "active" options on this reservation.
    const explicitRows = explicitByReservation.get(Number(r.id)) || [];
    const explicitBedOption = explicitRows
      .map((ro) => optionsById.get(Number(ro.optionId)))
      .find((o) => o && Number(o.countsAsBedLinen) === 1);
    const explicitBathOption = explicitRows
      .map((ro) => optionsById.get(Number(ro.optionId)))
      .find((o) => o && Number(o.countsAsBathroomLinen) === 1);
    const explicitBathRows = explicitRows.filter((ro) => {
      const o = optionsById.get(Number(ro.optionId));
      return o && Number(o.countsAsBathroomLinen) === 1;
    });
    const explicitBathQtySum = explicitBathRows.reduce((s, ro) => s + Number(ro.quantity || 0), 0);

    const explicitBathMatOption = explicitRows
      .map((ro) => optionsById.get(Number(ro.optionId)))
      .find((o) => o && Number(o.countsAsBathMat) === 1);

    const propertyDefaultOptionIds = defaultsByProperty.get(Number(r.propertyId)) || [];
    // specs/laundry-counts-explicit-option-only.md §3.1 rules 3-5 — mirrors `laundryModel`: for a
    // VISIBLE option only the ticked row creates a contract, so the projection and the laundry card
    // never disagree. INTERNAL options (never persisted onto a reservation) keep the default source.
    const isInternal = (o) => o && Number(o.displayToClient === undefined ? 1 : o.displayToClient) === 0;
    const propertyDefaultBedOption = propertyDefaultOptionIds
      .map((oid) => optionsById.get(Number(oid)))
      .find((o) => o && Number(o.countsAsBedLinen) === 1 && isInternal(o)) || null;
    const propertyDefaultBathOption = propertyDefaultOptionIds
      .map((oid) => optionsById.get(Number(oid)))
      .find((o) => o && Number(o.countsAsBathroomLinen) === 1 && isInternal(o)) || null;
    const propertyDefaultBathMatOption = propertyDefaultOptionIds
      .map((oid) => optionsById.get(Number(oid)))
      .find((o) => o && Number(o.countsAsBathMat) === 1) || null;

    const bathMatActive = Boolean(explicitBathMatOption || propertyDefaultBathMatOption);

    const contract = computeReservationContract({
      reservation: r,
      bedLinenContext: {
        explicitOption: explicitBedOption || null,
        propertyDefaultOption: propertyDefaultBedOption,
      },
      bathroomContext: {
        explicitOption: explicitBathOption || null,
        explicitQtySum: explicitBathQtySum,
        propertyDefaultOption: propertyDefaultBathOption,
      },
      bathMatContext: {
        active: bathMatActive,
        quantity: bathMatActive ? Number(bathMatByProperty.get(Number(r.propertyId)) || 0) : 0,
      },
    });

    // Skip reservations with a zero contract (no linen option applies anywhere) — they don't
    // contribute to inventory at all.
    const anyNonZero = ALL_TYPES.some((t) => contract[t] > 0);
    if (anyNonZero) out.set(Number(r.id), contract);
  }
  return out;
}


/**
 * Core engine. Walks day by day from `from − 42` to `to`, emits the days from `from`, and returns:
 *   {
 *     days: [{ date, clean, inCirculation, dirty, atLaundry, isTripDay,
 *              dropped, pickedUp, batches,
 *              shortagesToday: [{ type, missing }] }, ...],
 *     shortagesByType: { single: { firstDate, lastShortageDate, laterShortage, maxMissing, impactedReservationIds }, ... }
 *   }
 * `dropped` / `pickedUp` are the moves of a trip day (zeros on any other day); `batches` is what
 * stays at the laundry at the end of the day, `[{ dropDate, readyFrom, counts }]`.
 *
 * Inputs:
 *   stock — { single, double, baby, large, medium, small } (integers ≥ 0)
 *   reservations, options, reservationOptions, propertyDefaults — see helpers above
 *   schedule — `createSchedule(...)` from `laundrySchedule.js`: which days are laundry days, and the
 *     turnaround of each drop
 *   from, to — ISO dates (inclusive). `to` should be ≥ from; if to < from the result is empty.
 */
function simulateInventory({
  stock, reservations, options, reservationOptions, propertyDefaults,
  schedule, from, to,
  // specs/laundry-bath-mat.md §4 — Map<propertyId, quantity> of bath mats per stay for the
  // "Tapis de bain" option. Default empty Map keeps every pre-feature caller behaviour-identical.
  bathMatByProperty = new Map(),
  // specs/skip-laundry-trip.md §3.2 — a Set<string> of laundry dates the operator marked as
  // not-made. On a skipped date the engine performs NEITHER the pick-up NOR the drop-off,
  // both backlogs flow forward to the next non-skipped trip. Default `new Set()` keeps every
  // pre-feature caller (and every existing test fixture) behaviour-identical.
  skippedDates = new Set(),
  // specs/manual-laundry-additions.md §4 — a Map<'YYYY-MM-DD', {single,double,baby,large,medium,small}>
  // of operator-entered extra linen per laundry trip. Washed like reservation linen (clean → laundry →
  // clean) on the trip's drop. Default empty Map keeps every pre-feature caller behaviour-identical.
  manualAdditionsByDate = new Map(),
  // specs/laundry-extra-trip.md §3.3 — a Map<'YYYY-MM-DD', { pickUpAll, pickUp: {single,…,bathMat} }>
  // of laundry trips on a FREE date (early pick-up). On such a day the engine takes the ready batches
  // back (or the declared per-type quantities, capped at what is ready) before the check-ins, then
  // drops the whole dirty pile. A record stored on a regular laundry day is inert (that day is already
  // a trip). Default empty Map keeps every pre-feature caller behaviour-identical.
  extraTripsByDate = new Map(),
}) {
  // --- Pre-compute per-reservation contracts (skips devis + zero contracts) ---
  const contractsByReservationId = buildContractsByReservationId({
    reservations, options, reservationOptions, propertyDefaults, bathMatByProperty,
  });

  // Per-day index: reservations whose startDate === D and whose endDate === D.
  // Reservations are filtered to ones that have a contract (any non-zero type).
  const activeReservations = reservations.filter((r) => contractsByReservationId.has(Number(r.id)));
  const startsByDate = new Map();
  const endsByDate = new Map();
  for (const r of activeReservations) {
    if (!startsByDate.has(r.startDate)) startsByDate.set(r.startDate, []);
    startsByDate.get(r.startDate).push(r);
    if (!endsByDate.has(r.endDate)) endsByDate.set(r.endDate, []);
    endsByDate.get(r.endDate).push(r);
  }

  // --- Neutral state on the first replayed day ---
  // inCirculation = stays that ALREADY arrived before `start` and are still staying
  // (startDate < start < endDate). Arrivals ON `start` are checked in by the loop itself; counting
  // them here too double-counted them and produced phantom shortages
  // (specs/linen-inventory-shortage-tracking.md §3.2). Nothing is dirty and nothing is at the
  // laundry: the replay builds both, so no seed and no special case is needed.
  const start = addDays(from, -REPLAY_DAYS);
  const inCirculation = zeroByType();
  for (const r of activeReservations) {
    if (r.startDate < start && r.endDate > start) {
      addInto(inCirculation, contractsByReservationId.get(Number(r.id)));
    }
  }
  const dirty = zeroByType();
  // Linen the operator washed himself, waiting for the next drop to be taken off the dirty pile.
  const washedAtHome = zeroByType();
  let atLaundry = [];
  // clean = stock - inCirculation (may go negative — a real shortage, surfaced as such). Start from a
  // zero-filled record so a partial `stock` (a caller that omits a type) yields 0, not NaN.
  const clean = addInto(zeroByType(), stock);
  subtractInto(clean, inCirculation);

  // --- Walk through the horizon ---
  const days = [];
  const shortagesByType = {};
  for (const t of ALL_TYPES) {
    shortagesByType[t] = {
      firstDate: null, lastDate: null, firstSpellOver: false, laterSpell: false, maxMissing: 0, impactedReservationIds: new Set(),
    };
  }

  let cursor = start;
  // Guard against runaway loops on malformed inputs.
  const maxIter = 366 * 5 + REPLAY_DAYS;
  let iter = 0;

  while (cursor <= to && iter < maxIter) {
    // specs/skip-laundry-trip.md §3.2 rules 5-7: a skipped laundry date performs NEITHER the
    // pick-up NOR the drop-off. The dirty stays dirty, the batches stay at the laundry —
    // both backlogs flow forward to the next non-skipped trip naturally because neither `dirty`
    // nor the batch list is mutated on that day.
    const isLaundryDay = schedule.isRegularDay(cursor);
    const isSkipped = isLaundryDay && skippedDates.has(cursor);
    // specs/laundry-extra-trip.md §3.3 rule 11 — a trip day is a non-skipped regular laundry day OR
    // an active extra trip (never on a regular laundry day: that record is inert).
    const extraTrip = !isLaundryDay ? extraTripsByDate.get(cursor) : undefined;
    const isTripDay = (isLaundryDay && !isSkipped) || Boolean(extraTrip);
    const pickedUp = zeroByType();
    const dropped = zeroByType();

    // 1) Pick-ups happen BEFORE check-ins (rule 6) — on every trip day. A regular trip, and an extra
    // trip that picks everything up, collects every batch whose `readyFrom` has come; a partial extra
    // trip collects the declared quantities per type, oldest batch first, capped at what is ready.
    // What is not collected stays at the laundry for the next trip (specs/linen-laundry-days.md rule
    // 10, specs/laundry-extra-trip.md §3.3 rule 12).
    if (isTripDay) {
      const wanted = extraTrip && extraTrip.pickUpAll === false ? extraTrip.pickUp || {} : null;
      const collected = collectBatches(atLaundry, cursor, ALL_TYPES, wanted);
      atLaundry = collected.remaining;
      addInto(pickedUp, collected.collected);
      addInto(clean, collected.collected);
    }

    // 2) Check-ins on `cursor` — clean → inCirculation. Always run, independent of skip.
    const arrivalsToday = startsByDate.get(cursor) || [];
    for (const r of arrivalsToday) {
      const c = contractsByReservationId.get(Number(r.id));
      addInto(inCirculation, c);
      subtractInto(clean, c);
    }

    // 2.5) Manual lines of THIS date, whatever the date is (the Planning window sums count them too, so a
    // line left on a date that a schedule change turned into a non-laundry day still reaches the next trip).
    // A positive line (specs/manual-laundry-additions.md §4 rules 4-5): the operator washes extra linen, it
    // leaves clean and joins the dirty pile, so the next drop washes it and it returns clean on pick-up. On a
    // SKIPPED trip the drop is skipped, so it stays dirty and defers to the next non-skipped trip — same
    // carry-forward as reservation linen. A NEGATIVE line is the mirror move
    // (specs/laundry-manual-removals.md §3 rules 4-5): the operator washed that linen himself. It waits for
    // the next drop and is capped THERE at the dirty pile of its type — the rule the Planning ledger applies
    // (a window's sum floored at 0) — so the two agree whatever the date of the line. Linen still in a
    // guest's room, or already clean, cannot be « washed at home »; inventing it would break conservation.
    const manual = manualAdditionsByDate.get(cursor);
    if (manual) {
      for (const t of ALL_TYPES) {
        const wanted = Number(manual[t] || 0);
        if (wanted > 0) {
          dirty[t] += wanted;
          clean[t] -= wanted;
        } else if (wanted < 0) {
          washedAtHome[t] += -wanted;
        }
      }
    }

    // 3) Trip-day drop: the whole dirty pile becomes a batch, ready `turnaroundDays` later; dirty
    // resets to 0. Skipped days don't drop.
    if (isTripDay) {
      for (const t of ALL_TYPES) {
        const washed = Math.max(0, Math.min(dirty[t], washedAtHome[t]));
        dirty[t] -= washed;
        clean[t] += washed;
        washedAtHome[t] = 0;
      }
      addInto(dropped, dirty);
      atLaundry = addBatch(atLaundry, { dropDate: cursor, readyFrom: schedule.readyFrom(cursor), counts: dropped });
      subtractInto(dirty, dropped);
    }

    // 4) Detect shortages on this day's end-of-day state. `clean[t] < 0` ⇒ shortage of `-clean[t]`.
    // The days before `from` are only the warm-up: neither emitted nor counted.
    if (cursor >= from) {
      const shortagesToday = [];
      for (const t of ALL_TYPES) {
        const agg = shortagesByType[t];
        if (Number(stock[t]) > 0 && clean[t] < 0) {
          shortagesToday.push({ type: t, missing: -clean[t] });
          if (!agg.firstDate) agg.firstDate = cursor;
          // specs/linen-laundry-days.md rule 18 — the first spell runs until the first day with a clean sheet
          // for everyone again; a shortage after that is a later spell, flagged, not merged into it.
          if (!agg.firstSpellOver) agg.lastDate = cursor;
          else agg.laterSpell = true;
          if (-clean[t] > agg.maxMissing) agg.maxMissing = -clean[t];
          for (const a of arrivalsToday) {
            const c = contractsByReservationId.get(Number(a.id));
            if (c && c[t] > 0) agg.impactedReservationIds.add(Number(a.id));
          }
        } else if (agg.firstDate && Number(stock[t]) > 0) {
          agg.firstSpellOver = true;
        }
      }

      days.push({
        date: cursor,
        clean: cloneByType(clean),
        inCirculation: cloneByType(inCirculation),
        dirty: cloneByType(dirty),
        atLaundry: totalOf(atLaundry, ALL_TYPES).counts,
        shortagesToday,
        isTripDay,
        dropped,
        pickedUp,
        batches: atLaundry.map((b) => ({ ...b, counts: { ...b.counts } })),
      });
    }

    // 5) Prepare for next day: tomorrow's check-outs leave inCirculation → dirty.
    const tomorrow = addDays(cursor, 1);
    const checkoutsTomorrow = endsByDate.get(tomorrow) || [];
    for (const r of checkoutsTomorrow) {
      const c = contractsByReservationId.get(Number(r.id));
      subtractInto(inCirculation, c);
      addInto(dirty, c);
    }

    cursor = tomorrow;
    iter += 1;
  }

  // Convert the impactedReservationIds Sets to sorted arrays for the JSON contract.
  const shortagesByTypeOut = {};
  for (const t of ALL_TYPES) {
    shortagesByTypeOut[t] = {
      firstDate: shortagesByType[t].firstDate,
      maxMissing: shortagesByType[t].maxMissing,
      // null while the first spell is still running at the horizon.
      lastShortageDate: shortagesByType[t].firstSpellOver ? shortagesByType[t].lastDate : null,
      laterShortage: shortagesByType[t].laterSpell,
      impactedReservationIds: Array.from(shortagesByType[t].impactedReservationIds).sort((a, b) => a - b),
    };
  }

  return { days, shortagesByType: shortagesByTypeOut };
}

/**
 * Convenience: compute the horizon `to` date = max(reservations.endDate) (excluding devis).
 * Returns null when there are no qualifying reservations.
 */
function findHorizon(reservations) {
  let horizon = null;
  for (const r of reservations) {
    if (String(r.kind || 'reservation') !== 'reservation') continue;
    if (!horizon || r.endDate > horizon) horizon = r.endDate;
  }
  return horizon;
}

module.exports = {
  simulateInventory,
  findHorizon,
  buildContractsByReservationId,
  computeReservationContract,
  ALL_TYPES,
  BED_TYPES,
  TOWEL_TYPES,
  // exported for tests
  __test: {
    parseIso, toIso, addDays, zeroByType,
  },
};
