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
 * Find the most recent laundry day on-or-before `iso`. Returns the ISO date or null when the
 * weekday is invalid.
 */
function previousOrSameLaundryDay(iso, weekday) {
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) return null;
  const delta = (weekdayOf(iso) - weekday + 7) % 7;
  return addDays(iso, -delta);
}

/**
 * Like `previousOrSameLaundryDay` but skips dates the operator marked as not-made
 * (`skippedDates`). Walks backward in 7-day steps until finding a non-skipped Tuesday, or
 * gives up after `maxLookbackDays`. Returns null when no non-skipped trip exists within the
 * lookback (= "haven't done laundry in N weeks" — the simulation then starts from a fully
 * clean stock, which is a defensible degenerate state).
 *
 * specs/skip-laundry-trip.md §3.1 rule 4 — past skips must influence the initial-state
 * computation, not just the forward loop.
 */
function previousOrSameNonSkippedLaundryDay(iso, weekday, skippedDates, maxLookbackDays = 28) {
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) return null;
  let candidate = previousOrSameLaundryDay(iso, weekday);
  let attempts = Math.floor(maxLookbackDays / 7) + 1;
  while (candidate && skippedDates && skippedDates.has(candidate) && attempts > 0) {
    candidate = addDays(candidate, -7);
    attempts -= 1;
  }
  return candidate;
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

  // --- Initial state on `from` ---
  // inCirculation = reservations that ALREADY arrived before `from` and are still staying
  // (startDate < from < endDate). Arrivals ON `from` are deliberately excluded here: the day-`from`
  // iteration of the loop below checks them in (clean → inCirculation). Counting them in both the
  // initial state AND the check-in step double-counted today's arrivals — inflating consumption and
  // producing phantom shortages (specs/linen-inventory-shortage-tracking.md §3.2).
  const inCirculation = zeroByType();
  for (const r of activeReservations) {
    if (r.startDate < from && r.endDate > from) {
      addInto(inCirculation, contractsByReservationId.get(Number(r.id)));
    }
  }
  // atLaundry = drops that occurred at the most recent NON-SKIPPED laundry day on/before
  // `from` and that haven't been picked up yet. With the skip feature, `initLaundryDay` is
  // the most recent Tuesday that the operator actually went — could be further back than
  // 7 days if intervening Tuesdays were skipped. Anything dropped on a skipped Tuesday
  // didn't happen → those reservations stay in `dirty` (handled below).
  const initLaundryDay = previousOrSameNonSkippedLaundryDay(from, laundryWeekday, skippedDates);
  const atLaundry = zeroByType();
  if (initLaundryDay && initLaundryDay > addDays(from, -7) && initLaundryDay <= from) {
    // Drops at initLaundryDay = sum of contracts of reservations whose endDate is in
    // (initLaundryDay - 7, initLaundryDay]. Bounded by 7-day lookback so atLaundry can be
    // computed without loading the full reservation history.
    const dropWindowStart = addDays(initLaundryDay, -7);
    for (const r of activeReservations) {
      if (r.endDate > dropWindowStart && r.endDate <= initLaundryDay) {
        addInto(atLaundry, contractsByReservationId.get(Number(r.id)));
      }
    }
  }
  // dirty = reservations whose endDate is in (lastSuccessfulLaundryDay, from], i.e. NOT yet
  // dropped at the laundry. When intervening Tuesdays are skipped, this naturally
  // accumulates the deferred batches because their endDate falls in the same window.
  const dirty = zeroByType();
  const dirtyWindowStart = initLaundryDay || addDays(from, -7);
  for (const r of activeReservations) {
    if (r.endDate > dirtyWindowStart && r.endDate <= from) {
      addInto(dirty, contractsByReservationId.get(Number(r.id)));
    }
  }
  // clean = stock - inCirculation - dirty - atLaundry  (may go negative on day 0 — that's a
  // real shortage and we surface it as such). Start from a zero-filled record so a partial
  // `stock` (e.g. a caller that omits a type) yields 0, not NaN, for the missing key.
  let clean = addInto(zeroByType(), stock);
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
    // specs/skip-laundry-trip.md §3.2 rules 5-7: a skipped laundry date performs NEITHER the
    // pick-up NOR the drop-off. The dirty stays dirty, the atLaundry stays at the laundry —
    // both backlogs flow forward to the next non-skipped trip naturally because the maps
    // `dirty` and `dropsByLaundryDay` aren't mutated on that day.
    const isLaundryDay = weekdayOf(cursor) === laundryWeekday;
    const isSkipped = isLaundryDay && skippedDates.has(cursor);

    // 1) Pick-ups happen BEFORE check-ins (rule 6) — only on laundry days, and only when the
    // trip wasn't skipped. The lookup is `<= cursor - 7` (not strict `= cursor - 7`) so a
    // batch deferred by a previous skip is finally collected on the next non-skipped trip,
    // alongside the normal 7-days-ago batch. Without the `<=`, the deferred batch would loop
    // forever in `dropsByLaundryDay` and the at-laundry stock would drift permanently.
    if (isLaundryDay && !isSkipped) {
      const pickupCutoff = addDays(cursor, -7);
      const readyKeys = [];
      for (const dropDate of dropsByLaundryDay.keys()) {
        if (dropDate <= pickupCutoff) readyKeys.push(dropDate);
      }
      for (const dropDate of readyKeys) {
        const returning = dropsByLaundryDay.get(dropDate);
        subtractInto(atLaundry, returning);
        addInto(clean, returning);
        dropsByLaundryDay.delete(dropDate);
      }
    }

    // 2) Check-ins on `cursor` — clean → inCirculation. Always run, independent of skip.
    const arrivalsToday = startsByDate.get(cursor) || [];
    for (const r of arrivalsToday) {
      const c = contractsByReservationId.get(Number(r.id));
      addInto(inCirculation, c);
      subtractInto(clean, c);
    }

    // 2.5) Manual additions for THIS laundry day (specs/manual-laundry-additions.md §4 rules 4-5):
    // the operator washes extra linen this trip → it leaves clean and joins the dirty pile, so the
    // drop step (3) washes it and it returns clean on pick-up (+7d). On a SKIPPED trip the drop is
    // skipped, so it stays dirty and defers to the next non-skipped trip — same carry-forward as
    // reservation linen. Conservation holds: what leaves clean returns on pick-up.
    // A NEGATIVE manual value is the mirror move (specs/laundry-manual-removals.md §3 rules 4-5): the
    // operator washed that linen himself, so it goes dirty → clean on the trip date, never joins the
    // at-laundry batch and never comes back on the +7 j pick-up. Capped at the dirty pile of its type:
    // linen still in a guest's room — or already clean — cannot be « washed at home », and inventing it
    // here would break the conservation invariant.
    if (isLaundryDay) {
      const manual = manualAdditionsByDate.get(cursor);
      if (manual) {
        const applied = zeroByType();
        for (const t of ALL_TYPES) {
          const wanted = Number(manual[t] || 0);
          applied[t] = wanted < 0 ? -Math.max(0, Math.min(dirty[t], -wanted)) : wanted;
        }
        addInto(dirty, applied);
        subtractInto(clean, applied);
      }
    }

    // 3) Laundry-day drop: dirty → atLaundry, dirty resets to 0. Skipped trips don't drop.
    if (isLaundryDay && !isSkipped) {
      if (ALL_TYPES.some((t) => dirty[t] > 0)) {
        const dropSnap = cloneByType(dirty);
        addInto(atLaundry, dropSnap);
        subtractInto(dirty, dropSnap);
        // Merge into any batch already recorded for this day instead of overwriting it. When `from`
        // itself is a laundry day, initLaundryDay === from and the initial at-laundry batch is seeded
        // under this very key (see init above); a same-day drop (e.g. a manual addition entered for
        // today) would otherwise replace that seed, stranding the initial batch « at laundry » forever
        // — a phantom permanent shortage. Both batches were dropped on `cursor`, so they return together
        // on the +7d pick-up.
        const existingDrop = dropsByLaundryDay.get(cursor);
        if (existingDrop) addInto(existingDrop, dropSnap);
        else dropsByLaundryDay.set(cursor, dropSnap);
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
