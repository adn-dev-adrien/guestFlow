/**
 * Option client-visibility helper (specs/laundry-bath-mat.md §3 rule 11).
 *
 * A single source of truth for "should this option appear on a client/operator-facing
 * per-reservation surface?" — the reservation fiche, client emails, the devis PDF, the public
 * catalog/quote, the planning/dashboard chips. An option with `displayToClient = 0` is
 * internal-only (it still drives the laundry cards + stock projection). Default = visible, so any
 * option without the column / flag (legacy rows, minimal schemas) keeps the prior behaviour.
 */

function isClientVisibleOption(option) {
  if (!option) return false;
  // Absent column / undefined → visible (back-compat). Only an explicit 0 hides it.
  return Number(option.displayToClient == null ? 1 : option.displayToClient) !== 0;
}

module.exports = { isClientVisibleOption };
