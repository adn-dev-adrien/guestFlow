/**
 * What a support session may not do (specs/hosting-h2-account-security.md rules 15, 18), judged on
 * the path Express will actually route.
 *
 * Express matches routes case-insensitively and ignores a trailing slash, so `/api/SUPPORT-ACCESS/3/decide/`
 * reaches the same handler as `/api/support-access/3/decide`. Every comparison here runs on
 * `normalizePath`: lower case, `//` collapsed, no trailing slash.
 *
 * Forbidden to a support session:
 * - deciding or revoking its own access, the account it borrows (password, second step, profile);
 * - rule 18: any write under `/api/users`, and the settings that hold credentials or secrets — the
 *   SMTP connection and the address links point to, a plugin setting declared `secret`, the Google
 *   connection, the Qonto credentials, the Neat credentials.
 */

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function normalizePath(raw) {
  const collapsed = String(raw || '/').toLowerCase().replace(/\/{2,}/g, '/').replace(/\/+$/, '');
  return collapsed || '/';
}

const isRead = (method) => READ_METHODS.has(String(method || '').toUpperCase());
const under = (path, prefix) => path === prefix || path.startsWith(`${prefix}/`);
const hasAnyKey = (obj, keys) => Boolean(obj && typeof obj === 'object' && keys.some((k) => Object.prototype.hasOwnProperty.call(obj, k)));

// The SMTP group's fields that carry the connection or where the account emails point.
const SMTP_CREDENTIAL_KEYS = ['host', 'secure', 'username', 'password', 'publicUrl'];
const NEAT_CREDENTIAL_KEYS = ['clientId', 'clientSecret', 'environment'];

function defaultIsSecretSetting(pluginId, key) {
  const record = require('../plugins/sdk/registry').get(pluginId);
  return Boolean(record && record.settings.some((s) => s.key === key && s.secret));
}

// → 'account' (rule 15: the access itself and the borrowed account), 'credentials' (rule 18), or null.
function forbiddenReason(method, rawPath, body = {}, { isSecretSetting = defaultIsSecretSetting } = {}) {
  const path = normalizePath(rawPath);
  const read = isRead(method);

  if (path === '/auth/change-password') return 'account';
  if (under(path, '/auth/2fa') && !read) return 'account';
  if (under(path, '/support-access') && !read && path !== '/support-access/page') return 'account';

  if (under(path, '/users') && !read) return 'credentials';
  if (path === '/settings' && !read && body && hasAnyKey(body.smtp, SMTP_CREDENTIAL_KEYS)) return 'credentials';
  const pluginSettings = /^\/plugins\/([^/]+)\/settings$/.exec(path);
  if (pluginSettings && !read && body && typeof body === 'object') {
    // Plugin ids are lower-case kebab: the lower-cased path names the same plugin.
    let id;
    try { id = decodeURIComponent(pluginSettings[1]); } catch { return 'credentials'; }
    if (Object.keys(body).some((key) => isSecretSetting(id, key))) return 'credentials';
  }
  if (under(path, '/google-calendar/oauth')) return 'credentials';
  if (path === '/google-calendar/calendar' && !read) return 'credentials';
  if ((path === '/payments/qonto/credentials' || path === '/payments/qonto/connect-provider') && !read) return 'credentials';
  if (path === '/neat/settings' && !read && hasAnyKey(body, NEAT_CREDENTIAL_KEYS)) return 'credentials';
  return null;
}

module.exports = { normalizePath, forbiddenReason, isRead };
