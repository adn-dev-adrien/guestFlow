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
 *   SMTP group (and the sender name the start assistant writes), the access code and the Wi-Fi
 *   password of a property (start assistant or property page), a plugin setting declared `secret`, or `supportLocked` and changed (where a credential is
 *   sent, or what vouches for a sender: the intake plugins' IMAP host and port, sender and signing domains),
 *   rolling a plugin back or updating it to a chosen older version, the Google and Qonto OAuth connections (any
 *   method), the Qonto and Neat credentials, and uninstalling or turning off a plugin;
 * - rule 18 (widened 2026-10-28, audit M3): changing the keypad code (`company.portalCode`), the bank details
 *   printed on a devis (`company.iban`, `bic`), and the resolved booking-notification recipient or sender —
 *   through `notifications.recipientEmail` or the company email, on `PUT /settings` and `PUT /onboarding/company`;
 * - rule 23: every route a plugin declares with `ctx.secretRoutes` — it hands out, creates or rotates a
 *   secret (the Booking userscript and its key, the gate connector's keys, read in clear, the website
 *   connection key) — and reading or rotating a property's iCal export token. A plugin's route is
 *   declared once, by the plugin; the core holds no copy of it.
 */

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function normalizePath(raw) {
  const collapsed = String(raw || '/').toLowerCase().replace(/\/{2,}/g, '/').replace(/\/+$/, '');
  return collapsed || '/';
}

const isRead = (method) => READ_METHODS.has(String(method || '').toUpperCase());
const under = (path, prefix) => path === prefix || path.startsWith(`${prefix}/`);
const hasAnyKey = (obj, keys) => Boolean(obj && typeof obj === 'object' && keys.some((k) => Object.prototype.hasOwnProperty.call(obj, k)));

const NEAT_CREDENTIAL_KEYS = ['clientId', 'clientSecret', 'environment'];
const ARRIVAL_SECRET_KEYS = ['accessCode', 'wifiPassword'];

function defaultIsSecretRoute(method, path) {
  // Express answers a HEAD with the GET handler.
  const verb = String(method || '').toUpperCase() === 'HEAD' ? 'GET' : String(method || '').toUpperCase();
  return require('../plugins/sdk/registry').all().some((record) => (record.secretRoutes || [])
    .some((e) => (e.method === '*' || e.method.toUpperCase() === verb) && e.re.test(path)));
}

function defaultIsSecretSetting(pluginId, key) {
  const record = require('../plugins/sdk/registry').get(pluginId);
  return Boolean(record && record.settings.some((s) => s.key === key && s.secret));
}

// What the settings page would print or send today, to tell a change from a value sent back as it is.
function defaultCurrentSettings() {
  return require('../models/settingsModel').read();
}

// Rule 18 — the settings a support session may not change although they are not secrets in the strict
// sense: the keypad code given to guests and the bank details printed on a devis. The page sends its
// whole group on every save, so only a value that differs counts.
const GUARDED_SETTINGS = [
  { group: 'company', key: 'portalCode', column: 'portalCode', normalize: (v) => String(v ?? '').trim() },
  { group: 'company', key: 'iban', column: 'companyIban', normalize: (v) => String(v ?? '').replace(/\s+/g, '').toUpperCase() },
  { group: 'company', key: 'bic', column: 'companyBic', normalize: (v) => String(v ?? '').replace(/\s+/g, '').toUpperCase() },
];

// The addresses the settings resolve to, from the columns a body writes (settingsController and the start
// assistant's company step). The booking notifications go to `recipient`, which falls back to the sender,
// which falls back to the company email: guarding only the typed recipient left the company email open.
function identityPatch(path, body) {
  const patch = {};
  if (path === '/settings') {
    if (body.company && typeof body.company === 'object' && Object.prototype.hasOwnProperty.call(body.company, 'email')) patch.companyEmail = body.company.email;
    if (body.notifications && typeof body.notifications === 'object' && Object.prototype.hasOwnProperty.call(body.notifications, 'recipientEmail')) patch.notificationRecipientEmail = body.notifications.recipientEmail;
  } else if (path === '/onboarding/company' && Object.prototype.hasOwnProperty.call(body, 'email')) {
    patch.companyEmail = body.email;
  }
  return patch;
}

function changesGuardedSetting(path, body, currentSettings) {
  const sent = path === '/settings'
    ? GUARDED_SETTINGS.filter(({ group, key }) => body[group] && typeof body[group] === 'object'
      && Object.prototype.hasOwnProperty.call(body[group], key))
    : [];
  const patch = identityPatch(path, body);
  if (!sent.length && !Object.keys(patch).length) return false;
  const stored = currentSettings() || {};
  if (sent.some(({ group, key, column, normalize }) => normalize(body[group][key]) !== normalize(stored[column]))) return true;
  if (!Object.keys(patch).length) return false;
  const { resolveEmailIdentity } = require('./emailIdentity');
  const before = resolveEmailIdentity(stored);
  const after = resolveEmailIdentity({ ...stored, ...patch });
  const same = (x, y) => String(x).toLowerCase() === String(y).toLowerCase();
  return !same(before.recipient, after.recipient) || !same(before.fromEmail, after.fromEmail);
}

// A `supportLocked` setting is readable and its form sends every key: only a value that differs from the
// stored one (or from the default, when nothing is stored) is a change.
function defaultIsLockedChange(pluginId, key, value) {
  const record = require('../plugins/sdk/registry').get(pluginId);
  const decl = record && record.settings.find((s) => s.key === key);
  if (!decl || !decl.supportLocked) return false;
  const stored = require('../models/pluginSettingsModel').raw(pluginId, key);
  const current = stored === '' && decl.default !== undefined ? String(decl.default) : stored;
  return String(value == null ? '' : value).trim() !== current;
}

// → 'account' (rule 15: the access itself and the borrowed account), 'credentials' (rule 18), or null.
function forbiddenReason(method, rawPath, body = {}, {
  isSecretSetting = defaultIsSecretSetting, isSecretRoute = defaultIsSecretRoute, isLockedChange = defaultIsLockedChange, currentSettings = defaultCurrentSettings,
} = {}) {
  const path = normalizePath(rawPath);
  const read = isRead(method);

  if (path === '/auth/change-password') return 'account';
  if (under(path, '/auth/2fa') && !read) return 'account';
  if (under(path, '/support-access') && !read && path !== '/support-access/page') return 'account';

  if (under(path, '/users') && !read) return 'credentials';
  // The whole SMTP group: the connection, where the account emails point, and who they come from.
  if (path === '/settings' && !read && body && body.smtp !== undefined) return 'credentials';
  if ((path === '/settings' || path === '/onboarding/company') && !read && body && typeof body === 'object' && changesGuardedSetting(path, body, currentSettings)) return 'credentials';
  // The same sender name through the start assistant, and the arrival secrets a guest is given — the
  // access code and the Wi-Fi password — whichever form writes them.
  if (path === '/onboarding/emails' && !read && body && typeof body === 'object') {
    if (body.senderName !== undefined) return 'credentials';
    const list = Array.isArray(body.properties) ? body.properties : [];
    if (list.some((p) => p && ARRIVAL_SECRET_KEYS.some((k) => p[k] !== undefined && p[k] !== null && p[k] !== ''))) return 'credentials';
  }
  if (/^\/properties\/[^/]+\/arrival-facts$/.test(path) && !read && hasAnyKey(body, ARRIVAL_SECRET_KEYS)) return 'credentials';
  const pluginSettings = /^\/plugins\/([^/]+)\/settings$/.exec(path);
  if (pluginSettings && !read && body && typeof body === 'object') {
    // Plugin ids are lower-case kebab: the lower-cased path names the same plugin.
    let id;
    try { id = decodeURIComponent(pluginSettings[1]); } catch { return 'credentials'; }
    if (Object.keys(body).some((key) => isSecretSetting(id, key) || isLockedChange(id, key, body[key]))) return 'credentials';
  }
  // Any method: an OAuth « GET » stores tokens, and a clear-text secret is a read.
  if (under(path, '/google-calendar/oauth')) return 'credentials';
  if (['/payments/qonto/authorize', '/payments/qonto/callback', '/payments/qonto/refresh-connection'].includes(path)) return 'credentials';
  if (isSecretRoute(method, path)) return 'credentials';
  // Rotating a property's iCal export token breaks the feed every platform imports; reading it hands
  // out the feed's address in clear, and creates the token on first read.
  if (/^\/ical\/regenerate-token\/[^/]+$/.test(path) && !read) return 'credentials';
  if (/^\/ical\/token\/[^/]+$/.test(path)) return 'credentials';
  // A rollback, or an update to an older version, brings back code from before a fix: a support session
  // cannot undo what a security release changed.
  if (/^\/plugins\/[^/]+\/rollback$/.test(path) && !read) return 'credentials';
  if (/^\/plugins\/[^/]+\/update$/.test(path) && !read && body && typeof body === 'object' && body.version !== undefined && body.version !== null && body.version !== '') return 'credentials';
  // Uninstalling or turning off a plugin erases or strands its stored credentials.
  if (/^\/plugins\/[^/]+(\/deactivate)?$/.test(path) && (method === 'DELETE' || /\/deactivate$/.test(path)) && !read) return 'credentials';
  if (path === '/google-calendar/calendar' && !read) return 'credentials';
  if ((path === '/payments/qonto/credentials' || path === '/payments/qonto/connect-provider') && !read) return 'credentials';
  if (path === '/neat/settings' && !read && hasAnyKey(body, NEAT_CREDENTIAL_KEYS)) return 'credentials';
  return null;
}

module.exports = { normalizePath, forbiddenReason, isRead };
