// Shared fixture of the « Mon bain » suites (specs/gift-voucher-campaigns.md rules 23-32): the booking offer of the resource plugin (the plugin itself, on the core database, its
// terms and its clock stood in), handed to the voucher plugin as the core hands it out, and a payment provider that remembers the links it minted and withdrew. Not a test file.
// The hold of the offer lapses by the real clock; a suite lapses one by moving its `expiresAt` into the past (`lapseHold`).

const { optionalPlugin, applyPluginSchema } = require('../../sdk/testing');
const db = require('../../../database');

const hourly = {
  outside: optionalPlugin(() => require('../../hourly-resources/outsideOffer')),
  holds: optionalPlugin(() => require('../../hourly-resources/holdsModel')),
  bookings: optionalPlugin(() => require('../../hourly-resources/bookingsModel')),
  occupancy: optionalPlugin(() => require('../../hourly-resources/occupancyModel')),
};

/** The plugin's offer over the core database: `{ offer, bookings, occupancy, accepted }` where `accepted` collects the terms the offer recorded on a booking. */
function bookingOffer() {
  applyPluginSchema(db, 'hourly-resources');
  const accepted = [];
  const terms = {
    current: () => ({ id: 9, version: 1 }),
    accept: (input) => { accepted.push(input); },
  };
  const bookings = hourly.bookings.create(db, { standaloneVatRate: () => 20 });
  const occupancy = hourly.occupancy.create(db);
  const offer = hourly.outside.createOutsideOffer({
    db, bookings: () => bookings, occupancy, holds: hourly.holds.createHoldsModel(db), terms,
  });
  return {
    offer, bookings, occupancy, accepted,
  };
}

/** The core's payment provider as far as a use sees it: the links minted (with their basket source and life) and the ones withdrawn. */
function paymentLinks() {
  const minted = [];
  const withdrawn = [];
  return {
    minted,
    withdrawn,
    payments: {
      saleLink: async (sale, options) => {
        minted.push({ sale, options });
        return { linkId: minted.length, url: `https://pay.example.test/use/${minted.length}` };
      },
      refreshLink: async () => 'open',
      withdrawLink: async (linkId) => { withdrawn.push(linkId); return 'cancelled'; },
    },
  };
}

const lapseHold = (ref) => db.prepare("UPDATE resource_booking_holds SET expiresAt = '2000-01-01T00:00:00.000Z' WHERE ref = ?").run(ref);
const holdRows = (ref) => db.prepare('SELECT * FROM resource_booking_holds WHERE ref = ?').all(ref);

module.exports = {
  hourly, bookingOffer, paymentLinks, lapseHold, holdRows,
};
