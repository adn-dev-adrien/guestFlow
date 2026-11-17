/**
 * `guest_home_blocks` — what each lodging's « Domotique » page shows (specs/guest-app-home-automation.md rule 12): one
 * row per lodging and block kind, in order. A lodging never configured reads the five kinds, all off.
 */

const { KINDS, LIST_KINDS } = require('../homeRoles');

const parse = (json) => {
  try {
    const value = JSON.parse(json);
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
};

const defaults = () => KINDS.map((kind) => ({ kind, on: false, equipmentId: null, items: [] }));

function createHomeBlocksModel(db) {
  const rowToBlock = (r) => ({
    kind: r.kind,
    on: Boolean(r.on),
    equipmentId: LIST_KINDS.includes(r.kind) ? null : r.equipmentId,
    items: LIST_KINDS.includes(r.kind) ? parse(r.itemsJson) : [],
  });

  function blocksOf(propertyId) {
    const rows = db.prepare('SELECT * FROM guest_home_blocks WHERE propertyId = ? ORDER BY position').all(Number(propertyId));
    if (!rows.length) return defaults();
    const stored = rows.map(rowToBlock);
    const missing = defaults().filter((d) => !stored.some((b) => b.kind === d.kind));
    return [...stored, ...missing];
  }

  /** The five blocks, in the given order, replace the lodging's in one transaction. */
  function save(propertyId, blocks, now) {
    const at = now.toISOString();
    const write = db.prepare(`
      INSERT INTO guest_home_blocks (propertyId, kind, position, "on", equipmentId, itemsJson, updatedAt)
      VALUES (@propertyId, @kind, @position, @on, @equipmentId, @itemsJson, @at)
      ON CONFLICT(propertyId, kind) DO UPDATE SET position = excluded.position, "on" = excluded."on",
        equipmentId = excluded.equipmentId, itemsJson = excluded.itemsJson, updatedAt = excluded.updatedAt
    `);
    db.transaction(() => {
      blocks.forEach((b, position) => write.run({
        propertyId: Number(propertyId),
        kind: b.kind,
        position,
        on: b.on ? 1 : 0,
        equipmentId: b.equipmentId || null,
        itemsJson: JSON.stringify(b.items || []),
        at,
      }));
    })();
    return blocksOf(propertyId);
  }

  /** Every configured lodging's blocks, for the selection the house is asked for (rule 4). */
  function all() {
    const ids = db.prepare('SELECT DISTINCT propertyId FROM guest_home_blocks ORDER BY propertyId').all().map((r) => r.propertyId);
    return ids.map((propertyId) => ({ propertyId, blocks: blocksOf(propertyId) }));
  }

  return { blocksOf, save, all };
}

module.exports = createHomeBlocksModel;
