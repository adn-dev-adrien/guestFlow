/**
 * Option category grouping (specs/option-categories.md §3 rules 1-3, 9).
 *
 * Pure module — no DB access — so the same ordering rules serve the admin payload, the
 * reservation payload and the public catalogue payload, and can be unit-tested in isolation.
 *
 * The shape returned by `groupOptionsByCategory` is deliberately render-ready (CLAUDE.md §6.0
 * "fat backend"): the client receives the ungrouped options, then the groups in display order,
 * each already split into the options that are enabled on the reservation and the rest. The
 * split is what powers the "collapsed sections never hide a charge" rule — the enabled slice
 * renders outside the collapse, the remaining slice inside it.
 */

// French collation, case- and accent-insensitive, so « Éclairage » sorts before « Fruits » and
// « boissons » next to « Boissons » instead of after every capitalised label (ASCII order would
// put all uppercase first).
const collator = new Intl.Collator('fr', { sensitivity: 'base', numeric: true });

/**
 * Category labels are operator-typed. Trim them so « Boissons » and « Boissons  » are the same
 * group, and collapse a whitespace-only input to '' (= ungrouped) rather than creating a group
 * with a blank header.
 */
function normalizeCategory(label) {
  if (label == null) return '';
  return String(label).trim();
}

function byTitle(a, b) {
  return collator.compare(String(a?.title || ''), String(b?.title || ''));
}

/**
 * The cancellation insurance reads as the closing line of the stay's own conditions, not as an
 * « A » article at the top of the list: the operator sells it right after « Départ tardif », once
 * arrival and departure are settled (specs/cancellation-insurance.md §3.2 rule 17bis).
 *
 * So it is pulled out of the alphabetical order and pinned immediately after the late-checkout
 * auto-option — but only when both sit in the SAME category block, since « just after Départ
 * tardif » means nothing across a category boundary. Everything else keeps its title order.
 *
 * Works on any already-sorted array (the ungrouped list of a fiche, the flat catalogue of the
 * Options screen), so both surfaces read the same.
 */
function pinCancellationInsurance(options) {
  const list = Array.isArray(options) ? options.slice() : [];
  const insuranceIndex = list.findIndex((o) => Number(o?.isCancellationInsurance || 0) === 1);
  if (insuranceIndex < 0) return list;
  const [insurance] = list.splice(insuranceIndex, 1);
  const category = normalizeCategory(insurance.category);
  // The LAST late-checkout row wins: a catalogue can hold one per property scope, and they sort
  // next to each other — landing between two « Départ tardif » lines would read as a mistake.
  let anchorIndex = -1;
  list.forEach((o, i) => {
    if (o?.autoOptionType === 'late_check_out' && normalizeCategory(o?.category) === category) anchorIndex = i;
  });
  list.splice(anchorIndex < 0 ? insuranceIndex : anchorIndex + 1, 0, insurance);
  return list;
}

/**
 * An option renders OUTSIDE its category's collapse when it is selected on the reservation, or
 * when it carries `alwaysVisible` (specs/option-categories.md §3 rules 9 + 9bis). The second case
 * is how the breakfast option keeps showing on every fiche now that it lives under
 * « Restauration »: a service the operator must be able to offer without hunting for it.
 *
 * Exported so the fiche and the widget apply the same rule to their own live selection — neither
 * can reuse the server's split, since it depends on unsaved UI state.
 */
function isPinnedOption(option, enabledIds) {
  if (Number(option?.alwaysVisible || 0) === 1) return true;
  return Boolean(enabledIds && enabledIds.has(Number(option?.id)));
}

/**
 * @param {Array<object>} options   Catalogue options, already filtered for visibility/archival.
 * @param {Iterable<number>} [enabledIds]  Ids currently enabled on the reservation. Omit on
 *                                         surfaces with no selection (public catalogue) — every
 *                                         option then lands in `remaining`.
 * @returns {{ ungrouped: object[], groups: Array<{ category: string, options: object[],
 *             pinned: object[], foldable: object[], enabledCount: number }> }}
 *   `pinned` renders outside the collapse (selected OR `alwaysVisible`), `foldable` inside it.
 *   `enabledCount` counts only what is actually selected — it feeds the header chip, so an
 *   always-visible option the operator hasn't ticked must not inflate it.
 */
function groupOptionsByCategory(options, enabledIds = []) {
  const enabled = new Set(Array.from(enabledIds, Number));
  const ungrouped = [];
  const byCategory = new Map();

  for (const opt of options || []) {
    const category = normalizeCategory(opt?.category);
    if (!category) {
      ungrouped.push(opt);
      continue;
    }
    if (!byCategory.has(category)) byCategory.set(category, []);
    byCategory.get(category).push(opt);
  }

  ungrouped.sort(byTitle);
  const orderedUngrouped = pinCancellationInsurance(ungrouped);

  const groups = Array.from(byCategory.entries())
    .sort((a, b) => collator.compare(a[0], b[0]))
    .map(([category, list]) => {
      const sorted = pinCancellationInsurance(list.slice().sort(byTitle));
      return {
        category,
        options: sorted,
        pinned: sorted.filter((o) => isPinnedOption(o, enabled)),
        foldable: sorted.filter((o) => !isPinnedOption(o, enabled)),
        enabledCount: sorted.filter((o) => enabled.has(Number(o.id))).length,
      };
    });

  return { ungrouped: orderedUngrouped, groups };
}

/** Distinct category labels present in a catalogue, in display order — feeds the admin autocomplete. */
function listCategories(options) {
  const seen = new Set();
  for (const opt of options || []) {
    const category = normalizeCategory(opt?.category);
    if (category) seen.add(category);
  }
  return Array.from(seen).sort((a, b) => collator.compare(a, b));
}

module.exports = { normalizeCategory, groupOptionsByCategory, listCategories, isPinnedOption, pinCancellationInsurance };
