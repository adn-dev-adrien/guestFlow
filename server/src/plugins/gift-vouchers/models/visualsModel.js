/**
 * `gift_voucher_visuals` and their versions — the visual library (specs/gift-voucher-campaigns.md rules 47-48). A visual is a name and a use; each upload of its image is a
 * version, and the latest one is the visual's current image. A voucher freezes the version it was issued with, so replacing or deleting a visual never touches it: a version
 * file stays on disk while a voucher that carries it can still be downloaded or mailed, and is purged after (`purgeable`, `markPurged`).
 */

const rules = require('../voucherRules');

const USES = Object.freeze(['voucher', 'merchant', 'both']);
const MONEY = rules.MONEY_KINDS.map((k) => `'${k}'`).join(', ');
const iso = (date) => (date instanceof Date ? date.toISOString() : date);

function createVisualsModel(db, { now = () => new Date() } = {}) {
  const currentOf = (visualId) => db.prepare('SELECT * FROM gift_voucher_visual_versions WHERE visualId = ? ORDER BY id DESC LIMIT 1').get(Number(visualId)) || null;

  const find = (id) => {
    const row = db.prepare('SELECT * FROM gift_voucher_visuals WHERE id = ?').get(Number(id));
    return row ? { ...row, current: currentOf(row.id) } : null;
  };

  /** The visuals still in the library, oldest first, each with its current version. */
  const list = () => db.prepare('SELECT id FROM gift_voucher_visuals WHERE deletedAt IS NULL ORDER BY id').all().map((r) => find(r.id));

  const versionById = (id) => db.prepare('SELECT * FROM gift_voucher_visual_versions WHERE id = ?').get(Number(id)) || null;
  const versionCount = (visualId) => db.prepare('SELECT COUNT(*) AS n FROM gift_voucher_visual_versions WHERE visualId = ?').get(Number(visualId)).n;

  function addVersion(visualId, { path, width, height }) {
    return Number(db.prepare('INSERT INTO gift_voucher_visual_versions (visualId, path, width, height, createdAt) VALUES (?, ?, ?, ?, ?)')
      .run(Number(visualId), path, width, height, iso(now())).lastInsertRowid);
  }

  /** → the new visual's id, its first version written with it. */
  const insert = db.transaction(({ name, use, file }) => {
    const id = Number(db.prepare('INSERT INTO gift_voucher_visuals (name, use, createdAt) VALUES (?, ?, ?)').run(name, use, iso(now())).lastInsertRowid);
    addVersion(id, file);
    return id;
  });

  const rename = (id, { name, use }) => db.prepare('UPDATE gift_voucher_visuals SET name = ?, use = ? WHERE id = ?').run(name, use, Number(id));
  const softDelete = (id) => db.prepare('UPDATE gift_voucher_visuals SET deletedAt = ? WHERE id = ? AND deletedAt IS NULL').run(iso(now()), Number(id));

  /** The campaigns that pick the visual for a front, whatever their state. */
  const campaignsUsing = (id) => db.prepare('SELECT id, name, state, voucherVisualId, merchantVisualId FROM gift_voucher_campaigns WHERE oneShot = 0 AND (voucherVisualId = ? OR merchantVisualId = ?) ORDER BY id')
    .all(Number(id), Number(id));

  // A voucher that can still be downloaded or mailed: not cancelled, not past its expiry, with a balance left.
  const KEEPING = `v.cancelledAt IS NULL AND v.expiresOn >= @today
    AND COALESCE((SELECT SUM(m.amountCents) FROM gift_voucher_movements m WHERE m.voucherId = v.id AND m.kind IN (${MONEY})), 0) > 0`;

  /** Rule 47 — how many valid vouchers still carry one of the versions of a visual. */
  const validVouchersCarrying = (visualId, today) => db.prepare(`
    SELECT COUNT(*) AS n FROM gift_vouchers v
    WHERE ${KEEPING} AND json_extract(v.visualVersions, '$.voucher') IN (SELECT id FROM gift_voucher_visual_versions WHERE visualId = @visualId)
  `).get({ visualId: Number(visualId), today }).n;

  /** Rule 48 — the version files nobody needs any more: not the current image of a visual still in the library, and carried by no voucher that can still be downloaded. */
  const purgeable = (today) => db.prepare(`
    SELECT ver.* FROM gift_voucher_visual_versions ver JOIN gift_voucher_visuals vis ON vis.id = ver.visualId
    WHERE ver.purgedAt IS NULL
      AND (vis.deletedAt IS NOT NULL OR ver.id != (SELECT MAX(id) FROM gift_voucher_visual_versions WHERE visualId = ver.visualId))
      AND NOT EXISTS (SELECT 1 FROM gift_vouchers v WHERE ${KEEPING} AND json_extract(v.visualVersions, '$.voucher') = ver.id)
  `).all({ today });

  const markPurged = (id) => db.prepare('UPDATE gift_voucher_visual_versions SET purgedAt = ? WHERE id = ?').run(iso(now()), Number(id));

  return {
    find, list, insert, addVersion, rename, softDelete, versionById, versionCount, currentOf, campaignsUsing, validVouchersCarrying, purgeable, markPurged,
  };
}

module.exports = createVisualsModel;
module.exports.USES = USES;
