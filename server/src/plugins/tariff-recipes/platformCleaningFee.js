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

// Rule 11 — stored (JSON column) vs desired, per platform, by net. `from`/`to` are nets, null = no fee.
function diffPlatformCleaningFees(storedJson, desired = []) {
  let stored = [];
  try { stored = JSON.parse(storedJson || '[]'); } catch { stored = []; }
  if (!Array.isArray(stored)) stored = [];
  const key = (name) => String(name || '').trim().toLowerCase();
  const before = new Map(stored.map((f) => [key(f.platform), f]));
  const after = new Map(desired.map((f) => [key(f.platform), f]));
  const changes = [];
  for (const k of new Set([...before.keys(), ...after.keys()])) {
    const from = before.has(k) ? Number(before.get(k).net) : null;
    const to = after.has(k) ? Number(after.get(k).net) : null;
    if (from !== to) changes.push({ platform: (after.get(k) || before.get(k)).platform, from, to });
  }
  return changes;
}

module.exports = { resolvePlatformCleaningFees, diffPlatformCleaningFees };
