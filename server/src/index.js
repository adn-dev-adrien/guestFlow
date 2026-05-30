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
const { apiLimiter, loginLimiter } = require('./middleware/rateLimiters');
const {
  shouldEnforceHttps,
  buildHelmetOptions,
  buildSessionCookieOptions,
} = require('./utils/securityConfig');
const { buildServer } = require('./utils/httpsBootstrap');

loadLocalEnv();
const SqliteStore = require('better-sqlite3-session-store')(session);
const db = require('./database');

function logErrorMarker(message) {
  const timestamp = new Date().toISOString();
  console.error(`[GuestFlow][${timestamp}][pid:${process.pid}] ${message}`);
}

logErrorMarker('=== SERVER BOOT START ===');

const commitSha = String(
  process.env.APP_COMMIT_SHA
    || process.env.COMMIT_SHA
    || process.env.GITHUB_SHA
    || ''
).trim();
const commitShaShort = commitSha ? commitSha.slice(0, 7) : null;

const app = express();
app.set('trust proxy', 1); // honor X-Forwarded-* behind the prod reverse proxy (secure cookies)

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

// Strict CORS allowlist with credentials (session cookie). Cross-origin only matters in dev
// (client :3000 → API :4000); prod is same-origin. Configure prod origins via CORS_ORIGINS.
const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3000')
  .split(',').map((s) => s.trim()).filter(Boolean);
app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json());

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

// Serve uploads (public static images)
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

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
  return requireAuth(req, res, next);
});

// Role-based access (runs after auth): accountants reach only `/api/accounting/*` (GET) + self routes;
// every other business endpoint is admin-only.
app.use('/api', (req, res, next) => {
  if (req.path === '/version') return next();
  if (req.method === 'GET' && /^\/ical\/export\//.test(req.path)) return next();
  if (!req.user) return next(); // requireAuth above already 401'd if no session
  return enforceRoleAccess(req, res, next);
});

// Routes
app.use('/api/clients', require('./routes/clients'));
app.use('/api/properties', require('./routes/properties'));
app.use('/api/options', require('./routes/options'));
app.use('/api/resources', require('./routes/resources'));
app.use('/api/resource-bookings', require('./routes/resourceBookings'));
app.use('/api/reservations', require('./routes/reservations'));
app.use('/api/finance', require('./routes/finance'));
app.use('/api/school-holidays', require('./routes/schoolHolidays'));
app.use('/api/public-holidays', require('./routes/publicHolidays'));
app.use('/api/calendar-notes', require('./routes/calendarNotes'));
app.use('/api/ical', require('./routes/ical'));
app.use('/api/google-calendar', require('./routes/googleCalendar'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/devis', require('./routes/devis'));
app.use('/api/establishment-closures', require('./routes/establishmentClosures'));
app.use('/api/users', require('./routes/users'));
app.use('/api/accounting', require('./routes/accounting'));

app.get('/api/version', (req, res) => {
  res.json({
    env: process.env.NODE_ENV || 'development',
    commitSha: commitSha || null,
    commitShaShort,
    startedAt: new Date().toISOString(),
  });
});

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
  if (built.tlsInfo) {
    console.log(`TLS material loaded — cert: ${built.tlsInfo.certPath}, key: ${built.tlsInfo.keyPath}`);
  }
} catch (err) {
  logErrorMarker(`Boot failed: ${err.message}`);
  process.exit(1);
}
const server = serverHandle.listen(PORT, () => {
  console.log(`GuestFlow API running on ${serverProtocol}://localhost:${PORT}`);
  logErrorMarker(`=== SERVER BOOT COMPLETE (${serverProtocol}, port ${PORT}) ===`);

  // Start scheduled tasks (like iCal auto-sync)
  startScheduledTasks();
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
