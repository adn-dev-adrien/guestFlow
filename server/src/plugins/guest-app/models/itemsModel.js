/**
 * `guest_app_items` — the sell switch and its presentation (specs/guest-app.md rules 22, 39), and the
 * lodging's catalogue as the pricing engine reads it (rule 24). A catalogue row without a plugin row is
 * not sold: the defaults are the table's.
 *
 * A factory: the plugin builds it on `ctx.db`, tests on an in-memory database.
 */

const sdk = require('../../sdk');

const { getApplicableOptions, getApplicableResources } = sdk.coreModule('pricing');

const DEFAULTS = Object.freeze({
  sold: 0, mediaId: null, shortDescriptionFr: null, shortDescriptionEn: null, maxQuantity: 10, needsStaff: 0, leadMinutes: 30, sortOrder: null,
  stockTracked: 0, stockQuantity: null, stockSetAt: null, stockSetBy: null, stockAlertBelow: null, soldOut: 0, stockLowPushedAt: null, stockOutPushedAt: null,
});
const COLUMNS = Object.keys(DEFAULTS);

const CATALOGUE = Object.freeze({
  option: 'SELECT id, title, priceType, category, archivedAt, autoOptionType, isCancellationInsurance, displayToClient, showsPlanningCard FROM options',
  resource: 'SELECT id, name AS title, priceType FROM resources',
});

const keyOf = (kind, id) => `${kind}:${Number(id)}`;

function createItemsModel(db) {
  const rowOf = (kind, id) => db.prepare('SELECT * FROM guest_app_items WHERE kind = ? AND itemId = ?').get(kind, Number(id)) || null;
  const withRow = (kind, core, row) => ({ kind, core, item: { ...DEFAULTS, ...(row || {}) } });

  /** One catalogue row with its plugin row, or null when the option / resource does not exist. */
  function get(kind, id) {
    const core = db.prepare(`${CATALOGUE[kind]} WHERE id = ?`).get(Number(id));
    return core ? withRow(kind, core, rowOf(kind, id)) : null;
  }

  /** Every option and resource with its plugin row. */
  function listAll() {
    const rows = new Map(db.prepare('SELECT * FROM guest_app_items').all().map((row) => [keyOf(row.kind, row.itemId), row]));
    return ['option', 'resource'].flatMap((kind) => db.prepare(`${CATALOGUE[kind]} ORDER BY title, id`).all()
      .map((core) => withRow(kind, core, rows.get(keyOf(kind, core.id)))));
  }

  /** Writes what the patch names and keeps the rest. */
  function save(kind, id, patch) {
    return db.transaction(() => {
      const next = { ...DEFAULTS, ...(rowOf(kind, id) || {}), ...patch, kind, itemId: Number(id) };
      const row = Object.fromEntries(['kind', 'itemId', ...COLUMNS].map((c) => [c, next[c]]));
      db.prepare(`
        INSERT OR REPLACE INTO guest_app_items (kind, itemId, ${COLUMNS.join(', ')})
        VALUES (@kind, @itemId, ${COLUMNS.map((c) => `@${c}`).join(', ')})
      `).run(row);
      return get(kind, id);
    })();
  }

  const mediaExists = (mediaId) => Boolean(db.prepare('SELECT 1 FROM guest_media WHERE id = ?').get(Number(mediaId)));

  /**
   * Rule 24 — the lodging's catalogue exactly as the engine prices it (effective per-property price, free
   * units and free minutes), the plugin rows, the resources explicitly linked to the lodging, the options it
   * offers by default, and the paths of the photos.
   */
  function catalogueFor(propertyId) {
    const id = Number(propertyId);
    const items = new Map(db.prepare('SELECT * FROM guest_app_items').all().map((row) => [keyOf(row.kind, row.itemId), row]));
    const linkedResourceIds = new Set(db.prepare('SELECT resourceId FROM resource_properties WHERE propertyId = ?').all(id).map((r) => Number(r.resourceId)));
    const offeredDefaultIds = new Set(db.prepare('SELECT optionId FROM property_option_defaults WHERE propertyId = ? AND offered = 1').all(id).map((r) => Number(r.optionId)));
    const mediaPaths = new Map(db.prepare('SELECT id, path FROM guest_media').all().map((m) => [Number(m.id), m.path]));
    return {
      options: getApplicableOptions(db, id),
      resources: getApplicableResources(db, id),
      items,
      linkedResourceIds,
      offeredDefaultIds,
      mediaPaths,
    };
  }

  return { catalogueFor, get, listAll, mediaExists, save };
}

module.exports = createItemsModel;
