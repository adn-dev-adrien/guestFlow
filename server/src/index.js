const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const session = require('express-session');
const { startScheduledTasks } = require('./scheduledTasks');
const { loadLocalEnv, getOrCreateSecret } = require('./utils/localEnv');
const requireAuth = require('./middleware/requireAuth');

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

// Credentialed CORS so the session cookie works cross-origin in dev (client :3000 → API :4000).
// Full CORS lockdown is Bloc S PR 2.
const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3000')
  .split(',').map((s) => s.trim()).filter(Boolean);
app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json());

// Server-side sessions persisted in SQLite (survive restarts). Cookie is httpOnly + sameSite; secure in prod.
app.use(session({
  store: new SqliteStore({ client: db, expired: { clear: true, intervalMs: 15 * 60 * 1000 } }),
  secret: getOrCreateSecret('GUESTFLOW_SESSION_SECRET', 32),
  name: 'guestflow.sid',
  resave: false,
  saveUninitialized: false,
  rolling: true, // sliding 30-day expiration
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  },
}));

// One-time, idempotent: encrypt any legacy cleartext Google credentials at rest.
try {
  require('./models/settingsModel').migrateEncryption();
} catch (err) {
  logErrorMarker(`Encryption migration failed: ${err.message}`);
}

// Serve uploads (public static images)
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// Minimal in-memory login throttle (proper rate limiting comes in Bloc S PR 2).
const loginAttempts = new Map();
app.use('/api/auth/login', (req, res, next) => {
  const now = Date.now();
  const windowMs = 15 * 60 * 1000;
  const ip = req.ip || 'unknown';
  const entry = loginAttempts.get(ip) || { count: 0, start: now };
  if (now - entry.start > windowMs) { entry.count = 0; entry.start = now; }
  entry.count += 1;
  loginAttempts.set(ip, entry);
  if (entry.count > 20) return res.status(429).json({ error: 'TOO_MANY_ATTEMPTS' });
  return next();
});

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

// Routes
app.use('/api/clients', require('./routes/clients'));
app.use('/api/properties', require('./routes/properties'));
app.use('/api/options', require('./routes/options'));
app.use('/api/resources', require('./routes/resources'));
app.use('/api/resource-bookings', require('./routes/resourceBookings'));
app.use('/api/reservations', require('./routes/reservations'));
app.use('/api/finance', require('./routes/finance'));
app.use('/api/school-holidays', require('./routes/schoolHolidays'));
app.use('/api/calendar-notes', require('./routes/calendarNotes'));
app.use('/api/ical', require('./routes/ical'));
app.use('/api/google-calendar', require('./routes/googleCalendar'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/devis', require('./routes/devis'));
app.use('/api/establishment-closures', require('./routes/establishmentClosures'));

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
const server = app.listen(PORT, () => {
  console.log(`GuestFlow API running on http://localhost:${PORT}`);
  logErrorMarker(`=== SERVER BOOT COMPLETE (port ${PORT}) ===`);
  
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
