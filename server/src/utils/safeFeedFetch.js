/**
 * Bounded, public-only fetch of an operator-configured iCal feed (specs/ical-import-hardening.md rule 26).
 *
 * The URL is operator input, but the server reads it from inside the LAN, next to the database host and
 * the other containers: a feed URL must not be able to reach a loopback, private or link-local address,
 * directly, through a name that resolves to one, or through a redirect. The body is capped so a hostile
 * or broken endpoint cannot fill the memory. `GUESTFLOW_ICAL_ALLOW_PRIVATE=1` lifts the address check
 * for a dev box whose test feed lives on localhost.
 */
const dns = require('dns').promises;
const net = require('net');

const MAX_FEED_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 3;

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

function isPrivateAddress(address) {
  const family = net.isIP(address);
  if (family === 4) return isPrivateIpv4(address.split('.').map(Number));
  if (family === 6) {
    const lower = address.toLowerCase();
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIpv4(mapped[1].split('.').map(Number));
    return lower === '::' || lower === '::1' || /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower);
  }
  return false;
}

async function assertPublicHost(hostname, { lookup = (host) => dns.lookup(host, { all: true }), env = process.env } = {}) {
  if (env.GUESTFLOW_ICAL_ALLOW_PRIVATE === '1') return;
  const host = hostname.replace(/^\[|\]$/g, '');
  const refuse = () => new FeedFetchError('Adresse du flux non autorisée (réseau privé).');
  if (net.isIP(host)) {
    if (isPrivateAddress(host)) throw refuse();
    return;
  }
  if (host.toLowerCase() === 'localhost') throw refuse();
  let records;
  try {
    records = await lookup(host);
  } catch {
    return;
  }
  if ((records || []).some((r) => isPrivateAddress(r.address))) throw refuse();
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
 * GET `url`, following at most MAX_REDIRECTS redirects, each hop checked. Resolves to the final
 * response; the caller reads the body with `readCapped`.
 */
async function fetchPublic(url, { signal, fetchImpl = (...args) => fetch(...args), lookup, env } = {}) {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    let parsed;
    try { parsed = new URL(current); } catch { throw new FeedFetchError('Adresse du flux invalide.'); }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new FeedFetchError('Adresse du flux invalide.');
    await assertPublicHost(parsed.hostname, { lookup, env });
    const response = await fetchImpl(current, { method: 'GET', signal, redirect: 'manual' });
    const location = response.status >= 300 && response.status < 400 && response.headers && response.headers.get && response.headers.get('location');
    if (!location) return response;
    current = new URL(location, current).toString();
  }
  throw new FeedFetchError('Trop de redirections.');
}

module.exports = { fetchPublic, readCapped, assertPublicHost, isPrivateAddress, MAX_FEED_BYTES, FeedFetchError };
