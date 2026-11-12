// specs/resource-booking-client-picker.md rule 7 — the server builds each option's `searchText`
// (accent-free, lower-case). The client folds what is typed the same way and keeps the options that
// contain every typed word; deciding what is searchable stays on the server.

export function normalizeQuery(query) {
  return String(query || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function matchesSearch(searchText, query) {
  const words = normalizeQuery(query).split(' ').filter(Boolean);
  const haystack = String(searchText || '');
  return words.every((word) => haystack.includes(word));
}
