/**
 * Which readings of an equipment a « Domotique » block shows (specs/guest-app-home-automation.md rule 12). Studio
 * picks an equipment, never an alias: the readings are found in its catalogue entry by Sowel category, with the
 * aliases Sowel's aggregators publish as fall-back. Pure.
 */

const KINDS = Object.freeze(['outdoor', 'rooms', 'lights', 'rain', 'energy']);
const LIST_KINDS = Object.freeze(['rooms', 'lights']);
const LIGHT_TYPES = Object.freeze(['light_onoff', 'light_dimmable', 'light_color', 'switch']);
const MAX_ITEMS = Object.freeze({ rooms: 8, lights: 6 });

/** role → how to find it: categories first, then aliases. */
const ROLES = Object.freeze({
  outdoor: {
    temperature: { categories: ['temperature_outdoor'], aliases: ['temperature'] },
    min: { aliases: ['temperature_min_today'] },
    max: { aliases: ['temperature_max_today'] },
    humidity: { categories: ['humidity_outdoor'], aliases: ['humidity'] },
    wind: { aliases: ['wind_strength'], categories: ['wind'] },
  },
  room: {
    temperature: { categories: ['temperature'], aliases: ['temperature'] },
    humidity: { categories: ['humidity'], aliases: ['humidity'] },
  },
  light: {
    state: { categories: ['light_state'], aliases: ['state'] },
  },
  rain: {
    lastHour: { aliases: ['rain_1h', 'sum_rain_1'] },
    today: { aliases: ['rain_today'] },
    last24h: { aliases: ['rain_24h', 'sum_rain_24'] },
    hourly: { aliases: ['rain_1h', 'sum_rain_1'] },
  },
  energy: {
    power: { categories: ['power'], aliases: ['power'] },
    today: { aliases: ['energy_day'] },
    hourly: { aliases: ['energy_hour'] },
  },
});

/** The roles a block's equipment plays: outdoor, rain and energy are single; a room and a light are list items. */
const ROLE_SET = Object.freeze({ outdoor: 'outdoor', rain: 'rain', energy: 'energy', rooms: 'room', lights: 'light' });

/** The alias playing `role` on a catalogue entry, or null. */
function aliasFor(entry, roleDef) {
  if (!entry) return null;
  const readings = entry.readings || [];
  const byCategory = (roleDef.categories || []).map((c) => readings.find((r) => r.category === c)).find(Boolean);
  if (byCategory) return byCategory.alias;
  const byAlias = (roleDef.aliases || []).map((a) => readings.find((r) => r.alias === a)).find(Boolean);
  return byAlias ? byAlias.alias : null;
}

/** { role: alias } for one equipment in one block kind (only the roles it can play). */
function rolesOf(kind, entry) {
  const defs = ROLES[ROLE_SET[kind]];
  return Object.fromEntries(Object.entries(defs)
    .map(([role, def]) => [role, aliasFor(entry, def)])
    .filter(([, alias]) => alias));
}

/** Can this catalogue entry fill this block kind? The role without which the block says nothing. */
function fits(kind, entry) {
  if (!entry) return false;
  const roles = rolesOf(kind, entry);
  if (kind === 'outdoor' || kind === 'rooms') return Boolean(roles.temperature);
  if (kind === 'rain') return Boolean(roles.lastHour || roles.today || roles.last24h);
  if (kind === 'energy') return Boolean(roles.power || roles.today);
  if (kind === 'lights') return LIGHT_TYPES.includes(entry.type);
  return false;
}

/** The equipments a block references, with their item when a list. */
function equipmentsOf(block) {
  if (LIST_KINDS.includes(block.kind)) return (block.items || []).map((item) => ({ equipmentId: item.equipmentId, item }));
  return block.equipmentId ? [{ equipmentId: block.equipmentId, item: null }] : [];
}

/** Rule 4 — every `(equipmentId, alias)` the switched-on blocks of these lodgings read. */
function selectionOf(blocksByLodging, catalog) {
  const byId = new Map(catalog.map((e) => [e.id, e]));
  const pairs = new Map();
  blocksByLodging.flat().filter((b) => b.on).forEach((block) => {
    equipmentsOf(block).forEach(({ equipmentId }) => {
      Object.values(rolesOf(block.kind, byId.get(equipmentId))).forEach((alias) => {
        pairs.set(`${equipmentId}\u0000${alias}`, { equipmentId, alias });
      });
    });
  });
  return [...pairs.values()].sort((a, b) => a.equipmentId.localeCompare(b.equipmentId) || a.alias.localeCompare(b.alias));
}

module.exports = {
  KINDS, LIST_KINDS, LIGHT_TYPES, MAX_ITEMS, ROLES, rolesOf, fits, equipmentsOf, selectionOf,
};
