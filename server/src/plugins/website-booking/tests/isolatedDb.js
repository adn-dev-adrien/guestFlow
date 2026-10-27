/**
 * Points the database at a throw-away file before anything opens it. Required FIRST by every test of
 * this folder whose mocks still let the SDK load the real `database.js`, so no run ever creates or
 * touches the checkout's own `guestflow.db` (fixed at the 2026-10-27 audit).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gf-website-booking-')), 'guestflow.db');
