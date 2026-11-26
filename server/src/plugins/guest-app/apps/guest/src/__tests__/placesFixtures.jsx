// Shared fixtures of the « Pratique » suites (specs/guest-app/guest-app-local-amenities.md). Not a test file: the payload `/places` sends, and the
// session routes of a stay whose lodging shows the module.
import { baseRoutes, LODGING, ME_STAY } from './guestFixtures';

const links = (lat, lng) => ({
  apple: `https://maps.apple.com/?daddr=${lat},${lng}&dirflg=d`,
  google: `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`,
  waze: `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`,
});

const WEEK = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'].map((day) => ({
  day, ranges: day === 'dimanche' ? 'Fermé' : '7 h – 13 h · 15 h – 19 h', today: day === 'mardi',
}));

export const BAKERY = {
  id: 3, category: 'boulangerie', categoryLabel: 'Boulangerie', name: 'Maison Roux', commune: 'Satillieu', lat: 45.15123, lng: 4.6163, driveMinutes: 4, driveLabel: '4 min en voiture',
  open: { state: 'open', label: 'Ouvert · ferme à 13 h' }, hours: WEEK, wasteKind: null, accepts: null, energies: null, note: 'Fermée le lundi après-midi',
  phone: '04 75 12 34 56', telUrl: 'tel:0475123456', verifiedOn: '2099-07-01', links: links(45.15123, 4.6163), // date-literal-ok: a calendar day the server sends
};

export const BAKERY_2 = {
  ...BAKERY, id: 4, name: 'Boulangerie du Lac', commune: 'Saint-Romain-d’Ay', lat: 45.18, lng: 4.66, driveMinutes: 9, driveLabel: '9 min en voiture', open: { state: 'closed', label: 'Fermé · ouvre à 15 h' }, phone: null, telUrl: null, note: null, hours: null, links: links(45.18, 4.66),
};

export const BINS = {
  id: 1, category: 'dechets', categoryLabel: 'Déchets', name: 'Point de collecte du bourg', commune: 'Satillieu', lat: 45.1502, lng: 4.6151, driveMinutes: 5, driveLabel: '5 min en voiture',
  open: { state: 'unknown', label: 'Horaires non renseignés' }, hours: null, wasteKind: { key: 'point', label: 'Point de collecte' }, accepts: [{ key: 'om', label: 'Ordures ménagères' }, { key: 'verre', label: 'Verre' }],
  energies: null, note: null, phone: null, telUrl: null, verifiedOn: '2099-07-01', links: links(45.1502, 4.6151), // date-literal-ok: a calendar day the server sends
};

export const PLACES = {
  estate: { lat: 45.16369, lng: 4.63184 },
  categories: [{ key: 'dechets', label: 'Déchets', count: 1 }, { key: 'boulangerie', label: 'Boulangeries', count: 2 }],
  places: [BINS, BAKERY, BAKERY_2],
};

const PLACES_MODULE = { key: 'places', label: 'Pratique', order: 9 };

/** A stay whose lodging shows « Pratique »: the tile, the module, and the places. */
export const placesRoutes = (over = {}) => baseRoutes({
  'GET /me': { ...ME_STAY, tiles: [...ME_STAY.tiles, PLACES_MODULE] },
  'GET /lodging': { ...LODGING, modules: [...LODGING.modules, PLACES_MODULE] },
  'GET /places': PLACES,
  ...over,
});
