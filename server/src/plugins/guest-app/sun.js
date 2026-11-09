/**
 * Sunrise and sunset at the estate (specs/guest-app.md §6.1): the guest app moves to its night register from sunset to
 * sunrise unless the guest chose « Jour ». Server-computed, so every device of a stay switches at the same moment.
 * Pure: the NOAA approximation of the sunrise equation, good to a couple of minutes — plenty for a colour register.
 *
 * The reference point is the middle Rhône valley, where Domaine Solio stands; a few kilometres change nothing.
 */

const REFERENCE = Object.freeze({ latitude: 44.9, longitude: 4.9 });
const DAY_MS = 86400000;
const J2000 = 2451545;
const rad = Math.PI / 180;

const julianDay = (ms) => ms / DAY_MS + 2440587.5;
const fromJulian = (j) => new Date((j - 2440587.5) * DAY_MS);

/** → `{ sunrise, sunset }` (Date) of the UTC calendar day holding `at`, or null in a polar day / night. */
function sunTimes(at, { latitude, longitude } = REFERENCE) {
  const noonUtc = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate(), 12);
  const n = Math.round(julianDay(noonUtc) - J2000 + 0.0008);
  const meanSolarNoon = n - longitude / 360;
  const anomaly = (357.5291 + 0.98560028 * meanSolarNoon) % 360;
  const centre = 1.9148 * Math.sin(anomaly * rad) + 0.02 * Math.sin(2 * anomaly * rad) + 0.0003 * Math.sin(3 * anomaly * rad);
  const eclipticLongitude = (anomaly + centre + 180 + 102.9372) % 360;
  const transit = J2000 + meanSolarNoon + 0.0053 * Math.sin(anomaly * rad) - 0.0069 * Math.sin(2 * eclipticLongitude * rad);
  const declination = Math.asin(Math.sin(eclipticLongitude * rad) * Math.sin(23.4397 * rad));
  const cosHour = (Math.sin(-0.833 * rad) - Math.sin(latitude * rad) * Math.sin(declination))
    / (Math.cos(latitude * rad) * Math.cos(declination));
  if (cosHour < -1 || cosHour > 1) return null;
  const hourAngle = Math.acos(cosHour) / rad;
  return { sunrise: fromJulian(transit - hourAngle / 360), sunset: fromJulian(transit + hourAngle / 360) };
}

/** §6.1 — night from sunset to sunrise at the estate. */
function isNight(at, reference = REFERENCE) {
  const times = sunTimes(at, reference);
  if (!times) return false;
  return at < times.sunrise || at >= times.sunset;
}

module.exports = { REFERENCE, isNight, sunTimes };
