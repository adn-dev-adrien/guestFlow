const net = require('net');

/**
 * The website visitor behind the WordPress proxy (specs/terms-acceptance-record.md §3.6).
 *
 * The proxy calls GuestFlow server-to-server, so `req.ip` is the WordPress host for every visitor. It
 * relays the real visitor in three headers, trusted ONLY because this middleware runs after
 * requirePublicApiKey: an unauthenticated caller never reaches it and cannot pick its own identity.
 *
 * Sets `req.visitor = { ip, userAgent, pluginVersion }` (each '' when absent or malformed).
 */

const MAX_USER_AGENT = 512;
const PLUGIN_VERSION_RE = /^\d+\.\d+\.\d+$/;

function readVisitor(req) {
  const ip = String(req.get('x-guestflow-visitor-ip') || '').trim();
  const userAgent = String(req.get('x-guestflow-visitor-ua') || '').trim().slice(0, MAX_USER_AGENT);
  const pluginVersion = String(req.get('x-guestflow-plugin') || '').trim();
  return {
    ip: net.isIP(ip) ? ip : '',
    userAgent,
    pluginVersion: PLUGIN_VERSION_RE.test(pluginVersion) ? pluginVersion : '',
  };
}

function visitorContext(req, res, next) {
  req.visitor = readVisitor(req);
  next();
}

module.exports = visitorContext;
module.exports.readVisitor = readVisitor;
