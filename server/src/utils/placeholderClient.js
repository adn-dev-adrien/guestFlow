/**
 * Whether a client is an iCal placeholder rather than a guest (specs/email-automation.md rule 19).
 *
 * The iCal import names a stay it got no guest name for « Ical <platform> »
 * (`icalParser.resolveIcalClientIdentity`), and older imports kept the platform's own words
 * (« Reserved », « Closed Not available »). Neither is a name to greet anyone with.
 */
const { parseGuestName } = require('./icalParser');

function isPlaceholderClient(client) {
  const firstName = String((client && client.firstName) || '').trim();
  const lastName = String((client && client.lastName) || '').trim();
  if (firstName.toLowerCase() === 'ical') return true;
  return parseGuestName(`${firstName} ${lastName}`, '').isFallback;
}

module.exports = { isPlaceholderClient };
