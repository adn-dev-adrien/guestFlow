// Shared fixtures of the bath scheduling suites (specs/guest-app-bath-home-scheduling.md). Not a test file: the `bath` cards `/me`
// answers, the slots and blocks of one resource, and a quote that echoes the breakdown it is given.
import { ME_STAY, SHOP, item } from './guestFixtures';

export const BATH_ID = 5;

export const card = (over = {}) => ({
  resourceId: BATH_ID,
  name: 'Bain nordique',
  state: 'toSchedule',
  eyebrow: 'Bien-être',
  title: '1 h offerte à programmer',
  detail: 'En journée, ou en soirée avec 20 € de supplément',
  ownedMinutes: 60,
  offeredMinutes: 60,
  heldMinutes: 0,
  maxExtraHours: 4,
  priceLine: '30 € l’heure · 50 € en soirée',
  upcoming: [],
  actions: [{ key: 'schedule', label: 'Programmer' }],
  ...over,
});

export const meWith = (cards) => ({ ...ME_STAY, bath: cards });

export const SHOP_BATH = {
  ...SHOP,
  categories: [{ name: 'Bien-être', items: [item({ kind: 'resource', id: BATH_ID, title: 'Bain nordique', scheduling: 'hourly', priceLabel: '30 €' })] }],
};

const slot = (h) => ({ start: `${h}:00`, end: `${h + 1}:00`, state: h >= 20 ? 'evening' : 'free', band: h >= 20 ? 'evening' : 'day', priceLabel: 'Offert' });

export const SLOTS = {
  open: true,
  days: [
    { date: '2099-07-07', label: 'mar. 7 juil.', available: true, slots: [16, 17, 20, 21].map(slot) },
    { date: '2099-07-08', label: 'mer. 8 juil.', available: true, slots: [11, 12].map(slot) },
  ],
};

export const BLOCKS = {
  open: true,
  hours: 2,
  days: [{ date: '2099-07-07', label: 'mar. 7 juil.', starts: [{ start: '16:00', end: '18:00', eveningMinutes: 0 }, { start: '20:00', end: '22:00', eveningMinutes: 120 }] }],
};

/** A quote of one bath line: `total` and `breakdown` as the server would say them. */
export const quoteOf = (total, breakdown) => (body) => ({
  lines: [{ kind: 'resource', id: BATH_ID, sessions: body.lines[0].sessions, total, totalLabel: `${total} €`, breakdown }],
  total,
  totalLabel: `${total} €`,
});
