/**
 * `gift_voucher_campaigns` — the offers the operator configures (specs/gift-voucher-campaigns.md §5, rules 2, 8, 9, 46). A row holds no price: a composed campaign
 * names what it contains and the pricing engine reads the prices when asked (rule 5). JSON columns are parsed on the way out and written on the way in; a campaign
 * is never deleted — it is closed, and its vouchers stay valid. A one-shot campaign (« Sur mesure ») is bound to its only voucher: no slug, never on sale, left out of every list.
 */

const rules = require('../voucherRules');

const iso = (date) => (date instanceof Date ? date.toISOString() : date);

function present(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    title: row.title,
    kind: row.kind,
    state: row.state,
    oneShot: Boolean(row.oneShot),
    slug: row.slug,
    slugLockedAt: row.slugLockedAt,
    validityMonths: row.validityMonths,
    composition: rules.parseJson(row.composition, null),
    addOns: rules.parseJson(row.addOns, []),
    extraTimeMaxMinutes: row.extraTimeMaxMinutes,
    minAmountCents: row.minAmountCents,
    maxAmountCents: row.maxAmountCents,
    ideas: rules.parseJson(row.ideas, []),
    vatRatePercent: row.vatRatePercent,
    voucherVisualId: row.voucherVisualId,
    merchantVisualId: row.merchantVisualId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const COLUMNS = ['name', 'title', 'kind', 'state', 'oneShot', 'slug', 'validityMonths', 'composition', 'addOns', 'extraTimeMaxMinutes', 'minAmountCents', 'maxAmountCents', 'ideas', 'vatRatePercent', 'voucherVisualId', 'merchantVisualId'];

const stored = (value) => ({
  ...value,
  oneShot: value.oneShot ? 1 : 0,
  composition: value.composition ? JSON.stringify(value.composition) : null,
  addOns: JSON.stringify(value.addOns || []),
  ideas: JSON.stringify(value.ideas || []),
});

function createCampaignsModel(db, { now = () => new Date() } = {}) {
  const find = (id) => present(db.prepare('SELECT * FROM gift_voucher_campaigns WHERE id = ?').get(Number(id)));
  const findBySlug = (slug) => (slug ? present(db.prepare('SELECT * FROM gift_voucher_campaigns WHERE slug = ?').get(String(slug))) : null);

  /** The campaigns of the operator's list: one-shots are bound to their voucher and never listed (rule 46). */
  const list = () => db.prepare('SELECT * FROM gift_voucher_campaigns WHERE oneShot = 0 ORDER BY id').all().map(present);
  const onSale = () => list().filter((c) => c.state === 'on_sale');

  /** The campaign a voucher sold by hand with no campaign named belongs to: the first lodging one (rule 3). */
  const firstLodging = () => list().find((c) => c.kind === 'lodging') || null;

  /** `value` is what `campaignRules.validateCampaign` answered. → the new id. */
  function insert(value) {
    const at = iso(now());
    const row = stored(value);
    const { lastInsertRowid } = db.prepare(`
      INSERT INTO gift_voucher_campaigns (${COLUMNS.join(', ')}, createdAt, updatedAt)
      VALUES (${COLUMNS.map((c) => `@${c}`).join(', ')}, @at, @at)
    `).run({ ...row, at });
    return Number(lastInsertRowid);
  }

  function update(id, value) {
    const row = stored(value);
    db.prepare(`UPDATE gift_voucher_campaigns SET ${COLUMNS.map((c) => `${c} = @${c}`).join(', ')}, updatedAt = @at WHERE id = @id`).run({ ...row, at: iso(now()), id: Number(id) });
    return find(id);
  }

  /** Rule 8 — a draft copy: the same contents, no slug (a link is the original's), « (copie) » after its name. → the new campaign. */
  function duplicate(id) {
    const source = find(id);
    if (!source || source.oneShot) return null;
    const copy = {
      ...source, name: `${source.name} (copie)`.slice(0, 80), state: 'draft', slug: null, oneShot: false,
    };
    return find(insert(copy));
  }

  /** Rule 9 — downloading the merchant card prints the link: the slug is locked from then on. */
  function lockSlug(id) {
    db.prepare('UPDATE gift_voucher_campaigns SET slugLockedAt = ? WHERE id = ? AND slugLockedAt IS NULL AND slug IS NOT NULL').run(iso(now()), Number(id));
    return find(id);
  }

  return {
    find, findBySlug, list, onSale, firstLodging, insert, update, duplicate, lockSlug,
  };
}

module.exports = createCampaignsModel;
