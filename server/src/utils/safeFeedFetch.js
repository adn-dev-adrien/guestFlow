/**
 * Bounded, public-only fetch of an operator-configured iCal feed (specs/ical-import-hardening.md rule 17).
 *
 * The URL is operator input, but the server reads it from inside the LAN, next to the database host and
 * the other containers: a feed URL must not be able to reach a loopback, private or link-local address,
 * directly, through a name that resolves to one, or through a redirect. The body is capped so a hostile
 * or broken endpoint cannot fill the memory. `GUESTFLOW_ICAL_ALLOW_PRIVATE=1` lifts the address check
 * for a dev box whose test feed lives on localhost.
 */
const dns = require('dns');
const net = require('net');
const undici = require('undici');

const MAX_FEED_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const PRIVATE_MESSAGE = 'Adresse du flux non autorisée (réseau privé).';

class FeedFetchError extends Error {}

function isPrivateIpv4(parts) {
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || a >= 224;
}

// The 16 bytes of an IPv6 address, or null. The URL parser rewrites `::ffff:127.0.0.1` as `::ffff:7f00:1`,
// so the classification works on bytes, never on the textual form.
function ipv6Bytes(address) {
  let text = String(address).split('%')[0].toLowerCase();
  const tail = text.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (tail) {
    const v4 = tail[2].split('.').map(Number);
    if (v4.some((n) => !(n >= 0 && n <= 255))) return null;
    text = `${tail[1]}${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const parse = (part) => (part === '' ? [] : part.split(':'));
  const head = parse(halves[0]);
  const rest = halves.length === 2 ? parse(halves[1]) : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 1) return null;
  const groups = halves.length === 1 ? head : [...head, ...Array(missing).fill('0'), ...rest];
  const bytes = [];
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    const n = parseInt(g, 16);
    bytes.push(n >> 8, n & 255);
  }
  return bytes;
}

function isPrivateAddress(address) {
  const family = net.isIP(address);
  if (family === 4) return isPrivateIpv4(address.split('.').map(Number));
  if (family !== 6) return true;
  const bytes = ipv6Bytes(address);
  if (!bytes) return true;
  const zeros = (from, to) => bytes.slice(from, to).every((b) => b === 0);
  if (zeros(0, 10) && bytes[10] === 255 && bytes[11] === 255) return isPrivateIpv4(bytes.slice(12));
  if (zeros(0, 12)) return true; // ::/96: unspecified, loopback, deprecated IPv4-compatible
  if (bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b) return true; // 64:ff9b::/16 NAT64
  if (bytes[0] === 0x20 && bytes[1] === 0x02) return isPrivateIpv4(bytes.slice(2, 6)); // 6to4
  return (bytes[0] & 0xfe) === 0xfc || (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) || bytes[0] === 0xff;
}

const allowPrivate = (env) => env.GUESTFLOW_ICAL_ALLOW_PRIVATE === '1';

// A literal address or `localhost` is judged on the spot; a name is judged where it is dialled (guardedLookup).
function assertPublicHost(hostname, { env = process.env } = {}) {
  if (allowPrivate(env)) return;
  const host = hostname.replace(/^\[|\]$/g, '');
  if (host.toLowerCase() === 'localhost' || host.toLowerCase().endsWith('.localhost')) throw new FeedFetchError(PRIVATE_MESSAGE);
  if (net.isIP(host) && isPrivateAddress(host)) throw new FeedFetchError(PRIVATE_MESSAGE);
}

/**
 * The `lookup` of the connection itself: the address validated is the address dialled, so a name that
 * answers a public address to a check and a private one to the connection (DNS rebinding) is refused, on
 * every hop. A failed lookup is a refusal.
 */
function guardedLookup({ resolve = (host, cb) => dns.lookup(host, { all: true }, cb), env = process.env } = {}) {
  return (hostname, options, callback) => {
    const done = typeof options === 'function' ? options : callback;
    const wantsAll = typeof options === 'object' && options && options.all;
    resolve(hostname, (error, records) => {
      if (error) return done(error);
      const list = [].concat(records || []).map((r) => (typeof r === 'string' ? { address: r, family: net.isIP(r) } : r));
      if (list.length === 0) return done(new FeedFetchError('Adresse du flux introuvable.'));
      if (!allowPrivate(env) && list.some((r) => isPrivateAddress(r.address))) return done(new FeedFetchError(PRIVATE_MESSAGE));
      return wantsAll ? done(null, list) : done(null, list[0].address, list[0].family);
    });
  };
}

async function readCapped(response, maxBytes) {
  const tooBig = () => new FeedFetchError('Flux iCal trop volumineux.');
  const declared = Number(response.headers && response.headers.get && response.headers.get('content-length'));
  if (declared > maxBytes) throw tooBig();
  if (response.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw tooBig();
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks).toString('utf8');
  }
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > maxBytes) throw tooBig();
  return text;
}

/**
 * GET `url`, following at most MAX_REDIRECTS redirects by hand. Every hop is checked (literal address,
 * localhost) and every connection is dialled through `guardedLookup`. Resolves to the final response with a
 * `release()` that closes the connection pool once the body is read (or abandoned); the caller reads the
 * body with `readCapped`. `fetchImpl` is injected by tests; production always uses undici's own fetch so the
 * pinning Agent is of the same version as the client.
 */
async function fetchPublic(url, { signal, fetchImpl = undici.fetch, resolve, env = process.env } = {}) {
  const dispatcher = new undici.Agent({ connect: { lookup: guardedLookup({ resolve, env }) }, keepAliveTimeout: 1000 });
  // `close()` waits for the response body: an unread one (a 500 with a big body) would hold it until the
  // timeout, so the body is cancelled first.
  const releaseFor = (response) => async () => {
    try { if (response && response.body && typeof response.body.cancel === 'function' && !response.bodyUsed) await response.body.cancel(); } catch { /* already closed */ }
    await dispatcher.close().catch(() => {});
  };
  const release = releaseFor(null);
  try {
    let current = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      let parsed;
      try { parsed = new URL(current); } catch { throw new FeedFetchError('Adresse du flux invalide.'); }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new FeedFetchError('Adresse du flux invalide.');
      assertPublicHost(parsed.hostname, { env });
      let response;
      try {
        response = await fetchImpl(current, { method: 'GET', signal, redirect: 'manual', dispatcher });
      } catch (error) {
        // The refusal of the connection's own lookup surfaces as the cause of « fetch failed ».
        if (error && error.cause instanceof FeedFetchError) throw error.cause;
        throw error;
      }
      const location = response.status >= 300 && response.status < 400 && response.headers && response.headers.get && response.headers.get('location');
      if (!location) {
        response.release = releaseFor(response);
        return response;
      }
      current = new URL(location, current).toString();
    }
    throw new FeedFetchError('Trop de redirections.');
  } catch (error) {
    await release();
    throw error;
  }
}

module.exports = {
  fetchPublic, readCapped, assertPublicHost, guardedLookup, isPrivateAddress, MAX_FEED_BYTES, FeedFetchError,
};
