/**
 * How far ahead the public may book an hourly resource (specs/gift-voucher-campaigns.md rule 51).
 *
 * `horizonUntil(resource, now)` is « today + the resource's `bookingHorizonMonths` » in the lodgings'
 * time zone, as an ISO day: the last day a slot is offered. The guest app's slots read it through the
 * scheduler, the outside bookings and « Mon bain » through this function. The back-office never calls it.
 */

const sdk = require('../sdk');

const DEFAULT_RESOURCE_MONTHS = 3;

function horizonUntil(resource, now = new Date()) {
  const months = Number(resource && resource.bookingHorizonMonths);
  return sdk.coreModule('bookingHorizon').horizonUntil(Number.isInteger(months) && months >= 1 ? months : DEFAULT_RESOURCE_MONTHS, now);
}

module.exports = { horizonUntil, DEFAULT_RESOURCE_MONTHS };
