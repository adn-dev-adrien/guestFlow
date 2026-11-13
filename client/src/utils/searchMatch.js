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

// « 06.12 » or « 06-12 » is a phone typed with its separators: the server's text carries the digits.
const PHONE_FRAGMENT = /^[+\d().-]+$/;

export function matchesSearch(searchText, query) {
  // A word made of separators only (« . », « - ») says nothing and is ignored.
  const words = normalizeQuery(query).split(' ').filter((word) => !/^[+().-]*$/.test(word));
  const haystack = String(searchText || '');
  return words.every((word) => {
    if (haystack.includes(word)) return true;
    return PHONE_FRAGMENT.test(word) && haystack.includes(word.replace(/\D/g, ''));
  });
}
