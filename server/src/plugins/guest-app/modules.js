/**
 * What a lodging shows its guests (specs/guest-app.md rules 10, 11bis). Pure: the stored configuration
 * and the facts come in, the shown list goes out.
 */

// Rule 10's default tiles, in order. `orders` is on for the tab of rule 51 and `contacts` stays off until
// the operator turns the shortcut on.
const MODULES = Object.freeze([
  { key: 'gate', on: true, label: { fr: 'Portail', en: 'Gate' } },
  { key: 'wifi', on: true, label: { fr: 'Wifi', en: 'Wifi' } },
  { key: 'shop', on: true, label: { fr: 'Boutique', en: 'Shop' } },
  { key: 'bath', on: true, label: { fr: 'Bain nordique', en: 'Nordic bath' } },
  { key: 'soliomap', on: true, label: { fr: 'Soliomap', en: 'Soliomap' } },
  { key: 'booklet', on: true, label: { fr: 'Livret', en: 'Booklet' } },
  { key: 'orders', on: true, label: { fr: 'Mes commandes', en: 'My orders' } },
  { key: 'contacts', on: false, label: { fr: 'Urgences & contacts', en: 'Emergency & contacts' } },
]);

const MODULE_KEYS = Object.freeze(MODULES.map((m) => m.key));

// `orders` is reached from the tab bar and the home's « Commandes en cours » row: rule 10's six tiles do
// not hold it.
const NOT_A_TILE = new Set(['orders']);

// Rule 5 and rule 6: a visitor has no gate, no shop and no order; a pre-arrival guest reads the catalogue.
const MODES_OF = Object.freeze({
  gate: ['stay'],
  shop: ['stay', 'preArrival'],
  bath: ['stay'],
  orders: ['stay'],
});

const PREREQUISITES = Object.freeze({
  gate: (facts) => Boolean(facts.gateKey),
  wifi: (facts) => Boolean(facts.wifiConfigured),
  shop: (facts) => Number(facts.soldItems) > 0,
  bath: (facts) => Number(facts.soldHourlyResources) > 0,
  soliomap: (facts) => Boolean(facts.soliomapUrl),
  contacts: (facts) => Number(facts.contactCount) > 0,
});

const defaultModules = () => MODULES.map(({ key, on }, order) => ({ key, on, order }));

/**
 * The stored list, whole and in order. A key the stored list does not name (a module added by a later
 * version) comes last, with its default state; a key it names that no longer exists is dropped.
 */
function readModules(stored) {
  if (!Array.isArray(stored)) return defaultModules();
  const known = stored
    .filter((m) => m && MODULE_KEYS.includes(m.key))
    .sort((a, b) => Number(a.order) - Number(b.order))
    .map((m) => ({ key: m.key, on: Boolean(m.on) }));
  const missing = MODULES.filter(({ key }) => !known.some((m) => m.key === key)).map(({ key, on }) => ({ key, on }));
  return [...known, ...missing].map((m, order) => ({ ...m, order }));
}

/** Rule 11bis — on for the lodging, its prerequisite holds and the session's mode has it. */
function shownModules(stored, facts, mode, lang = 'fr') {
  return readModules(stored)
    .filter(({ key, on }) => {
      if (!on) return false;
      if (MODES_OF[key] && !MODES_OF[key].includes(mode)) return false;
      return !PREREQUISITES[key] || PREREQUISITES[key](facts);
    })
    .map(({ key }, order) => {
      const { label } = MODULES.find((m) => m.key === key);
      return { key, label: label[lang] || label.fr, order };
    });
}

const tilesOf = (shown) => shown.filter(({ key }) => !NOT_A_TILE.has(key));

/** PUT boundary: the closed list, each key once, `order` a permutation. → an error message or null. */
function modulesInputError(input) {
  if (!Array.isArray(input) || input.length !== MODULE_KEYS.length) return 'La liste des modules est incomplète.';
  const keys = input.map((m) => (m && m.key));
  if (keys.some((key) => !MODULE_KEYS.includes(key)) || new Set(keys).size !== keys.length) return 'Module inconnu ou en double.';
  if (input.some((m) => typeof m.on !== 'boolean')) return 'Chaque module est activé ou non.';
  const orders = input.map((m) => m.order).sort((a, b) => a - b);
  if (orders.some((order, index) => order !== index)) return 'L’ordre des modules est invalide.';
  return null;
}

module.exports = { MODULE_KEYS, defaultModules, modulesInputError, readModules, shownModules, tilesOf };
