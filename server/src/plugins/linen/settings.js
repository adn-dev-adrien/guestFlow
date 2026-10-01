/**
 * The eight linen settings, stored in plugin_settings (specs/plugins-phase-2-hosts.md rule 15): the
 * laundry day and the stock per linen type. Same names as the app_settings columns they came from.
 *
 * `GET/PUT /api/plugins/linen/settings` read and write them; each declared key validates its value
 * (phase 1 rule 7 plus `validate`), with the messages the core settings form used to show.
 */

const LAUNDRY_WEEKDAY = 'laundryWeekday';
const STOCK_KEYS = Object.freeze([
  'bedLinenStockSingle', 'bedLinenStockDouble', 'bedLinenStockBaby',
  'towelStockLarge', 'towelStockMedium', 'towelStockSmall', 'towelStockBathMat',
]);
const SETTING_KEYS = Object.freeze([LAUNDRY_WEEKDAY, ...STOCK_KEYS]);
const DEFAULT_WEEKDAY = 2;

// 0 = Sunday … 6 = Saturday (Date.getDay()).
function validateLaundryWeekday(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 6) return 'Doit être un entier entre 0 (dimanche) et 6 (samedi).';
  return null;
}

// A stock count: an integer from 0 to 999. 0 means « this type is not tracked ».
function validateLinenStockCount(value) {
  if (value === '' || value == null) return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 999) return 'Doit être un entier entre 0 et 999.';
  return null;
}

const DECLARED = Object.freeze([
  { key: LAUNDRY_WEEKDAY, default: String(DEFAULT_WEEKDAY), validate: validateLaundryWeekday },
  ...STOCK_KEYS.map((key) => ({ key, default: '0', validate: validateLinenStockCount })),
]);

// The settings as numbers, shaped like the former app_settings row so the moved models and
// controllers read them unchanged (`settingsModel.read()`).
function createLinenSettings(store) {
  return {
    read() {
      const row = {};
      const weekday = Number(store.get(LAUNDRY_WEEKDAY));
      row[LAUNDRY_WEEKDAY] = Number.isInteger(weekday) && weekday >= 0 && weekday <= 6 ? weekday : DEFAULT_WEEKDAY;
      STOCK_KEYS.forEach((key) => { row[key] = Math.max(0, Math.floor(Number(store.get(key)) || 0)); });
      return row;
    },
  };
}

module.exports = {
  SETTING_KEYS,
  STOCK_KEYS,
  DECLARED,
  createLinenSettings,
  validateLaundryWeekday,
  validateLinenStockCount,
};
