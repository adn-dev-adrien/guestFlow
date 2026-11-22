/**
 * Everything GuestFlow sells, as a voucher composition sees it (specs/gift-voucher-campaigns.md rule 4): every resource and option of the catalogue with its tariff
 * modes and whether it can be sold to a customer with no stay — and, when not, the French reason. Built from the pricing engine's articles (`makeArticle`) and the
 * family that owns each article: the hourly modes, their rates and their tiers are the family's own reading of the resource, never recomputed here.
 *
 *   list()                                   → [{ articleRef, kind, id, label, category, priceType, priceTypeLabel, hourly, modes, sellable, reason }], resources then options
 *   element(articleRef)                      → one of those, or null
 *   sessionRefusal({ resourceId, band, minutes, rankOffsetMinutes }) → the engine's sentence for a session that cannot be sold, or null
 *
 * A resource has `modes` only when it is an hourly resource shown on the planning (`outside-day`, `outside-evening`); an option has none.
 */

const PRICE_TYPE_LABELS = Object.freeze({
  per_stay: 'Forfait',
  free: 'Gratuit',
  per_person: 'Par personne',
  per_night: 'Par nuit',
  per_person_per_night: 'Par personne et par nuit',
  percent_of_stay: 'Pourcentage du séjour',
  per_participant_progressive: 'Progressif par participant',
  per_hour: 'À l’heure',
});

// The families an option may be sold in with no stay: a count (fixed, per unit), per person (one person) or progressive per participant. The others read the nights or the stay.
const OUTSIDE_FAMILIES = Object.freeze(['fixed', 'perUnit', 'perPerson', 'perParticipantProgressive']);

const NOT_SELLABLE_OUTSIDE = 'Pas marqué « vendable hors séjour » dans le catalogue.';

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
        priceTypeLabel: PRICE_TYPE_LABELS[config.priceType] || config.priceType,
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
    if (!article.config.sellableExternally) return withReason(view, NOT_SELLABLE_OUTSIDE);
    if (article.config.isCancellationInsurance) return withReason(view, 'L’assurance annulation ne se vend qu’avec un séjour.');
    if (!OUTSIDE_FAMILIES.includes(article.family)) {
      return withReason(view, `Le prix « ${view.priceTypeLabel.toLowerCase()} » a besoin d’un séjour : il ne se vend pas seul.`);
    }
    return withReason(view, null);
  }

  function resourceView(row) {
    const { article, view } = baseOf(row, 'resource');
    if (row.archivedAt) return withReason(view, 'Archivée : retirée du catalogue.');
    if (!article.config.sellableExternally) return withReason(view, NOT_SELLABLE_OUTSIDE);
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
    resourceId, band, minutes, rankOffsetMinutes,
  }) {
    const row = db.prepare('SELECT * FROM resources WHERE id = ?').get(Number(resourceId));
    if (!row) return 'Ressource inconnue.';
    const article = articles.makeArticle(row, { kind: 'resource' });
    const family = articles.liveFamilies().hourly;
    if (!family || typeof family.quoteSession !== 'function') return 'Les ressources à l’heure ne sont pas disponibles pour le moment.';
    const answer = family.quoteSession(article.config, { band, minutes, ...(rankOffsetMinutes === undefined ? {} : { rankOffsetMinutes }) });
    return answer.refusal ? answer.refusal.message : null;
  }

  return { list, element, sessionRefusal };
}

module.exports = { createCatalogueView, PRICE_TYPE_LABELS };
