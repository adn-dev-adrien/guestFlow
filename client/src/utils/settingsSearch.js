/**
 * The search of the Paramètres summary (specs/settings-rationalization.md rule 27): every word typed
 * must be found in the row's name, its state line or one of its keywords (constants/settingsMenu.js
 * SETTINGS_KEYWORDS). Accents, case and punctuation are ignored, so « wifi » finds « Wi-Fi », « 2fa »
 * finds « 2FA », and « j-2 » stays one word: it finds « J-2 », not every row with a 2. A row found through a keyword says which one.
 */

export function normalize(text) {
  return String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const compact = (text) => normalize(text).replace(/ /g, '');
const has = (text, word) => compact(text).includes(word);

/**
 * @param {{ label: string, line?: string, keywords?: string[] }} row
 * @param {string} query
 * @returns {null | { keyword: string | null }}  null when the row does not match
 */
export function matchSettingsRow(row, query) {
  // A word is what the owner typed between spaces, punctuation dropped: « j-2 » is one word, « j2 ».
  const words = String(query || '').split(/\s+/).map((w) => normalize(w).replace(/ /g, '')).filter(Boolean);
  if (!words.length) return { keyword: null };
  const keywords = row.keywords || [];
  const own = (word) => has(row.label, word) || has(row.line, word);
  const ok = words.every((word) => own(word) || keywords.some((k) => has(k, word)));
  if (!ok) return null;
  const viaKeyword = words.find((word) => !own(word));
  return { keyword: viaKeyword ? keywords.find((k) => has(k, viaKeyword)) : null };
}
