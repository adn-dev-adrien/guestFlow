/**
 * Locked snapshots and « offert » of an article line (specs/pricing-components.md §3 rules 13, 14, 47) — the helpers
 * the engine has always used to keep a sold line at what it was sold for, moved unchanged. The head applies them; no
 * family does. `mergeLineWithLockedSnapshot` takes an optional trace function as its second argument (the engine's
 * DEBUG_RESOURCE_LINES logger).
 *
 * Internal to `articles/`.
 */
const { roundMoney } = require('../money');
const { normalizeBilledUnits } = require('../allowances');

/**
 * The units a line was SOLD at, read from its own snapshot — `null` when the line is new
 * (specs/unscheduled-card-option.md rule 3).
 *
 * A card option sold by the website carries its portions here and nowhere else: its moments are not
 * placed yet, so there is nothing to recompute them from. Anchoring the unscheduled price on this
 * figure is what makes a paid breakfast survive a conversion, a fiche save and every engine replay.
 */
function soldBilledUnits(lockedLine) {
  if (!lockedLine) return null;
  const raw = lockedLine.billedUnits !== undefined ? lockedLine.billedUnits : lockedLine.quantity;
  const units = normalizeBilledUnits(raw);
  return units > 0 ? units : null;
}

function mergeLineWithLockedSnapshot({
  lockedLine,
  targetBilledUnits,
  currentUnitPrice,
}, debugResourceLine = () => {}) {
  debugResourceLine('merge.locked_snapshot.input', {
    lockedLine,
    targetBilledUnits,
    currentUnitPrice,
  });

  const resolvedTargetUnits = normalizeBilledUnits(targetBilledUnits);
  const normalizedCurrentUnitPrice = roundMoney(currentUnitPrice);

  debugResourceLine('merge.locked_snapshot.normalized', {
    resolvedTargetUnits,
    normalizedCurrentUnitPrice,
  });

  if (!lockedLine) {
    const result = {
      billedUnits: resolvedTargetUnits,
      totalPrice: roundMoney(resolvedTargetUnits * normalizedCurrentUnitPrice),
      unitPrice: normalizedCurrentUnitPrice,
    };
    debugResourceLine('merge.locked_snapshot.no_locked_line', { result });
    return result;
  }

  const lockedTotal = roundMoney(lockedLine.totalPrice);
  const lockedUnits = normalizeBilledUnits(
    lockedLine.billedUnits !== undefined
      ? lockedLine.billedUnits
      : lockedLine.quantity
  );
  const lockedUnitPrice = lockedUnits > 0
    ? roundMoney(lockedTotal / lockedUnits)
    : roundMoney(lockedLine.unitPrice || normalizedCurrentUnitPrice);

  debugResourceLine('merge.locked_snapshot.locked_values', {
    lockedTotal,
    lockedUnits,
    lockedUnitPrice,
  });

  if (resolvedTargetUnits === lockedUnits) {
    const result = {
      billedUnits: lockedUnits,
      totalPrice: lockedTotal,
      unitPrice: lockedUnitPrice,
    };
    debugResourceLine('merge.locked_snapshot.same_units', { result });
    return result;
  }

  if (resolvedTargetUnits > lockedUnits) {
    const deltaUnits = resolvedTargetUnits - lockedUnits;
    const mergedTotal = roundMoney(lockedTotal + deltaUnits * normalizedCurrentUnitPrice);
    const result = {
      billedUnits: resolvedTargetUnits,
      totalPrice: mergedTotal,
      unitPrice: resolvedTargetUnits > 0 ? roundMoney(mergedTotal / resolvedTargetUnits) : normalizedCurrentUnitPrice,
    };
    debugResourceLine('merge.locked_snapshot.increase_units', {
      deltaUnits,
      mergedTotal,
      result,
    });
    return result;
  }

  const removedUnits = lockedUnits - resolvedTargetUnits;
  const reducedTotal = roundMoney(Math.max(0, lockedTotal - removedUnits * lockedUnitPrice));
  const result = {
    billedUnits: resolvedTargetUnits,
    totalPrice: reducedTotal,
    unitPrice: resolvedTargetUnits > 0 ? roundMoney(reducedTotal / resolvedTargetUnits) : lockedUnitPrice,
  };
  debugResourceLine('merge.locked_snapshot.decrease_units', {
    removedUnits,
    reducedTotal,
    result,
  });
  return result;
}

/**
 * A locked line that was "offered" is stored with totalPrice = 0, which would erase its real price
 * (the merge derives unit price from total/units). To keep offering lossless, reconstruct the real
 * total from the stored unit price before merging.
 *
 * If the stored unit price was itself lost (0) — legacy data where an offered line was persisted
 * without its unit price — fall back to `fallbackUnitPrice` (the current catalog/effective unit
 * price the caller already resolved). This makes un-offering re-price from the catalog instead of
 * staying at 0, matching the spec's "offered toggle is lossless" contract
 * (specs/pricing-engine-thin-client.md §14). A genuinely free line (no stored unit AND no catalog
 * price) is still left at 0.
 */
function reconstructLockedRealTotal(lockedLine, fallbackUnitPrice = 0) {
  if (!lockedLine) return lockedLine;
  const total = roundMoney(lockedLine.totalPrice);
  if (total > 0) return lockedLine;
  const units = normalizeBilledUnits(
    lockedLine.billedUnits !== undefined ? lockedLine.billedUnits : lockedLine.quantity
  );
  const unit = roundMoney(lockedLine.unitPrice || 0) || roundMoney(fallbackUnitPrice || 0);
  if (units > 0 && unit > 0) {
    return { ...lockedLine, totalPrice: roundMoney(units * unit), unitPrice: unit };
  }
  return lockedLine;
}

/**
 * The unit price a line was SOLD at, for the paths that rebuild their billed units from scratch on
 * every save (planning-card occurrences) and therefore cannot go through
 * `mergeLineWithLockedSnapshot`. Falls back to `currentUnitPrice` when the booking carries no
 * snapshot for that line — a fresh quote, or a line added today.
 *
 * The stored `unitPrice` is preferred over `totalPrice / billedUnits`: the total is NET of the free
 * units included in the rate (specs/tariff-recipes/spec.md §3.9 rule 52bis) while `billedUnits` is
 * gross, so the division would deflate the price of an option covered by a welcome pack.
 */
function lockedUnitPriceOr(lockedLine, currentUnitPrice) {
  if (!lockedLine) return currentUnitPrice;
  const stored = roundMoney(lockedLine.unitPrice);
  if (stored > 0) return stored;
  const units = normalizeBilledUnits(
    lockedLine.billedUnits !== undefined ? lockedLine.billedUnits : lockedLine.quantity
  );
  const total = roundMoney(lockedLine.totalPrice);
  if (units > 0 && total > 0) return roundMoney(total / units);
  return currentUnitPrice;
}

/**
 * specs/tariff-recipes/spec.md §3.9 rules 52bis and 56 — a sold line stores its
 * total NET of the free units the rate includes, while `billedUnits` is gross. Merging that net total
 * as if it covered every unit derived a deflated unit price, and the free units were then deducted a
 * second time: « Jus 6 € ×3, 1 offert » went 12 → 8 → 5,34 → 3,56 over three saves. The free units are
 * added back at the STORED unit price so the merge works on the gross line, and are deducted once,
 * after it, by `applyFreeUnitsToLine`. A line stored at 0 (offered, or wholly free) is left to
 * `reconstructLockedRealTotal`, which already rebuilds it gross.
 */
function lockedLineGrossOfFreeUnits(lockedLine, freeUnits) {
  if (!lockedLine) return lockedLine;
  const free = Math.max(0, Number(freeUnits || 0));
  const total = roundMoney(lockedLine.totalPrice);
  const unit = roundMoney(lockedLine.unitPrice);
  if (free <= 0 || total <= 0 || unit <= 0) return lockedLine;
  const units = normalizeBilledUnits(
    lockedLine.billedUnits !== undefined ? lockedLine.billedUnits : lockedLine.quantity
  );
  return { ...lockedLine, totalPrice: roundMoney(total + Math.min(free, units) * unit) };
}

/**
 * Applies the `offered` flag to a computed (real) line total. The real price is always preserved as
 * `originalTotalPrice`; offering only zeroes the billed `totalPrice`. This is the single place where
 * offering affects money, so toggling offered on/off is always lossless.
 */
function applyOfferedToLine(realTotal, offered) {
  const real = roundMoney(realTotal);
  return {
    originalTotalPrice: real,
    totalPrice: offered ? 0 : real,
    offered: Boolean(offered),
  };
}

module.exports = {
  soldBilledUnits,
  mergeLineWithLockedSnapshot,
  reconstructLockedRealTotal,
  lockedUnitPriceOr,
  lockedLineGrossOfFreeUnits,
  applyOfferedToLine,
};
