/**
 * SCHEMA FLOOR (specs/self-update-and-releases.md §3.B rule 57; pricing-components rule 85).
 *
 * A migration that no previous release can run on raises the floor to its own version, in the same transaction as the
 * change. The floor lives in the database (`migrations` rows named `schema_floor:<version>`) and is only ever raised:
 * the greatest row wins. The updater reads it and refuses any target below it.
 */
const { parseVersion, compareVersions, isValidVersion } = require('./semver');

const PREFIX = 'schema_floor:';

const hasMigrations = (db) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'migrations'").get());

/** The highest floor stored in the database, or null when none was ever raised. */
function readSchemaFloor(db) {
  if (!hasMigrations(db)) return null;
  let floor = null;
  for (const { name } of db.prepare("SELECT name FROM migrations WHERE name LIKE 'schema_floor:%'").all()) {
    const version = String(name).slice(PREFIX.length);
    if (isValidVersion(version) && (floor === null || compareVersions(version, floor) === 1)) floor = version;
  }
  return floor;
}

/** Stores `version` as a floor. Returns true when the floor moved up, false when it already was at or above it. */
function raiseSchemaFloor(db, version) {
  if (!parseVersion(version)) throw new Error(`SCHEMA_FLOOR_INVALID: ${version}`);
  const current = readSchemaFloor(db);
  if (current !== null && compareVersions(version, current) !== 1) return false;
  db.prepare('INSERT OR IGNORE INTO migrations (name) VALUES (?)').run(`${PREFIX}${version}`);
  return true;
}

/** True when installing `target` would hand the database to a release older than its floor. */
function isBelowSchemaFloor(db, target) {
  const floor = readSchemaFloor(db);
  return floor !== null && compareVersions(target, floor) === -1;
}

const BELOW_FLOOR_MESSAGE = 'Cette version est plus ancienne que la base de données : installation refusée.';

module.exports = { readSchemaFloor, raiseSchemaFloor, isBelowSchemaFloor, BELOW_FLOOR_MESSAGE };
