/**
 * Stay facts — the property-side data the guest emails need (specs/guest-email-sequence.md §3.5,
 * consumed by utils/stayContentContext.js).
 *
 * Read-only. Every query is guarded: a minimal or legacy schema (unit tests, an old database) yields
 * empty facts instead of throwing, so an email still renders — just without the property-specific
 * paragraphs.
 *
 * API: loadStayFacts(database, reservation) → { defaults, available, optionMeta, bathFreeMinutes, properties }
 */

function tryAll(fn, fallback) {
  try { return fn(); } catch { return fallback; }
}

function loadStayFacts(database, reservation) {
  const propertyId = Number(reservation && reservation.propertyId);

  const optionMeta = {};
  tryAll(() => database.prepare('SELECT id, title, titleEn, seedKey, category, autoOptionType, displayToClient FROM options').all(), [])
    .forEach((o) => { optionMeta[o.id] = o; });

  const defaults = propertyId
    ? tryAll(() => database.prepare('SELECT optionId, offered FROM property_option_defaults WHERE propertyId = ?').all(propertyId), [])
    : [];

  // Options applicable to the property at its effective price — the same rule as
  // optionsModel.listForProperty (explicit link, per-property price override, archived excluded).
  const available = propertyId
    ? tryAll(() => database.prepare(`
        SELECT o.*, COALESCE(pop.price, o.price) AS price
          FROM options o
          JOIN property_options po ON po.optionId = o.id AND po.propertyId = ?
          LEFT JOIN property_option_prices pop ON pop.optionId = o.id AND pop.propertyId = ?
         WHERE o.archivedAt IS NULL
      `).all(propertyId, propertyId), [])
    : [];

  // Included nordic-bath minutes: the bath resource is recognised by its name, as everywhere else in
  // the emails (emailContextBuilder's nordicResource).
  const bathFreeMinutes = propertyId
    ? tryAll(() => {
      const row = database.prepare(`
        SELECT prp.freeMinutes AS minutes
          FROM property_resource_prices prp
          JOIN resources res ON res.id = prp.resourceId
         WHERE prp.propertyId = ? AND LOWER(res.name) LIKE '%nordique%'
         LIMIT 1
      `).get(propertyId);
      return row ? Number(row.minutes || 0) : 0;
    }, 0)
    : 0;

  // « À partir de » price per property (rule 27): the lowest nightly price of its seasons. Recipe
  // seasons (tagged `seasonKey`) win when present, so a leftover untagged « Standard » rule cannot
  // undercut the real grid.
  const properties = tryAll(() => database.prepare(`
    SELECT p.id, p.name, p.nameArticle,
           COALESCE(
             (SELECT MIN(pr.pricePerNight) FROM pricing_rules pr
               WHERE pr.propertyId = p.id AND pr.pricePerNight > 0 AND COALESCE(pr.seasonKey, '') != ''),
             (SELECT MIN(pr.pricePerNight) FROM pricing_rules pr
               WHERE pr.propertyId = p.id AND pr.pricePerNight > 0)
           ) AS minNightlyPrice
      FROM properties p
     ORDER BY p.id
  `).all(), []);

  return { defaults, available, optionMeta, bathFreeMinutes, properties };
}

module.exports = { loadStayFacts };
