/**
 * Linen inventory simulation engine
 * (specs/linen-inventory-shortage-tracking.md §3.2–3.6).
 *
 * Pure functional core: no DB access. The caller assembles the inputs (stock, reservations,
 * options, propertyDefaults, laundryWeekday, from, to) and the engine walks day-by-day through
 * the horizon, returning a per-day snapshot of every bucket + shortage detection.
 *
 * Data shape conventions:
 *   - Dates are ISO YYYY-MM-DD strings throughout. Internal arithmetic uses UTC-anchored Date
 *     objects (same convention as `utils/laundryWindow.js`) to stay DST-safe.
 *   - The six tracked types are keyed `single`, `double`, `baby`, `large`, `medium`, `small`.
 *     Bed types map to `singleBeds`, `doubleBeds`, `babyBeds`; towel types are integers per
 *     person multiplied by qty.
 *
 * Conservation invariant: for every type `t` and every day `d`,
 *   stock[t] = clean[t] + inCirculation[t] + dirty[t] + atLaundry[t]
 * Asserted by the tests on every day of every scenario.
 */

const BED_TYPES = Object.freeze(['single', 'double', 'baby']);
const TOWEL_TYPES = Object.freeze(['large', 'medium', 'small']);
const ALL_TYPES = Object.freeze([...BED_TYPES, ...TOWEL_TYPES]);

function zeroByType() {
  return { single: 0, double: 0, baby: 0, large: 0, medium: 0, small: 0 };
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
function weekdayOf(iso) { return parseIso(iso).getUTCDay(); }

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
function computeReservationContract({ reservation, bedLinenContext, bathroomContext }) {
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
function buildContractsByReservationId({ reservations, options, reservationOptions, propertyDefaults }) {
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

    const propertyDefaultOptionIds = defaultsByProperty.get(Number(r.propertyId)) || [];
    const propertyDefaultBedOption = propertyDefaultOptionIds
      .map((oid) => optionsById.get(Number(oid)))
      .find((o) => o && Number(o.countsAsBedLinen) === 1) || null;
    const propertyDefaultBathOption = propertyDefaultOptionIds
      .map((oid) => optionsById.get(Number(oid)))
      .find((o) => o && Number(o.countsAsBathroomLinen) === 1) || null;

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
    });

    // Skip reservations with a zero contract (no linen option applies anywhere) — they don't
    // contribute to inventory at all.
    const anyNonZero = ALL_TYPES.some((t) => contract[t] > 0);
    if (anyNonZero) out.set(Number(r.id), contract);
  }
  return out;
}

/**
 * Find the most recent laundry day on-or-before `iso`. Returns the ISO date or null when the
 * weekday is invalid.
 */
function previousOrSameLaundryDay(iso, weekday) {
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) return null;
  const delta = (weekdayOf(iso) - weekday + 7) % 7;
  return addDays(iso, -delta);
}

/**
 * Core engine. Walks day by day from `from` to `to` and returns:
 *   {
 *     days: [{ date, clean, inCirculation, dirty, atLaundry,
 *              shortagesToday: [{ type, missing }] }, ...],
 *     shortagesByType: { single: { firstDate, maxMissing, impactedReservationIds: number[] }, ... }
 *   }
 *
 * Inputs:
 *   stock — { single, double, baby, large, medium, small } (integers ≥ 0)
 *   reservations, options, reservationOptions, propertyDefaults — see helpers above
 *   laundryWeekday — 0..6 (Date.getDay() convention)
 *   from, to — ISO dates (inclusive). `to` should be ≥ from; if to < from the result is empty.
 */
function simulateInventory({
  stock, reservations, options, reservationOptions, propertyDefaults,
  laundryWeekday, from, to,
}) {
  // --- Pre-compute per-reservation contracts (skips devis + zero contracts) ---
  const contractsByReservationId = buildContractsByReservationId({
    reservations, options, reservationOptions, propertyDefaults,
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

  // --- Initial state on `from` ---
  // inCirculation = reservations active on `from` (startDate <= from < endDate)
  const inCirculation = zeroByType();
  for (const r of activeReservations) {
    if (r.startDate <= from && r.endDate > from) {
      addInto(inCirculation, contractsByReservationId.get(Number(r.id)));
    }
  }
  // atLaundry = drops that occurred at the most recent laundry day in (from-7, from] and that
  // haven't been picked up yet. The pick-up happens on the next laundry day = previous-L + 7.
  // For initial state we approximate: atLaundry = drops at previousLaundryDay if that day is
  // in (from - 7, from] (i.e. less than 7 days ago).
  const initLaundryDay = previousOrSameLaundryDay(from, laundryWeekday);
  const atLaundry = zeroByType();
  if (initLaundryDay && initLaundryDay > addDays(from, -7) && initLaundryDay <= from) {
    // Drops at initLaundryDay = sum of contracts of reservations whose endDate is in
    // (initLaundryDay - 7, initLaundryDay].
    const dropWindowStart = addDays(initLaundryDay, -7);
    for (const r of activeReservations) {
      if (r.endDate > dropWindowStart && r.endDate <= initLaundryDay) {
        addInto(atLaundry, contractsByReservationId.get(Number(r.id)));
      }
    }
  }
  // dirty = reservations whose endDate is in (lastLaundryDay, from], not yet dropped.
  const dirty = zeroByType();
  const dirtyWindowStart = initLaundryDay || addDays(from, -7);
  for (const r of activeReservations) {
    if (r.endDate > dirtyWindowStart && r.endDate <= from) {
      addInto(dirty, contractsByReservationId.get(Number(r.id)));
    }
  }
  // clean = stock - inCirculation - dirty - atLaundry  (may go negative on day 0 — that's a
  // real shortage and we surface it as such).
  let clean = cloneByType(stock);
  subtractInto(clean, inCirculation);
  subtractInto(clean, dirty);
  subtractInto(clean, atLaundry);

  // --- Walk through the horizon ---
  const days = [];
  const shortagesByType = {};
  for (const t of ALL_TYPES) shortagesByType[t] = { firstDate: null, maxMissing: 0, impactedReservationIds: new Set() };

  // Track drops per laundry day so we know what to pick up 7 days later.
  const dropsByLaundryDay = new Map();
  if (initLaundryDay && initLaundryDay > addDays(from, -7) && initLaundryDay <= from) {
    dropsByLaundryDay.set(initLaundryDay, cloneByType(atLaundry));
  }

  let cursor = from;
  // Guard against runaway loops on malformed inputs.
  const maxIter = 366 * 5;
  let iter = 0;

  while (cursor <= to && iter < maxIter) {
    // 1) Pick-ups happen BEFORE check-ins (rule 6) — only on laundry days.
    if (weekdayOf(cursor) === laundryWeekday) {
      const previousLaundryDay = addDays(cursor, -7);
      const returning = dropsByLaundryDay.get(previousLaundryDay);
      if (returning) {
        subtractInto(atLaundry, returning);
        addInto(clean, returning);
        dropsByLaundryDay.delete(previousLaundryDay);
      }
    }

    // 2) Check-ins on `cursor` — clean → inCirculation.
    const arrivalsToday = startsByDate.get(cursor) || [];
    for (const r of arrivalsToday) {
      const c = contractsByReservationId.get(Number(r.id));
      addInto(inCirculation, c);
      subtractInto(clean, c);
    }

    // 3) Laundry-day drop: dirty → atLaundry, dirty resets to 0.
    if (weekdayOf(cursor) === laundryWeekday) {
      if (ALL_TYPES.some((t) => dirty[t] > 0)) {
        const dropSnap = cloneByType(dirty);
        addInto(atLaundry, dropSnap);
        subtractInto(dirty, dropSnap);
        dropsByLaundryDay.set(cursor, dropSnap);
      }
    }

    // 4) Detect shortages on this day's end-of-day state. `clean[t] < 0` ⇒ shortage of `-clean[t]`.
    const shortagesToday = [];
    for (const t of ALL_TYPES) {
      if (Number(stock[t]) > 0 && clean[t] < 0) {
        shortagesToday.push({ type: t, missing: -clean[t] });
        const agg = shortagesByType[t];
        if (!agg.firstDate) agg.firstDate = cursor;
        if (-clean[t] > agg.maxMissing) agg.maxMissing = -clean[t];
        for (const a of arrivalsToday) {
          const c = contractsByReservationId.get(Number(a.id));
          if (c && c[t] > 0) agg.impactedReservationIds.add(Number(a.id));
        }
      }
    }

    days.push({
      date: cursor,
      clean: cloneByType(clean),
      inCirculation: cloneByType(inCirculation),
      dirty: cloneByType(dirty),
      atLaundry: cloneByType(atLaundry),
      shortagesToday,
    });

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
    parseIso, toIso, addDays, weekdayOf, previousOrSameLaundryDay, zeroByType,
  },
};
