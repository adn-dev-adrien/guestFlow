// Shared fixture of the outside-booking offer suites (specs/gift-voucher-campaigns.md rules 29, 35, 36, 53): the core database in memory with the plugin registered the way the host does
// (so its offer is reached through `ctx.core.resourceBookingOffer()`, as another plugin reaches it), one bath with its degressive tiers and an evening band, one option sold outside a stay,
// a clock on a Sunday so the slots begin on the Monday after. Not a test file. A suite sets `process.env.DB_PATH = ':memory:'` before requiring it.

process.env.TZ = 'Europe/Paris';

const db = require('../../../database');
const sdk = require('../../sdk');
const registry = require('../../sdk/registry');
const { createContext } = require('../../sdk/createContext');
const { applyPluginSchema } = require('../../sdk/testing');
const plugin = require('..');
const sales = require('../../../models/standaloneSalesModel');
const standaloneSale = require('../../../utils/standaloneSale');
const { createVisitModel } = require('../visitModel');
const { createFicheModel } = require('../ficheModel');
const { createLineMarksModel } = require('../lineMarksModel');
const bookingsModel = require('../bookingsModel');
const occupancyModel = require('../occupancyModel');

const NOW = new Date('2026-11-15T10:00:00Z'); // date-literal-ok: the suite runs on its own clock, never the real today
const DAY = '2026-11-16'; // date-literal-ok: the suite runs on its own clock, never the real today
const TIERS = [{ fromHour: 2, percent: 10 }, { fromHour: 3, percent: 20 }];

applyPluginSchema(db, 'hourly-resources');
registry.reset();
registry.configure({ isActive: () => true, allows: () => true });
const ctx = createContext(plugin.id, { db });
plugin.register(ctx);
sales.setExternalRate('resources', 20);
sales.setExternalRate('catering', 10);

const insert = (table, row) => {
  const keys = Object.keys(row);
  return Number(db.prepare(`INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map((k) => `@${k}`).join(', ')})`).run(row).lastInsertRowid);
};

const newResource = (over = {}) => insert('resources', {
  name: 'Bain nordique', quantity: 1, price: 25, priceType: 'per_hour', showsPlanningCard: 1, slotDuration: 60, minimumUsageMinutes: 60, openTime: '10:00', closeTime: '22:00',
  hourlyEveningStart: '19:00', hourlyEveningRate: 35, hourlyExternalDayRate: 50, hourlyExternalEveningRate: 70, hourlyDegressiveTiers: JSON.stringify(TIERS), sellableExternally: 1, ...over,
});
const newOption = (over = {}) => insert('options', {
  title: 'Planche apéro', price: 14, priceType: 'per_stay', vatClass: 'catering', sellableExternally: 1, ...over,
});

const offer = sdk.core.resourceBookingOffer();
let visits = null;
const bookings = bookingsModel.create(db, { standaloneVatRate: () => 20, visits: () => visits });
const occupancy = occupancyModel.create(db);
const marks = createLineMarksModel(db);
visits = createVisitModel({ db, bookings: () => bookings, marks: () => marks, now: () => NOW });
const fiche = createFicheModel({ db, visits: () => visits, marks: () => marks });
/** Publishes the bath's terms, as the operator does; → the version row the booking will accept. */
const publishTerms = () => sdk.coreModule('termsModel').publishVersion({
  activity: 'resource', markdownFr: 'CGV', markdownEn: 'T&C', htmlFr: '<p>CGV</p>', htmlEn: '<p>T&C</p>', contentHash: 'hash-1', publishedAt: NOW.toISOString(),
});
const holdRows = (ref) => db.prepare('SELECT * FROM resource_booking_holds WHERE ref = ? ORDER BY id').all(ref);

/** The engine's price of an option line, in cents, as the sale will ask for it. */
const optionCents = (optionId, quantity = 1) => standaloneSale.quote({ lines: [{ articleRef: `option:${optionId}`, quantity }] }).document.totals.totalCents;

/**
 * An outside booking made through the offer: 2 h from `start` on `date`, the session covered by a prepaid tender of `source` « giftVoucher » (its label « Bon cadeau »), an option
 * covered the same way, and a card for what remains. → the offer's answer, and what the quote said.
 */
function bookCovered({
  resourceId, optionId = null, date = DAY, start = '10:00', band = 'day', minutes = 120, extraMinutes = 0, card = true, ref = 'BC-2026-0001', name = 'Léa Martin', termsVersionId = null,
}) {
  const quote = offer.quote({
    resourceId, date, start, coveredBand: band, coveredMinutes: minutes, extraMinutes,
  });
  const fulfilments = [{ role: 'session', ...quote.session.line }, ...(quote.extra ? [{ role: 'extra', ...quote.extra.line }] : [])];
  const optionLine = optionId ? [{ articleRef: `option:${optionId}`, quantity: 1 }] : [];
  const covers = [{ role: 'session', amountCents: quote.session.coveredCents }, ...(optionId ? [{ articleRef: `option:${optionId}`, amountCents: optionCents(optionId) }] : [])];
  const dueCents = quote.session.supplementCents + (quote.extra ? quote.extra.totalCents : 0);
  const answer = offer.bookOutside({
    resourceId,
    date,
    start,
    end: quote.endTime,
    customer: { name, email: 'lea@example.test', phone: '0612345678' },
    fulfilments,
    lines: optionLine,
    tenders: [
      { method: 'prepaid', source: 'giftVoucher', ref, label: 'Bon cadeau', covers },
      ...(card && dueCents > 0 ? [{ method: 'card', amountCents: dueCents, source: 'payment-link:1' }] : []),
    ],
    channel: 'mon-bain',
    terms: termsVersionId ? { versionId: termsVersionId, ip: '203.0.113.9', userAgent: 'test' } : null,
    now: NOW,
  });
  return { answer, quote, dueCents };
}

module.exports = {
  db, sdk, ctx, registry, offer, bookings, occupancy, marks, visits, fiche, sales, standaloneSale, NOW, DAY, TIERS, insert, newResource, newOption, holdRows, optionCents, bookCovered, publishTerms,
};
