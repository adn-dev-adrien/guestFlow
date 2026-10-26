/**
 * A ctx.settings stand-in over a plain object (the plugin_settings rows of one plugin) — shared by the
 * google-vacation-rentals suites, never a test file itself. No database.
 */

function memoryStore(values = {}, defaults = {}) {
  const data = { ...values };
  return {
    get: (key) => (data[key] === undefined || data[key] === '' ? (defaults[key] ?? '') : data[key]),
    set: (key, value) => { data[key] = value; },
    raw: (key) => data[key] || '',
    data,
  };
}

const DEFAULTS = Object.freeze({ mode: 'simulation', horizonDays: '365', maxLos: '14', fullResendHour: '4', properties: '{}' });

module.exports = { memoryStore, DEFAULTS };
