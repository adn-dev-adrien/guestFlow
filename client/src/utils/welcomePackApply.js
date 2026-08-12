/**
 * Welcome pack — reconciling the server's lines into the reservation form
 * (specs/welcome-pack-auto-options.md §3.4).
 *
 * The server decides WHAT the pack is and whether it applies; this module only puts its lines into
 * `form.selectedOptions` and takes them back out. The whole thing hinges on one bit: a line the pack
 * created carries `welcomePack: true`. That tag never reaches the server (the payload builders keep
 * `optionId` / `quantity` / `cardOccurrences` only) — it exists so the form can remove EXACTLY what
 * it added and never touch a line the operator owns.
 */

// Explicit extension: this module is reached from `applyQuoteToForm.js`, whose unit test loads it
// through CommonJS `require` — a path with no extension resolution.
import { buildInitialGrid } from './cardOccurrences.js';

export const WELCOME_PACK_TAG = 'welcomePack';

const isPackLine = (entry) => Boolean(entry && entry[WELCOME_PACK_TAG]);

// The dates actually checked on a card line, sorted — the shape we compare against the granted one.
function checkedDates(grid) {
  return (Array.isArray(grid) ? grid : [])
    .filter((o) => o && o.checked)
    .map((o) => o.date)
    .sort();
}

// A card grid for `option` with the pack's single occurrence checked and every other candidate off.
function packGrid(option, occurrence, stay) {
  return buildInitialGrid(option, stay.startDate, stay.endDate, stay.checkInTime, stay.checkOutTime)
    .map((o) => ({ ...o, checked: o.date === occurrence.date }));
}

// Does this pack entry already carry exactly what the server grants? Used to leave the reference
// untouched when nothing moved (the effect runs on every context change).
function matchesGrant(entry, line) {
  if (line.mode === 'quantity') return Number(entry.quantity || 0) === Number(line.quantity || 0);
  const dates = checkedDates(entry.cardOccurrences);
  return dates.length === 1 && dates[0] === line.occurrence.date;
}

function buildEntry(line, catalogueOption, stay) {
  if (line.mode === 'quantity') {
    return { optionId: Number(line.optionId), quantity: Number(line.quantity), totalPrice: 0, [WELCOME_PACK_TAG]: true };
  }
  if (!catalogueOption || !line.occurrence) return null;
  const grid = packGrid(catalogueOption, line.occurrence, stay);
  // The occurrence the server named must exist in the grid the form builds; if the two disagree
  // (an option reconfigured between the two), applying nothing beats applying a wrong morning.
  if (!grid.some((o) => o.checked)) return null;
  return { optionId: Number(line.optionId), quantity: 1, totalPrice: 0, cardOccurrences: grid, [WELCOME_PACK_TAG]: true };
}

/**
 * Reconcile `selectedOptions` with the pack lines the server grants for the current context.
 *
 * - a granted option absent from the selection → added, tagged;
 * - a tagged line no longer granted (platform switched, party grew) → removed;
 * - a tagged line whose grant moved (the stay dates changed) → rebuilt;
 * - an untagged line → never touched, whatever it is. That covers the operator's own picks AND the
 *   per-property defaults, which own their line first (rule 11 + §3.4 edge case).
 *
 * Returns the SAME array reference when nothing changed, so it can be used inside a `setForm`
 * updater without re-rendering on every context tick.
 */
export function applyWelcomePack(selectedOptions, packLines, { options = [], excludedOptionIds, ...stay } = {}) {
  const current = Array.isArray(selectedOptions) ? selectedOptions : [];
  // Options the operator turned off: unticking a pack line deletes it — tag included — so without
  // this memory the next context change would put it straight back (rule 11).
  const excluded = excludedOptionIds instanceof Set ? excludedOptionIds : new Set(excludedOptionIds || []);
  const lines = (Array.isArray(packLines) ? packLines : []).filter((l) => !excluded.has(Number(l.optionId)));
  const linesById = new Map(lines.map((l) => [Number(l.optionId), l]));
  const catalogueById = new Map((options || []).map((o) => [Number(o.id), o]));

  let changed = false;
  const next = [];
  for (const entry of current) {
    if (!isPackLine(entry)) { next.push(entry); continue; }
    const line = linesById.get(Number(entry.optionId));
    if (!line) { changed = true; continue; }
    if (matchesGrant(entry, line)) { next.push(entry); continue; }
    const rebuilt = buildEntry(line, catalogueById.get(Number(line.optionId)), stay);
    changed = true;
    if (rebuilt) next.push(rebuilt);
  }

  const present = new Set(current.map((e) => Number(e.optionId)));
  for (const line of lines) {
    if (present.has(Number(line.optionId))) continue;
    const entry = buildEntry(line, catalogueById.get(Number(line.optionId)), stay);
    if (!entry) continue;
    next.push(entry);
    changed = true;
  }

  return changed ? next : selectedOptions;
}

/**
 * Drop the pack tag on one option — called whenever the operator acts on it (toggle, quantity,
 * occurrence). From that moment the line is theirs: the pack neither removes nor rebuilds it.
 */
export function releaseWelcomePackLine(selectedOptions, optionId) {
  const current = Array.isArray(selectedOptions) ? selectedOptions : [];
  if (!current.some((e) => isPackLine(e) && Number(e.optionId) === Number(optionId))) return selectedOptions;
  return current.map((entry) => {
    if (!isPackLine(entry) || Number(entry.optionId) !== Number(optionId)) return entry;
    const { [WELCOME_PACK_TAG]: _tag, ...rest } = entry;
    return rest;
  });
}

export const isWelcomePackLine = isPackLine;
