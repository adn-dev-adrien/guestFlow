#!/usr/bin/env node
/**
 * Simulate the guest email sequence against any GuestFlow database — nothing is sent, nothing is
 * written (specs/guest-email-sequence.md rules 31-32).
 *
 *   SIMULATION_DB_PATH=/path/to/copy.db node scripts/simulate-guest-email-sequence.mjs --from 2026-09-01 --to 2027-01-31
 *   … [--start 2026-10-01]   the day automatic sending would be turned on (default: the stored one, else today)
 *   … [--json]               machine-readable output
 *
 * The target is opened READ-ONLY and is never GuestFlow's own database handle: `DB_PATH` is pointed at
 * an in-memory database before any server module loads, so a module that opens the default database
 * (and runs its migrations) can never reach the target. Safe on a copy of production that predates the
 * sequence — the ledger then simply reads as empty.
 */

import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const target = process.env.SIMULATION_DB_PATH;
process.env.DB_PATH = ':memory:';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, '..', 'server', 'src', 'index.js'));
const Database = require('better-sqlite3');
const { simulate } = require('./utils/guestEmailSequenceRunner');

// The in-memory stand-in announces its own seeds and migrations; they are noise here.
function quietly(load) {
  const log = console.log;
  console.log = () => {};
  try { return load(); } finally { console.log = log; }
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

if (!target) {
  console.error('SIMULATION_DB_PATH is required (point it at a COPY of the database).');
  process.exit(2);
}
const today = new Date().toISOString().slice(0, 10);
const from = arg('from') || today;
const to = arg('to') || from;

const database = new Database(target, { readonly: true, fileMustExist: true });
const hasTable = (name) => Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
const settingsRow = database.prepare('SELECT * FROM app_settings WHERE id = 1').get() || {};
const settings = { ...settingsRow, guestSequenceStartDate: arg('start') || settingsRow.guestSequenceStartDate || null };
const settingsModel = {
  read: () => settings,
  emailAutoSendEnabled: () => Number(settings.emailAutoSendEnabled) === 1,
};

const ledger = hasTable('guest_email_sends')
  ? quietly(() => require('./models/guestEmailSendsModel')).buildModel(database)
  : { findByKeys: () => new Map(), countPostStayContacts: () => 0 };

const result = simulate({ database, ledger, settingsModel }, { from, to, today });

if (process.argv.includes('--json')) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} else {
  const start = result.startDate || `${result.assumedStartDate} (supposée : envoi pas encore activé)`;
  console.log(`Simulation du ${from} au ${to} — séquence active depuis le ${start}`);
  const { counts } = result;
  console.log(`Part : ${counts.send} · ne part pas : ${counts.blocked} · déjà envoyé : ${counts.alreadySent} · à vérifier : ${counts.toCheck}\n`);
  const label = { send: 'PART', blocked: 'non', 'already-sent': 'déjà', 'to-check': 'VÉRIF' };
  for (const r of result.rows) {
    console.log([
      r.date, (label[r.status] || r.status).padEnd(5), r.mailLabel.padEnd(20),
      (r.clientName || '—').padEnd(24), (r.propertyName || '').padEnd(16), r.reason,
    ].join('  '));
  }
}
database.close();
