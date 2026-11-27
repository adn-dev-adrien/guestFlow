/**
 * Everything GuestFlow sells, as a voucher composition sees it (specs/gift-vouchers/gift-voucher-campaigns.md rule 4): every resource and option of the catalogue with its tariff
 * modes and whether it can be sold to a customer with no stay — and, when not, the French reason. Built from the pricing engine's articles (`makeArticle`) and the
 * family that owns each article: the hourly modes, their rates and their tiers are the family's own reading of the resource, never recomputed here.
 *
 *   list()                                   → [{ articleRef, kind, id, label, category, priceType, priceTypeLabel, hourly, modes, sellable, reason }], resources then options
 *   element(articleRef)                      → one of those, or null
 *   sessionRefusal({ resourceId, band, minutes, rankOffsetMinutes, period }) → the engine's sentence for a session that cannot be sold (`{ message, period }` when it is about one period), or null
 *
 * Whether an option sells with no stay is `articles.outsideSale` (specs/pricing/pricing-components.md rule 124), never a list of families kept here.
 * A resource has `modes` only when it is an hourly resource shown on the planning (`outside-day`, `outside-evening`); an option has none.
 */

function createCatalogueView({ db, articles }) {
  const rowsOf = (table) => {
    try {
      return db.prepare(`SELECT * FROM ${table}`).all();
    } catch {
      return [];
    }
  };

  const baseOf = (row, kind) => {
    const article = articles.makeArticle(row, { kind });
    const { config } = article;
    return {
      article,
      view: {
        articleRef: article.ref,
        kind,
        id: config.id,
        label: config.label,
        category: String(row.category || '') || null,
        priceType: config.priceType,
        priceTypeLabel: articles.PRICE_TYPE_LABELS[config.priceType] || config.priceType,
        hourly: false,
        modes: [],
        sellable: false,
        reason: null,
      },
    };
  };

  const withReason = (view, reason) => ({ ...view, sellable: reason === null, reason });

  function optionView(row) {
    const { article, view } = baseOf(row, 'option');
    if (row.archivedAt) return withReason(view, 'Archivée : retirée du catalogue.');
    if (!article.config.sellableExternally) return withReason(view, articles.NOT_SELLABLE_OUTSIDE);
    const outside = articles.outsideSale(article);
    return withReason(view, outside.sellable ? null : outside.reason);
  }

  function resourceView(row) {
    const { article, view } = baseOf(row, 'resource');
    if (row.archivedAt) return withReason(view, 'Archivée : retirée du catalogue.');
    if (!article.config.sellableExternally) return withReason(view, articles.NOT_SELLABLE_OUTSIDE);
    if (article.family !== 'hourly') return withReason(view, 'Seule une ressource à l’heure se compose dans un bon.');
    if (!article.config.fulfilment) return withReason(view, 'Ressource à l’heure sans carte de planning : une séance se réserve au planning.');
    const family = articles.liveFamilies().hourly;
    if (!family || typeof family.sessionModes !== 'function') return withReason({ ...view, hourly: true }, 'Les ressources à l’heure ne sont pas disponibles pour le moment.');
    const modes = family.sessionModes(article.config);
    const hourly = { ...view, hourly: true, modes };
    if (!modes.length) return withReason(hourly, 'Aucune tranche horaire n’est réglée sur cette ressource.');
    const open = modes.find((mode) => mode.sellable);
    return withReason(hourly, open ? null : modes[0].reason);
  }

  const list = () => [
    ...rowsOf('resources').map(resourceView).sort((a, b) => a.label.localeCompare(b.label, 'fr')),
    ...rowsOf('options').map(optionView).sort((a, b) => a.label.localeCompare(b.label, 'fr')),
  ];

  function element(articleRef) {
    const match = /^(option|resource):([1-9]\d*)$/.exec(String(articleRef || ''));
    if (!match) return null;
    const row = db.prepare(`SELECT * FROM ${match[1] === 'option' ? 'options' : 'resources'} WHERE id = ?`).get(Number(match[2]));
    if (!row) return null;
    return match[1] === 'option' ? optionView(row) : resourceView(row);
  }

  function sessionRefusal({
    resourceId, band, minutes, rankOffsetMinutes, period,
  }) {
    const row = db.prepare('SELECT * FROM resources WHERE id = ?').get(Number(resourceId));
    if (!row) return 'Ressource inconnue.';
    const article = articles.makeArticle(row, { kind: 'resource' });
    const family = articles.liveFamilies().hourly;
    if (!family || typeof family.quoteSession !== 'function') return 'Les ressources à l’heure ne sont pas disponibles pour le moment.';
    const answer = family.quoteSession(article.config, {
      band, minutes, ...(rankOffsetMinutes === undefined ? {} : { rankOffsetMinutes }), ...(period ? { period } : {}),
    });
    if (!answer.refusal) return null;
    // A refusal about one period says which (`{ message, period }`), for the form to name it only when the sentence does not already.
    return answer.refusal.period ? { message: answer.refusal.message, period: answer.refusal.period } : answer.refusal.message;
  }

  return { list, element, sessionRefusal };
}

module.exports = { createCatalogueView };
