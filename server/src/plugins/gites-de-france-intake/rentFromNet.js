/**
 * The gross rent the guest was charged, from the rent net of commission the mail gives
 * (specs/gites-de-france-mail-intake.md rule 7). The centrale keeps `round(rate × rent)` — rounded to the
 * euro, half up, measured on 8 settled dossiers — so every integer rent `L` with `L − round(rate·L) = net`
 * is a candidate. Usually one; two when `rate·L` lands on ,5 (net 454 → 504 or 505); none when the rate
 * is not the centrale's any more.
 */
function rentCandidates(netRent, ratePercent) {
  const rate = Number(ratePercent) / 100;
  const net = Number(netRent);
  if (!(rate > 0 && rate < 1) || !Number.isFinite(net) || net <= 0) return [];
  const out = [];
  const highest = Math.ceil(net / (1 - rate)) + 2;
  for (let rent = Math.floor(net); rent <= highest; rent += 1) {
    if (rent - Math.round(rate * rent) === net) out.push(rent);
  }
  return out;
}

module.exports = { rentCandidates };
