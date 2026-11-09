/**
 * The studio's fixed words (specs/guest-app.md rules 11bis, 18, 40, 48). Labels the server does not send because
 * they never change: the module keys, the block types, the weekdays.
 */

/** Rule 11bis — the modules of a lodging, in the default order, with what each one shows. */
export const MODULES = Object.freeze({
  gate: { label: { fr: 'Portail', en: 'Gate' }, icon: 'gate', hint: 'Visible pendant le séjour, dès que l’accès au portail est prêt.' },
  wifi: { label: { fr: 'Wifi', en: 'Wifi' }, icon: 'wifi', hint: 'Le réseau et le mot de passe des Infos du logement.' },
  shop: { label: { fr: 'Boutique', en: 'Shop' }, icon: 'shop', hint: 'Les articles vendus dans ce logement (écran Boutique).' },
  bath: { label: { fr: 'Bain nordique', en: 'Nordic bath' }, icon: 'bath', hint: 'Un raccourci vers les créneaux, qui suivent le planning des ressources.' },
  soliomap: { label: { fr: 'Activités', en: 'Activities' }, icon: 'soliomap', hint: 'Soliomap, dans l’app ou dans un nouvel onglet (Réglages › Application).' },
  booklet: { label: { fr: 'Livret', en: 'Guide' }, icon: 'booklet', hint: 'Les pages publiées du livret de ce logement.' },
  orders: { label: { fr: 'Mes commandes', en: 'My orders' }, icon: 'orders', hint: 'Un onglet « Commandes » et, sur l’accueil, les commandes en cours. Pas de tuile.' },
  contacts: { label: { fr: 'Urgences', en: 'Emergencies' }, icon: 'contacts', hint: 'Les contacts d’urgence des Infos du logement.' },
});

/** The modules that never make a home tile (rule 11bis: `orders` is a tab). */
export const NOT_A_TILE = Object.freeze(['orders']);

/** Rule 18 — the palette, in the boards' order. */
export const BLOCK_TYPES = Object.freeze([
  { type: 'text', label: 'Texte' },
  { type: 'image', label: 'Image' },
  { type: 'gallery', label: 'Galerie' },
  { type: 'callout', label: 'Encadré' },
  { type: 'steps', label: 'Étapes' },
  { type: 'wifi', label: 'Wifi' },
  { type: 'contact', label: 'Contact' },
  { type: 'place', label: 'Lieu' },
  { type: 'faq', label: 'Questions' },
  { type: 'button', label: 'Bouton' },
  { type: 'hours', label: 'Horaires' },
]);

export const blockLabel = (type) => (BLOCK_TYPES.find((b) => b.type === type) || { label: type }).label;

/** Rule 40 — Monday first, as the operator reads a week; the server's keys are 0 (Sunday) to 6. */
export const WEEKDAYS = Object.freeze([
  { key: '1', label: 'Lundi' }, { key: '2', label: 'Mardi' }, { key: '3', label: 'Mercredi' }, { key: '4', label: 'Jeudi' },
  { key: '5', label: 'Vendredi' }, { key: '6', label: 'Samedi' }, { key: '0', label: 'Dimanche' },
]);

/** Rule 16 — the page icons the guest app draws (its `Icon` names). */
export const PAGE_ICONS = Object.freeze([
  { value: 'home', label: 'Maison' }, { value: 'gate', label: 'Portail' }, { value: 'booklet', label: 'Livret' },
  { value: 'bath', label: 'Bain' }, { value: 'wifi', label: 'Wifi' }, { value: 'soliomap', label: 'Lieu' },
  { value: 'shop', label: 'Boutique' }, { value: 'info', label: 'Information' }, { value: 'alert', label: 'Attention' },
  { value: 'contacts', label: 'Contacts' }, { value: 'clock', label: 'Horaires' },
]);

/** GuestFlow's own screens the studio sends the operator to (rule 48: prices, titles, stock, names are GuestFlow's). */
export const GUESTFLOW_LINKS = Object.freeze({
  properties: '/properties',
  option: '/parametres/options-ressources',
  resource: '/parametres/options-ressources?tab=resources',
  integrations: '/settings/integrations',
});

export const DEFAULT_HERO_LABEL = 'Vue aérienne du domaine (par défaut)';
