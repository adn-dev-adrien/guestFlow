/**
 * The text a picker searches in (specs/resource-booking-client-picker.md rule 7): every part joined,
 * lower-cased, accents stripped, spaces collapsed. The client applies the same folding to what is typed
 * and checks that each typed word is included, so « dupont jéan » finds « Jean Dupont ».
 */
function normalizeSearchText(...parts) {
  return parts
    .filter((part) => part !== null && part !== undefined && part !== '')
    .join(' ')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = { normalizeSearchText };
