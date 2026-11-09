/**
 * What the app keeps on the device (specs/guest-app.md rules 4, 9, 32, 52): the stay link to re-exchange when
 * a session ends, the lodging poster code for the visitor fallback, the guest's language and day / night
 * choice, the visit count of the install card, and the cart (local UI state).
 */

const KEY = 'gf-guest';

function storage() {
  try { return window.localStorage; } catch { return null; }
}

function readAll() {
  const s = storage();
  if (!s) return {};
  try { return JSON.parse(s.getItem(KEY) || '{}') || {}; } catch { return {}; }
}

function writeAll(value) {
  const s = storage();
  if (!s) return;
  try { s.setItem(KEY, JSON.stringify(value)); } catch { /* storage full or denied: the app still works this visit */ }
}

export const device = {
  get: (name) => readAll()[name],
  set: (name, value) => {
    const all = readAll();
    if (value === undefined || value === null) delete all[name];
    else all[name] = value;
    writeAll(all);
  },
};
