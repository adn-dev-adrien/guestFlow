/**
 * Cleaning fee billed by a platform — specs/tariff-recipe-platform-cleaning-fee.md.
 *
 * Pure: turns a recipe's `cleaning` block into the net each listed channel must recover through its
 * cleaning fee, resolving each `platform` against the names recorded in Paramètres → Plateformes.
 * The gross to configure is NOT computed here: it depends on the commission at read time (rule 9).
 */

const round2 = (n) => Math.round(n * 100) / 100;

function resolvePlatformCleaningFees(cleaning, platformNames = []) {
  const byLowerName = new Map(platformNames.map((name) => [String(name).trim().toLowerCase(), name]));
  const fees = [];
  const unknown = [];
  if (!cleaning || !Array.isArray(cleaning.platformFees)) return { fees, unknown };

  const netCost = Number(cleaning.netCost || 0);
  const hourlyRate = Number(cleaning.hourlyRate || 0);
  for (const entry of cleaning.platformFees) {
    const recorded = byLowerName.get(String(entry.platform).trim().toLowerCase());
    if (!recorded) { unknown.push(entry.platform); continue; }
    const cleaningNet = entry.chargesCleaning ? round2(netCost) : 0;
    const choresNet = round2((Number(entry.choresMinutes || 0) / 60) * hourlyRate);
    fees.push({ platform: recorded, cleaningNet, choresNet, net: round2(cleaningNet + choresNet) });
  }
  return { fees, unknown };
}

module.exports = { resolvePlatformCleaningFees };
