/**
 * Stay facts — the property-side data the guest emails need (specs/guest-email-sequence.md §3.5,
 * consumed by utils/stayContentContext.js).
 *
 * Read-only. Every query is guarded: a minimal or legacy schema (unit tests, an old database) yields
 * empty facts instead of throwing, so an email still renders — just without the property-specific
 * paragraphs.
 *
 * API: loadStayFacts(database, reservation) → { defaults, available, optionMeta, bathFreeMinutes, properties,
 *      texts, mentions, confirmationOrder }
 */

const stayTextsModel = require('./stayTextsModel');
const emailMentionsModel = require('./emailMentionsModel');

function tryAll(fn, fallback) {
  try { return fn(); } catch { return fallback; }
}

// The core may ask whether a plugin is live, never import it (specs/plugins-phase-0-foundation.md).
function hourlyResourcesLive() {
  try { return require('../plugins/sdk/registry').isLive('hourly-resources'); } catch { return false; }
}

function loadStayFacts(database, reservation) {
  const propertyId = Number(reservation && reservation.propertyId);

  const optionMeta = {};
  // No `titleEn`: English names live in the translation catalogue since specs/translation-catalogue.md,
  // and naming the dropped column made this read fail — every booked catering option then went unseen.
  tryAll(() => database.prepare('SELECT id, title, seedKey, category, autoOptionType, displayToClient FROM options').all(), [])
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

  // Included nordic-bath minutes: those of the property's hourly resource that shows on the planning,
  // whatever its name, and only while hourly resources are a live plugin — without it nothing is
  // sold by the hour (specs/plugins-phase-3c-hourly-resources.md rules 15, 18).
  const bathFreeMinutes = propertyId && hourlyResourcesLive()
    ? tryAll(() => {
      const row = database.prepare(`
        SELECT prp.freeMinutes AS minutes
          FROM property_resource_prices prp
          JOIN resources res ON res.id = prp.resourceId
         WHERE prp.propertyId = ? AND res.priceType = 'per_hour' AND res.showsPlanningCard = 1
         LIMIT 1
      `).get(propertyId);
      return row ? Number(row.minutes || 0) : 0;
    }, 0)
    : 0;

  // « À partir de » price per property (rule 27): the lowest nightly price of its seasons. Seasons a
  // recipe wrote (tagged `seasonKey`, ranked `seasonRank`) win when present, so a leftover untagged
  // « Standard » rule cannot undercut the real grid. The rank survives the recipe plugin's erasure,
  // which clears only the tag: erasing it never changes the price announced.
  const properties = tryAll(() => database.prepare(`
    SELECT p.id, p.name, p.nameArticle,
           COALESCE(
             (SELECT MIN(pr.pricePerNight) FROM pricing_rules pr
               WHERE pr.propertyId = p.id AND pr.pricePerNight > 0
                 AND (COALESCE(pr.seasonKey, '') != '' OR pr.seasonRank IS NOT NULL)),
             (SELECT MIN(pr.pricePerNight) FROM pricing_rules pr
               WHERE pr.propertyId = p.id AND pr.pricePerNight > 0)
           ) AS minNightlyPrice
      FROM properties p
     ORDER BY p.id
  `).all(), []);

  // The wording (specs/plugins-phase-p-productisation.md §3.A–3.B): the stored stay texts, global and
  // the property's own, and the mentions with their confirmation order.
  const texts = tryAll(() => stayTextsModel.buildModel(database).forContext(propertyId), { global: {}, property: {} });
  const mentionsModel = tryAll(() => emailMentionsModel.buildModel(database), null);
  const mentions = mentionsModel ? tryAll(() => mentionsModel.list(), []) : [];
  const confirmationOrder = mentionsModel ? tryAll(() => mentionsModel.confirmationOrder(), []) : [];

  return { defaults, available, optionMeta, bathFreeMinutes, properties, texts, mentions, confirmationOrder };
}

/**
 * The sentence each booked resource carries once booked (specs/plugins-phase-p-productisation.md rule
 * 11), attached in place to the reservation's resource lines. Guarded like the facts above.
 */
function attachResourceSentences(database, resources = []) {
  const byId = new Map(tryAll(
    () => database.prepare('SELECT id, emailBookedText, emailBookedTextEn FROM resources').all(),
    [],
  ).map((row) => [Number(row.id), row]));
  for (const line of resources) {
    const row = byId.get(Number(line.resourceId));
    line.emailBookedText = row ? row.emailBookedText || '' : '';
    line.emailBookedTextEn = row ? row.emailBookedTextEn || '' : '';
  }
  return resources;
}

module.exports = { loadStayFacts, attachResourceSentences };
