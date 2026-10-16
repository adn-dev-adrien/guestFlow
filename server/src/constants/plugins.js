// Built-in plugin catalogue — the plugins shipped on this branch. The wider catalogue lives on the
// plugins integration branch; this file is taken from that branch's version when it merges
// (specs/plugin-engine-backport.md rule 2). Mirrored client-side in client/src/constants/plugins.js.

const GITES_DE_FRANCE_INTAKE = 'gites-de-france-intake';

const PLUGIN_CATALOG = Object.freeze([
  {
    id: GITES_DE_FRANCE_INTAKE,
    name: 'Saisie Gîtes de France',
    description: 'Remplit les fiches Gîtes de France depuis le mail de réservation de la centrale.',
    icon: 'mail',
    surfaces: ['Paramètres › Intégrations › Saisie Gîtes de France', 'Le bandeau en haut de la fiche', 'Une alerte du tableau de bord'],
  },
].map((p) => Object.freeze({ ...p, surfaces: Object.freeze(p.surfaces), requires: Object.freeze([]) })));

const PLUGIN_IDS = Object.freeze(PLUGIN_CATALOG.map((p) => p.id));

function findPlugin(id) {
  return PLUGIN_CATALOG.find((p) => p.id === id) || null;
}

module.exports = {
  GITES_DE_FRANCE_INTAKE,
  PLUGIN_CATALOG,
  PLUGIN_IDS,
  findPlugin,
};
