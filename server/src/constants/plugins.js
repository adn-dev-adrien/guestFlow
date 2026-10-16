// Built-in plugin catalogue — the plugins shipped on this branch. The wider catalogue lives on the
// plugins integration branch; this file is taken from that branch's version when it merges
// (specs/plugin-engine-backport.md rule 2). Mirrored client-side in client/src/constants/plugins.js.

const GITES_DE_FRANCE_INTAKE = 'gites-de-france-intake';
const BOOKING_INTAKE = 'booking-intake';

const PLUGIN_CATALOG = Object.freeze([
  {
    id: GITES_DE_FRANCE_INTAKE,
    name: 'Saisie Gîtes de France',
    description: 'Remplit les fiches Gîtes de France depuis le mail de réservation de la centrale.',
    icon: 'mail',
    surfaces: ['Paramètres › Intégrations › Saisie Gîtes de France', 'Le bandeau en haut de la fiche', 'Une alerte du tableau de bord'],
  },
  {
    id: BOOKING_INTAKE,
    name: 'Saisie Booking',
    description: 'Remplit les fiches Booking depuis la page de la réservation, ouverte dans l’extranet.',
    icon: 'bookmark',
    surfaces: ['Paramètres › Intégrations › Saisie Booking', 'Le bandeau en haut de la fiche', 'Une alerte du tableau de bord'],
  },
].map((p) => Object.freeze({ ...p, surfaces: Object.freeze(p.surfaces), requires: Object.freeze([]) })));

const PLUGIN_IDS = Object.freeze(PLUGIN_CATALOG.map((p) => p.id));

// The plugins seeded « installed but inactive », batch by batch (utils/pluginsBackportSeed.js): a plugin
// shipped later joins a new batch, so the databases that already went through the earlier ones get it too.
const PLUGIN_SEED_BATCHES = Object.freeze([
  Object.freeze({ ledger: 'plugins_backport_seed_v1', ids: Object.freeze([GITES_DE_FRANCE_INTAKE]) }),
  Object.freeze({ ledger: 'plugins_backport_seed_v2', ids: Object.freeze([BOOKING_INTAKE]) }),
]);

function findPlugin(id) {
  return PLUGIN_CATALOG.find((p) => p.id === id) || null;
}

module.exports = {
  GITES_DE_FRANCE_INTAKE,
  BOOKING_INTAKE,
  PLUGIN_CATALOG,
  PLUGIN_IDS,
  PLUGIN_SEED_BATCHES,
  findPlugin,
};
