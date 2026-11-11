/**
 * Shared fixtures of the EstablishmentClosuresPage suites: a closure ahead of today, the empty conflicts
 * answer, and a `window.matchMedia` stub. Not a test file.
 */
import dayjs from 'dayjs';

export const inDays = (n) => dayjs().add(n, 'day').format('YYYY-MM-DD');
export const CLOSURE = { id: 5, propertyId: 1, propertyName: 'Gîte', label: 'Travaux', startDate: inDays(30), endDate: inDays(33) };
export const NONE = { reservations: [], requests: [], devis: [] };

export const media = (matches) => (query) => ({
  matches, media: query, onchange: null,
  addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false; },
});
