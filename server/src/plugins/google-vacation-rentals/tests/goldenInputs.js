/**
 * The fixed inputs of the ARI golden files (tests/golden/*.xml) — shared by ari-xml.unit.test.js,
 * never a test file itself. A change of the XML shape (spec Q3) regenerates the files from these.
 */

const HEADER = Object.freeze({
  partnerId: 'solio_partner', hotelCode: 'solio-la-granja', timestamp: '2027-03-01T04:00:00Z', echoToken: 'solio-la-granja-1',
});

const RATES = Object.freeze([
  { checkin: '2027-03-06', nights: 2, guests: 2, amountCents: 64280, beforeTaxCents: 63800 },
  { checkin: '2027-03-06', nights: 2, guests: 1, amountCents: 64040, beforeTaxCents: 63800 },
  { checkin: '2027-03-06', nights: 7, guests: 11, amountCents: 147560, beforeTaxCents: 146636 },
]);

const DAYS = Object.freeze([
  { date: '2027-03-06', inventory: 1, minLos: 2, maxLos: null, closedToArrival: 0, closedToDeparture: 0, closed: 0 },
  { date: '2027-03-07', inventory: 1, minLos: 2, maxLos: null, closedToArrival: 0, closedToDeparture: 0, closed: 0 },
  { date: '2027-03-08', inventory: 0, minLos: 2, maxLos: null, closedToArrival: 0, closedToDeparture: 0, closed: 0 },
  { date: '2027-03-09', inventory: 1, minLos: 4, maxLos: 7, closedToArrival: 1, closedToDeparture: 1, closed: 0 },
  { date: '2027-03-10', inventory: 0, minLos: null, maxLos: null, closedToArrival: 0, closedToDeparture: 0, closed: 1 },
]);

module.exports = { HEADER, RATES, DAYS };
