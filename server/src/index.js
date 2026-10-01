// FIRST, before anything reads the clock: the schedulers compare operator-entered wall-clock times
// (a 16:00 check-in, the 08:00 e-mail pass) against this process's LOCAL time, so the process must
// run in the accommodations' zone — the production host's clock is UTC (specs/server-timezone.md).
const { applyServerTimezone } = require('./utils/serverTimezone');
const serverTimezone = applyServerTimezone().timezone;

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs');
const session = require('express-session');
const { startScheduledTasks } = require('./scheduledTasks');
const { loadLocalEnv, getOrCreateSecret } = require('./utils/localEnv');
const requireAuth = require('./middleware/requireAuth');
const enforceRoleAccess = require('./middleware/enforceRoleAccess');
const requirePlugin = require('./middleware/requirePlugin');
const { enforceSubscription } = require('./middleware/enforceSubscription');
const PLUGINS = require('./constants/plugins');
const { apiLimiter, loginLimiter } = require('./middleware/rateLimiters');
const {
  shouldEnforceHttps,
  buildHelmetOptions,
  buildSessionCookieOptions,
  PERMISSIONS_POLICY_VALUE,
} = require('./utils/securityConfig');
const { buildServer } = require('./utils/httpsBootstrap');

loadLocalEnv();
const SqliteStore = require('better-sqlite3-session-store')(session);
const db = require('./database');
// specs/plugins-phase-1-sdk.md — plugin modules declare their routes, tables, jobs and handlers here;
// a module that throws is marked failed and the boot goes on (rule 4).
const pluginLoader = require('./plugins/loader');
pluginLoader.registerAll({ db });

function logErrorMarker(message) {
  const timestamp = new Date().toISOString();
  console.error(`[GuestFlow][${timestamp}][pid:${process.pid}] ${message}`);
}

logErrorMarker(`=== SERVER BOOT START === (timezone ${serverTimezone}, local time ${new Date().toString()})`);

const commitSha = String(
  process.env.APP_COMMIT_SHA
    || process.env.COMMIT_SHA
    || process.env.GITHUB_SHA
    || ''
).trim();
const commitShaShort = commitSha ? commitSha.slice(0, 7) : null;

const app = express();
// `trust proxy` MUST match the real deployment: today the Node app is exposed directly (its own TLS,
// no reverse proxy), so we trust NO forwarded hop — otherwise any direct caller could spoof
// X-Forwarded-For and defeat the IP rate limiters (specs/public-online-payment.md §7). When a reverse
// proxy is put in front (WordPress prod), set TRUST_PROXY_HOPS to the exact number of trusted hops.
const TRUST_PROXY_HOPS = process.env.TRUST_PROXY_HOPS;
app.set('trust proxy', TRUST_PROXY_HOPS != null && TRUST_PROXY_HOPS !== '' ? Number(TRUST_PROXY_HOPS) : false);

// HTTP security headers + a CSP tuned for the SPA (MUI/emotion inject inline styles; CRA is built
// with INLINE_RUNTIME_CHUNK=false so script-src can stay 'self').
//
// Two independent switches drive the policy (see utils/securityConfig.js + the regression test
// alongside it for the full rule table). Conflating them in earlier code is exactly what broke the
// first Raspberry Pi deploy (`NODE_ENV=production` without TLS at the edge → Safari upgraded every
// asset URL to https:// → "Une erreur TLS a provoqué l'échec de la connexion sécurisée"):
//   NODE_ENV=production   → run as prod (full CSP, JSON errors, prod-only branches elsewhere)
//   HTTPS_ENABLED=true    → the network edge actually serves HTTPS → enable HSTS + CSP's
//                            upgrade-insecure-requests + Secure cookies.
// HTTPS_ENABLED must be explicitly turned on once TLS is in front of the app; leaving it off on a
// prod deploy is safe (the app stays usable over plain HTTP).
const isProduction = process.env.NODE_ENV === 'production';
const httpsEnabled = shouldEnforceHttps(process.env);
app.use(helmet(buildHelmetOptions({ isProduction, httpsEnabled })));

// Helmet doesn't ship Permissions-Policy (it's a newer header that superseded Feature-Policy).
// We set it ourselves: deny camera/mic/geoloc/payment/etc. to every origin. The app doesn't
// use any of these and the header tells the browser to refuse them even if a future XSS or
// embedded iframe ever asks. Spotted in the 2026-06-01 security audit (finding L1).
app.use((req, res, next) => {
  res.setHeader('Permissions-Policy', PERMISSIONS_POLICY_VALUE);
  next();
});

// Strict CORS allowlist with credentials (session cookie). Cross-origin only matters in dev
// (client :3000 → API :4000); prod is same-origin. Configure prod origins via CORS_ORIGINS.
const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3000')
  .split(',').map((s) => s.trim()).filter(Boolean);
app.use(cors({ origin: allowedOrigins, credentials: true }));
// Explicit JSON body size cap. Default Express limit is 100 KB which is plenty for our CRUD
// payloads (the biggest user-driven object is a reservation with options + notes, well under
// 50 KB). Pinning the limit ourselves keeps a runaway client (or an attacker who got past
// auth) from eating the Pi's RAM via a multi-MB body. 256 KB leaves headroom for future
// growth without inviting abuse. Spotted in the 2026-06-01 security audit (finding M1).
// Capture the raw request bytes so a plugin's webhook (Qonto) can verify its HMAC signature against the
// exact payload (the parsed body can't be re-serialised byte-for-byte). specs/public-online-payment.md §3bis.
app.use(express.json({
  limit: '256kb',
  verify: (req, _res, buf) => { req.rawBody = buf; },
}));

// Server-side sessions persisted in SQLite (survive restarts). Cookie is httpOnly + sameSite + Secure
// when HTTPS is actually available — a Secure cookie over plain HTTP is silently dropped by the
// browser, which would make every login round-trip fail without an obvious error.
app.use(session({
  store: new SqliteStore({ client: db, expired: { clear: true, intervalMs: 15 * 60 * 1000 } }),
  secret: getOrCreateSecret('GUESTFLOW_SESSION_SECRET', 32),
  name: 'guestflow.sid',
  resave: false,
  saveUninitialized: false,
  rolling: true, // sliding 30-day expiration
  cookie: buildSessionCookieOptions({ httpsEnabled }),
}));

// One-time, idempotent: encrypt any legacy cleartext Google credentials at rest.
try {
  require('./models/settingsModel').migrateEncryption();
} catch (err) {
  logErrorMarker(`Encryption migration failed: ${err.message}`);
}

// VAPID keypair for Web Push (specs/pwa-push-notifications.md). Auto-generated + persisted to
// server/.env.local on first boot; the private key configures web-push, the public key is exposed
// to the client for the push subscription. Never logged.
require('./utils/vapid').ensureVapid();

// Serve uploads (public static images)
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// Public API (specs/public-api.md) — `/public/v1/*`, a SEPARATE tree from the internal `/api/*`
// admin API: it never passes through the `/api` session guard below, so that guard can neither
// expose nor block it. Every prefix belongs to a plugin module, each with its own key: the WordPress
// site's (website-booking) and the Sowel connector's (gate-access, /public/v1/gate). Each answers 404
// PLUGIN_INACTIVE while its plugin is off (specs/plugins-phase-0-foundation.md rule 15): the
// WordPress site then shows its "unavailable" state, and Sowel stops receiving keys.
pluginLoader.mountPublic(app);
// No tree catches /public/v1 any more: a path no plugin owns gets a JSON 404, never the SPA.
app.use('/public/v1', (req, res) => require('./controllers/public/publicHttp').fail(res, 404, 'NOT_FOUND', 'Ressource introuvable.'));

// Guest email preferences (specs/guest-email-sequence.md §4.3) — the unsubscribe link of the season
// emails. Public by nature (a guest opens it from an email): no session, no API key, own limiter.
app.use('/preferences', require('./routes/emailPreferences'));

// Global API rate limit (per IP), except the public iCal export feed (polled by external services).
app.use('/api', (req, res, next) => {
  if (req.method === 'GET' && /^\/ical\/export\//.test(req.path)) return next();
  return apiLimiter(req, res, next);
});

// Stricter brute-force limit on the login route.
app.use('/api/auth/login', loginLimiter);

// Auth routes are public (login/me) or session-checked in the controller (logout/change-password),
// so they are mounted OUTSIDE the auth guard below.
app.use('/api/auth', require('./routes/auth'));

// Fail-closed guard: every other /api route requires a full (non-restricted) session, except the
// public iCal export feed and the version probe.
app.use('/api', (req, res, next) => {
  if (req.path === '/version') return next();
  if (req.method === 'GET' && /^\/ical\/export\//.test(req.path)) return next();
  // A plugin's webhook is a server-to-server call (no session) the plugin authenticates itself — the
  // Qonto one by its HMAC signature (specs/plugins-phase-3a-online-payment.md rule 12).
  if (pluginLoader.isWebhook(req.method, req.path)) return next();
  return requireAuth(req, res, next);
});

// Role-based access (runs after auth): the accountant and reception roles reach only their allowlists
// (core entries + those of live plugins) + self routes; every other business endpoint is admin-only.
app.use('/api', (req, res, next) => {
  if (req.path === '/version') return next();
  if (req.method === 'GET' && /^\/ical\/export\//.test(req.path)) return next();
  if (pluginLoader.isWebhook(req.method, req.path)) return next();
  if (!req.user) return next(); // requireAuth above already 401'd if no session
  return enforceRoleAccess(req, res, next);
});

// An unpaid instance is read-only (specs/control-plane-plans-and-access.md rule 14). Inert on an
// install that has no licence and is not managed by the hosting (rule 29).
app.use('/api', enforceSubscription());

// Routes
app.use('/api/clients', require('./routes/clients'));
app.use('/api/properties', require('./routes/properties'));
app.use('/api/options', require('./routes/options'));
app.use('/api/resources', require('./routes/resources'));
app.use('/api/resource-bookings', requirePlugin(PLUGINS.HOURLY_RESOURCES), require('./routes/resourceBookings'));
app.use('/api/reservations', require('./routes/reservations'));
app.use('/api/platforms', require('./routes/platforms'));
app.use('/api/finance', require('./routes/finance'));
app.use('/api/public-holidays', require('./routes/publicHolidays'));
app.use('/api/calendar-notes', require('./routes/calendarNotes'));
app.use('/api/ical', require('./routes/ical'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/push', require('./routes/push'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/translations', require('./routes/translations'));
app.use('/api/devis', require('./routes/devis'));
app.use('/api/establishment-closures', require('./routes/establishmentClosures'));
app.use('/api/users', require('./routes/users'));
app.use('/api/accounting', require('./routes/accounting'));
app.use('/api/planning', require('./routes/planning'));
app.use('/api/dashboard', require('./routes/dashboard'));
// specs/email-automation.md — template library + send / preview / pending / acknowledge / history.
app.use('/api/email-templates', require('./routes/emailTemplates'));
app.use('/api/emails',          require('./routes/emails'));
app.use('/api/email-sequence',  require('./routes/emailSequence'));
// specs/self-update-and-releases.md — version probe + self-update control. Admin-only: the role
// guard above is deny-by-default for every non-admin role, so no allowlist entry is needed.
app.use('/api/system', require('./routes/system'));
// specs/neat-cancellation-insurance-subscription.md — Neat connection, mapping, retry/void.
// Admin-only through the same deny-by-default role guard.
app.use('/api/neat', requirePlugin(PLUGINS.NEAT), require('./routes/neat'));
// specs/terms-acceptance-record.md — the CGV the operator writes and publishes. Admin-only.
app.use('/api/terms', require('./routes/terms'));
// specs/plugins-phase-0-foundation.md — the Plugins page. Admin-only through the same role guard.
app.use('/api/plugins', require('./routes/plugins'));
// specs/control-plane-plans-and-access.md — the subscription banner. Admin-only through the role guard.
app.use('/api/subscription', require('./routes/subscription'));
// The routes of plugin modules (specs/plugins-phase-1-sdk.md rule 5): same URLs as before the move,
// each behind requirePlugin.
pluginLoader.mountApi(app);

app.get('/api/version', (req, res) => {
  res.json({
    env: process.env.NODE_ENV || 'development',
    commitSha: commitSha || null,
    commitShaShort,
    startedAt: new Date().toISOString(),
  });
});

// Dynamic favicon: when the admin has uploaded a company logo via Settings, serve that as the
// favicon on `/favicon.ico` and `/favicon.svg`. Falls through (next()) to the static middleware
// below, which serves the bundled defaults when no logo is configured. Must be mounted BEFORE
// `express.static(clientBuildDir)` to win the route race.
const settingsModelForFavicon = require('./models/settingsModel');
const { uploadsDir: faviconUploadsDir } = require('./middleware/multerLogoUpload');
const { buildFaviconHandler } = require('./middleware/dynamicFavicon');
const dynamicFavicon = buildFaviconHandler({
  settingsModel: settingsModelForFavicon,
  uploadsDir: faviconUploadsDir,
});
app.get(['/favicon.ico', '/favicon.svg'], dynamicFavicon);

// In production, serve the built React app for non-API routes.
const clientBuildDir = path.join(__dirname, '..', '..', 'client', 'build');
const clientIndexPath = path.join(clientBuildDir, 'index.html');
if (fs.existsSync(clientIndexPath)) {
  app.use(express.static(clientBuildDir));
  app.get(/^\/(?!api|uploads).*/, (req, res) => {
    res.sendFile(clientIndexPath);
  });
}

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'API route not found' });
});

// Global error handler — LAST, and four arguments (that signature is what makes it an error
// middleware). Added with express 5 (specs/express-5-upgrade.md §3 rule 4): v5 forwards a REJECTED
// promise from an async handler here, where v4 let it escape as an `unhandledRejection` and left the
// request hanging with no response at all. Without this, such an error would now get express's
// default HTML handler on a JSON API.
//
// The message is deliberately NOT sent to the client: an unexpected error can carry a file path, a
// SQL fragment or a token. It is logged server-side and the caller gets a stable, opaque shape.
// eslint-disable-next-line no-unused-vars -- `next` is required for express to see this as an error handler
app.use((err, req, res, next) => {
  console.error(`[unhandled] ${req.method} ${req.originalUrl}`, err);
  if (res.headersSent) return;
  res.status(err && Number.isInteger(err.status) && err.status >= 400 && err.status < 600 ? err.status : 500)
    .json({ error: 'Erreur interne du serveur' });
});

const PORT = process.env.PORT || 4000;
// Picks plain HTTP or HTTPS based on HTTPS_ENABLED. When HTTPS is on but the cert/key are
// missing, `buildServer` throws — better to refuse to boot than to silently downgrade and leak
// a Secure session cookie over plain transport. See utils/httpsBootstrap.js for the rules.
let serverHandle;
let serverProtocol = 'http';
try {
  const built = buildServer({ httpsEnabled, app });
  serverHandle = built.server;
  serverProtocol = built.protocol;
} catch (err) {
  logErrorMarker(`Boot failed: ${err.message}`);
  process.exit(1);
}
const server = serverHandle.listen(PORT, () => {
  // Single boot banner — env, address, DB path. The only line a healthy steady-state boot prints
  // unless a migration / seed actually changed something. Goes to stdout (regular logs); the
  // BOOT START / BOOT COMPLETE markers stay on stderr via logErrorMarker for ops grep.
  const env = process.env.NODE_ENV || 'development';
  const commitSuffix = commitShaShort ? `, commit=${commitShaShort}` : '';
  console.log(`[boot] GuestFlow API on ${serverProtocol}://localhost:${PORT} (NODE_ENV=${env}, DB=${db.dbPath}${commitSuffix})`);
  logErrorMarker(`=== SERVER BOOT COMPLETE (${serverProtocol}, port ${PORT}) ===`);

  // specs/self-update-and-releases.md §3.E rule 30 — stamp which version actually came up (the swap
  // helper reads this back to prove the update took effect), close out a finished update and prune
  // old releases. Must run before the scheduled tasks so the first version check sees clean state.
  require('./controllers/systemController').initOnBoot();

  // Start scheduled tasks (like iCal auto-sync)
  startScheduledTasks();
  pluginLoader.startJobs();
});

function shutdown(signal) {
  logErrorMarker(`=== SERVER SHUTDOWN (${signal}) ===`);
  console.log(`Received ${signal}, shutting down GuestFlow API...`);
  server.close(() => {
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('uncaughtException', (error) => {
  logErrorMarker(`UNCAUGHT EXCEPTION: ${error?.message || error}`);
  console.error(error);
});

process.on('unhandledRejection', (reason) => {
  logErrorMarker(`UNHANDLED REJECTION: ${reason?.message || reason}`);
  console.error(reason);
});

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
