/**
 * The phone preview's views, built from what the studio already holds (rule 49). Pure: the editor's state in, the
 * preview's props out; every label and price is the server's.
 */
import { MODULES, NOT_A_TILE } from '../constants/studio';
import { thumbOf } from '../components/MediaDialog';

const heroOf = (media, heroMediaId) => {
  const m = media.find((x) => x.id === heroMediaId);
  return m ? (m.sizes && (m.sizes[800] || m.sizes['800'])) || m.url : null;
};

/** Home: the modules switched on, in their order (tiles never include `orders`, rule 11bis). */
export function homeView({ lodgingName, modules, heroMediaId, media = [], settings, lang }) {
  const on = modules.filter((m) => m.on);
  return {
    view: 'home',
    lodgingName,
    appName: settings && settings.appName,
    soliomapEmbed: Boolean(settings && settings.soliomapEmbed),
    heroUrl: heroOf(media, heroMediaId),
    modules: on.map((m) => m.key),
    tiles: on.filter((m) => !NOT_A_TILE.includes(m.key)).map((m) => ({ key: m.key, label: MODULES[m.key].label[lang] || MODULES[m.key].label.fr })),
  };
}

/** A booklet page, as the server's draft preview resolved it. */
export function pageView({ lodgingName, page, nextTitle, modules }) {
  return {
    view: 'page', lodgingName, page, nextTitle, modules,
  };
}

/** The shop: the articles sold here, grouped by their GuestFlow category in the order they come. */
export function shopView({ lodgingName, items, media = [], modules, lang }) {
  const sold = items.filter((i) => i.sold);
  const groups = new Map();
  sold.forEach((item) => {
    const name = item.category || (lang === 'en' ? 'Others' : 'Autres');
    if (!groups.has(name)) groups.set(name, []);
    const photo = media.find((m) => m.id === item.mediaId);
    groups.get(name).push({
      kind: item.kind,
      id: item.id,
      title: item.title,
      priceLabel: item.price === 0 ? (lang === 'en' ? 'Included' : 'Inclus') : item.priceLabel,
      priceUnitLabel: item.price === 0 ? null : item.priceUnitLabel,
      included: item.price === 0,
      imageUrl: thumbOf(photo),
      needsStaff: item.needsStaff,
      ...(item.stock && item.stock.tracked && item.stock.out ? { stock: { soldOut: true, left: 0, leftLabel: null } } : {}),
      ...(item.stock && item.stock.soldOut ? { stock: { soldOut: true, left: 0, leftLabel: null } } : {}),
    });
  });
  return {
    view: 'shop', lodgingName, modules, categories: [...groups.entries()].map(([name, list]) => ({ name, items: list })),
  };
}
