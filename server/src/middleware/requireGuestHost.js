// Host separation between the guest page and the admin app (specs/guest-gate-access.md §4.1).
//
// The guest page lives on its own hostname — `guest.domainesolio.com` — and that is not cosmetic:
// it keeps an unauthenticated public page off the origin that holds the operator's session. The
// separation is only real if it is enforced on the server, in both directions:
//
//   - on the guest host, the admin API and the admin SPA DO NOT EXIST (404, not 403 — a 403 would
//     confirm there is something there);
//   - on the admin host, `/gate/v1/*` does not exist either.
//
// Fail-closed: with no GUEST_HOST configured, no host is the guest host, so the guest tree answers
// 404 everywhere and the admin app is untouched. A deployment that forgets the variable loses the
// new feature; it never accidentally serves the admin API on a public name.

function parseHosts(value) {
  return String(value || '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

/** The hostnames that serve the guest page. `GUEST_HOST` accepts a comma-separated list. */
function guestHosts(env = process.env) {
  return parseHosts(env.GUEST_HOST);
}

/**
 * Compares a request's Host header to the configured list. Both the bare hostname and
 * `hostname:port` forms match, so `guest.localhost:4000` in dev and `guest.domainesolio.com`
 * behind Caddy both work without a second variable.
 */
function isGuestHost(req, env = process.env) {
  const hosts = guestHosts(env);
  if (!hosts.length) return false;
  const header = String((req.headers && req.headers.host) || '').toLowerCase();
  if (!header) return false;
  const bare = header.split(':')[0];
  return hosts.includes(header) || hosts.includes(bare);
}

/** The public origin of the guest page, for the links that go in emails and QR codes. */
function guestBaseUrl(env = process.env) {
  const configured = String(env.GUEST_BASE_URL || '').trim().replace(/\/+$/, '');
  if (configured) return configured;
  const [first] = guestHosts(env);
  if (!first) return '';
  const scheme = first.startsWith('localhost') || first.includes('.localhost') ? 'http' : 'https';
  return `${scheme}://${first}`;
}

/**
 * Mounted before everything else. It only tags the request; the two trees then declare what they
 * accept. Kept as a tag rather than a wall so the 404s are decided by the routers, where a reader
 * can see which paths exist on which host.
 */
function tagGuestHost(env = process.env) {
  return function tagGuestHostMiddleware(req, res, next) {
    req.isGuestHost = isGuestHost(req, env);
    next();
  };
}

/** Guard for the guest tree: it exists only on the guest host. */
function guestTreeOnly(req, res, next) {
  if (!req.isGuestHost) return res.status(404).json({ error: 'NOT_FOUND' });
  return next();
}

/** Guard for everything else: the admin surfaces do not exist on the guest host. */
function adminTreeOnly(req, res, next) {
  if (req.isGuestHost) return res.status(404).json({ error: 'NOT_FOUND' });
  return next();
}

module.exports = {
  parseHosts,
  guestHosts,
  isGuestHost,
  guestBaseUrl,
  tagGuestHost,
  guestTreeOnly,
  adminTreeOnly,
};
