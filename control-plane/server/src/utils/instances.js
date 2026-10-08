/**
 * Where the console finds a customer's instance: `<CP_INSTANCES_ROOT>/<slug>/data/guestflow.db`
 * (phase H will create that layout; until then the operator does). The console only ever reads an
 * instance's database, opened read-only — its installed plugins and its active accounts — and
 * writes nothing there but the licence.
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DB_FILE = 'guestflow.db';

function createInstances({ root }) {
  const base = path.resolve(root || '.');

  function dirOf(slug) {
    if (!/^[a-z0-9-]{3,30}$/.test(String(slug))) throw new Error(`invalid slug: ${slug}`);
    return path.join(base, slug);
  }

  const dataDir = (slug) => path.join(dirOf(slug), 'data');
  const dbPath = (slug) => path.join(dataDir(slug), DB_FILE);

  return {
    root: base,
    dirOf,
    dataDir,
    dbPath,
    hasDataDir: (slug) => fs.existsSync(dataDir(slug)),
    hasDatabase: (slug) => fs.existsSync(dbPath(slug)),

    // What is installed on the instance: the rows of its `plugins` table (specs/plugins-phase-0).
    // null when the instance cannot be read, so callers can say « inconnu » rather than « aucun ».
    readFacts(slug) {
      let db;
      try {
        db = new Database(dbPath(slug), { readonly: true, fileMustExist: true });
        const rows = db.prepare('SELECT id, enabled FROM plugins').all();
        return { installed: rows.map((r) => r.id), active: rows.filter((r) => r.enabled).map((r) => r.id) };
      } catch {
        return null;
      } finally {
        if (db) db.close();
      }
    },

    // The support access of the instance (specs/hosting-h2-account-security.md §4.2): its pending
    // request and its open access, read like the rest. null when it cannot be read (an instance from
    // before H2 has no such table).
    readSupportAccess(slug, nowIso) {
      let db;
      try {
        db = new Database(dbPath(slug), { readonly: true, fileMustExist: true });
        const pending = db.prepare('SELECT id, requestId, reason, requestedAt FROM support_access WHERE decision IS NULL ORDER BY id DESC LIMIT 1').get() || null;
        const open = db.prepare(`SELECT id, reason, expiresAt FROM support_access WHERE decision = 'accepted' AND revokedAt IS NULL AND expiresAt > ?
          ORDER BY expiresAt DESC LIMIT 1`).get(nowIso) || null;
        const last = db.prepare('SELECT id, reason, decision, decidedAt, expiresAt, revokedAt FROM support_access WHERE decision IS NOT NULL ORDER BY decidedAt DESC, id DESC LIMIT 1').get() || null;
        return { pending, open, last };
      } catch {
        return null;
      } finally {
        if (db) db.close();
      }
    },

    // The emails of the active accounts (rule 26), as stored. null when the instance cannot be read,
    // so the directory keeps what it had rather than forgetting everyone.
    readActiveEmails(slug) {
      let db;
      try {
        db = new Database(dbPath(slug), { readonly: true, fileMustExist: true });
        return db.prepare('SELECT email FROM users WHERE isActive = 1').all().map((r) => r.email);
      } catch {
        return null;
      } finally {
        if (db) db.close();
      }
    },
  };
}

module.exports = { createInstances, DB_FILE };
