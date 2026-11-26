/**
 * The VAT regime of a platform's commission (specs/platform-host-statement-and-commission-vat.md rule 13): `fr_vat` — a French
 * platform, 20 % VAT deductible; `eu_reverse_charge` — an EU platform, the full amount and VAT self-assessed; `no_vat` — the full amount.
 * It replaces the « TVA déductible » box (`platforms.hasVatOnCommission`, kept in step for one release).
 */
const COMMISSION_REGIMES = Object.freeze(['fr_vat', 'eu_reverse_charge', 'no_vat']);
const DEFAULT_COMMISSION_REGIME = 'no_vat';

/**
 * The regime a platform row stands for: its own column when it names a regime that carries VAT, else what its old box says — a database
 * that predates the column, or a row the old box alone was written on. The old box follows the regime on every write, so a row
 * that says `no_vat` with the box ticked can only have been written by the old box.
 */
function commissionRegimeOf(platformRow) {
  if (!platformRow) return DEFAULT_COMMISSION_REGIME;
  if (platformRow.commissionVatRegime === 'fr_vat' || platformRow.commissionVatRegime === 'eu_reverse_charge') return platformRow.commissionVatRegime;
  return Number(platformRow.hasVatOnCommission) === 1 ? 'fr_vat' : DEFAULT_COMMISSION_REGIME;
}

module.exports = { COMMISSION_REGIMES, DEFAULT_COMMISSION_REGIME, commissionRegimeOf };
