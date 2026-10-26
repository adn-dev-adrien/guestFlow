/**
 * The ARI messages Google Vacation Rentals reads (specs/google-vacation-rentals-feed.md §4.1). Pure
 * string templates with escaping — no XML dependency. Every builder takes its timestamp and token
 * from the caller, so the same input always gives the same bytes (golden files in tests/).
 *
 * One listing = one room type (`ROOM_ID`) and one rate plan (`RATE_PLAN`) — Google's vacation-rental
 * model (rule 3). The tourist tax travels inside each length-of-stay amount (AmountAfterTax), not in a
 * separate Taxes message: see `losAmountMessage`.
 */

const ROOM_ID = 'whole';
const RATE_PLAN = 'direct';
const OTA_NS = 'http://www.opentravel.org/OTA/2003/05';

// The upload paths below https://www.google.com/travel/hotels/uploads/ (googleClient.js).
const PATHS = Object.freeze({
  propertyData: 'property_data',
  rateAmount: 'ota/hotel_rate_amount_notif',
  invCount: 'ota/hotel_inv_count_notif',
  avail: 'ota/hotel_avail_notif',
});

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ESCAPES[c]);
const money = (cents) => (Number(cents) / 100).toFixed(2);

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8"?>';

function otaOpen(root, { partnerId, timestamp, echoToken }) {
  return `${XML_HEAD}\n<${root} xmlns="${OTA_NS}" EchoToken="${esc(echoToken)}" TimeStamp="${esc(timestamp)}" Version="3.0">\n`
    + `  <POS><Source><RequestorID ID="${esc(partnerId)}"/></Source></POS>\n`;
}

/** The listing's room and rate plan (`Transaction`, property data). */
function propertyDataXml({ partnerId, hotelCode, name, capacity, timestamp, echoToken }) {
  return `${XML_HEAD}\n<Transaction timestamp="${esc(timestamp)}" id="${esc(echoToken)}" partner="${esc(partnerId)}">\n`
    + '  <PropertyDataSet action="overlay">\n'
    + `    <Property>${esc(hotelCode)}</Property>\n`
    + '    <RoomData>\n'
    + `      <RoomID>${ROOM_ID}</RoomID>\n`
    + `      <Name><Text text="${esc(name)}" language="fr"/></Name>\n`
    + `      <Capacity>${Number(capacity)}</Capacity>\n`
    + '    </RoomData>\n'
    + '    <PackageData>\n'
    + `      <PackageID>${RATE_PLAN}</PackageID>\n`
    + '      <Name><Text text="Tarif du site" language="fr"/></Name>\n'
    + `      <Occupancy>${Number(capacity)}</Occupancy>\n`
    + '      <ChargeCurrency>web</ChargeCurrency>\n'
    + '    </PackageData>\n'
    + '  </PropertyDataSet>\n'
    + '</Transaction>\n';
}

/**
 * ONE arrival date and stay length, every party size priced for it: the total of the stay, tax
 * included. PROVISIONAL SHAPE — the exact XML of length-of-stay amounts and of the tourist tax is
 * open question Q3 of specs/google-vacation-rentals-feed.md, to be confirmed with Google's Technical
 * Account Manager before this module is frozen. Everything that depends on that answer is here.
 */
function losAmountMessage({ checkin, nights, amounts }) {
  const byGuest = amounts
    .slice()
    .sort((a, b) => a.guests - b.guests)
    .map((a) => `            <BaseByGuestAmt${a.beforeTaxCents == null ? '' : ` AmountBeforeTax="${money(a.beforeTaxCents)}"`} AmountAfterTax="${money(a.amountCents)}" CurrencyCode="EUR" NumberOfGuests="${Number(a.guests)}"/>`)
    .join('\n');
  return '    <RateAmountMessage>\n'
    + `      <StatusApplicationControl Start="${esc(checkin)}" End="${esc(checkin)}" InvTypeCode="${ROOM_ID}" RatePlanCode="${RATE_PLAN}"/>\n`
    + '      <Rates>\n'
    + '        <Rate>\n'
    + '          <BaseByGuestAmts>\n'
    + `${byGuest}\n`
    + '          </BaseByGuestAmts>\n'
    + `          <LengthsOfStay><LengthOfStay Time="${Number(nights)}" TimeUnit="Day"/></LengthsOfStay>\n`
    + '        </Rate>\n'
    + '      </Rates>\n'
    + '    </RateAmountMessage>\n';
}

/** rates: [{ checkin, nights, guests, amountCents, beforeTaxCents }] — grouped by (arrival, length). */
function rateAmountXml({ partnerId, hotelCode, rates, timestamp, echoToken }) {
  const groups = new Map();
  rates.forEach((r) => {
    const key = `${r.checkin}|${r.nights}`;
    if (!groups.has(key)) groups.set(key, { checkin: r.checkin, nights: r.nights, amounts: [] });
    groups.get(key).amounts.push(r);
  });
  const ordered = [...groups.values()].sort((a, b) => (a.checkin === b.checkin ? a.nights - b.nights : (a.checkin < b.checkin ? -1 : 1)));
  return otaOpen('OTA_HotelRateAmountNotifRQ', { partnerId, timestamp, echoToken })
    + `  <RateAmountMessages HotelCode="${esc(hotelCode)}">\n`
    + ordered.map(losAmountMessage).join('')
    + '  </RateAmountMessages>\n'
    + '</OTA_HotelRateAmountNotifRQ>\n';
}

/** Consecutive dates with the same `keyOf` collapse into one [start, end] range. */
function runs(days, keyOf) {
  const sorted = days.slice().sort((a, b) => (a.date < b.date ? -1 : 1));
  const out = [];
  sorted.forEach((day) => {
    const last = out[out.length - 1];
    const next = new Date(`${last ? last.end : day.date}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    if (last && keyOf(last.day) === keyOf(day) && next.toISOString().slice(0, 10) === day.date) {
      last.end = day.date;
    } else {
      out.push({ start: day.date, end: day.date, day });
    }
  });
  return out;
}

/** Rule 6 — 1 on a free night, 0 on a blocked one. */
function invCountXml({ partnerId, hotelCode, days, timestamp, echoToken }) {
  const body = runs(days, (d) => String(d.inventory)).map((r) => '    <Inventory>\n'
    + `      <StatusApplicationControl Start="${r.start}" End="${r.end}" InvTypeCode="${ROOM_ID}"/>\n`
    + `      <InvCounts><InvCount Count="${Number(r.day.inventory)}" CountType="2"/></InvCounts>\n`
    + '    </Inventory>\n').join('');
  return otaOpen('OTA_HotelInvCountNotifRQ', { partnerId, timestamp, echoToken })
    + `  <Inventories HotelCode="${esc(hotelCode)}">\n${body}  </Inventories>\n`
    + '</OTA_HotelInvCountNotifRQ>\n';
}

const restrictionKey = (d) => [d.minLos, d.maxLos, d.closedToArrival, d.closedToDeparture, d.closed].join('|');

/** Rule 7 — minimum/maximum stay by arrival, closed to arrival/departure, master close. */
function availXml({ partnerId, hotelCode, days, timestamp, echoToken }) {
  const body = runs(days, restrictionKey).map(({ start, end, day }) => {
    const los = [];
    if (day.minLos != null) los.push(`<LengthOfStay Time="${Number(day.minLos)}" TimeUnit="Day" MinMaxMessageType="SetMinLOS"/>`);
    if (day.maxLos != null) los.push(`<LengthOfStay Time="${Number(day.maxLos)}" TimeUnit="Day" MinMaxMessageType="SetMaxLOS"/>`);
    return '    <AvailStatusMessage>\n'
      + `      <StatusApplicationControl Start="${start}" End="${end}" InvTypeCode="${ROOM_ID}" RatePlanCode="${RATE_PLAN}"/>\n`
      + (los.length ? `      <LengthsOfStay ArrivalDateBased="true">${los.join('')}</LengthsOfStay>\n` : '')
      + `      <RestrictionStatus Status="${day.closed ? 'Close' : 'Open'}"/>\n`
      + `      <RestrictionStatus Status="${day.closedToArrival ? 'Close' : 'Open'}" Restriction="Arrival"/>\n`
      + `      <RestrictionStatus Status="${day.closedToDeparture ? 'Close' : 'Open'}" Restriction="Departure"/>\n`
      + '    </AvailStatusMessage>\n';
  }).join('');
  return otaOpen('OTA_HotelAvailNotifRQ', { partnerId, timestamp, echoToken })
    + `  <AvailStatusMessages HotelCode="${esc(hotelCode)}">\n${body}  </AvailStatusMessages>\n`
    + '</OTA_HotelAvailNotifRQ>\n';
}

/** Google's answer → { ok, warnings, errors }: an OTA `<Success/>` or a 2xx without `<Error`. */
function parseResponse(status, body) {
  const text = String(body || '');
  const grab = (tag) => [...text.matchAll(new RegExp(`<${tag}\\b[^>]*?(?:/>|>([\\s\\S]*?)</${tag}>)`, 'g'))]
    .map((m) => {
      const attr = (m[0].match(/ShortText="([^"]*)"/) || [])[1];
      return String(m[1] || attr || m[0]).replace(/\s+/g, ' ').trim();
    });
  const errors = grab('Error');
  const warnings = grab('Warning');
  const ok = Number(status) >= 200 && Number(status) < 300 && !errors.length;
  return { ok, warnings, errors };
}

module.exports = {
  ROOM_ID, RATE_PLAN, PATHS, esc, money, runs,
  propertyDataXml, losAmountMessage, rateAmountXml, invCountXml, availXml, parseResponse,
};
