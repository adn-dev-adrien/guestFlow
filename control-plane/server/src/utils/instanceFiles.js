/**
 * The console touching files inside an instance's directory (specs/hosting-h1-fleet-runtime.md
 * rule 21, review 2026-10-17). The directory is writable by the instance, so nothing in it is
 * trusted:
 *
 *   - `assertInside(dir, file)` — before the console opens, copies or exports a file there: it must
 *     be a regular file (never a symlink) whose real path stays under the instance's directory. An
 *     instance replacing its database by a link to the console's must not get a copy of it back.
 *   - `shareDatabase(dbPath)` — after the console created or replaced a database: SQLite creates
 *     files 0644 and copies keep the source's mode, which would leave the instance (another user, in
 *     the group) unable to write. The database is set to 0660; SQLite gives its -wal and -shm the
 *     database's mode, and the setgid directory gives them the instances' group.
 */

const fs = require('fs');
const path = require('path');

function refuse(file, why) {
  const err = new Error(`Fichier refusé (${path.basename(file)}) : ${why}.`);
  err.code = 'UNSAFE_INSTANCE_FILE';
  return err;
}

// → true when the file exists and is safe, false when it does not exist; throws otherwise.
function assertInside(dir, file) {
  let st;
  try {
    st = fs.lstatSync(file);
  } catch {
    return false;
  }
  if (st.isSymbolicLink()) throw refuse(file, 'lien symbolique');
  if (!st.isFile()) throw refuse(file, 'pas un fichier ordinaire');
  const root = fs.realpathSync(dir);
  const real = fs.realpathSync(file);
  if (!real.startsWith(`${root}${path.sep}`)) throw refuse(file, 'hors du dossier de l’instance');
  return true;
}

function shareDatabase(dbPath) {
  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  for (const ext of ['', '-wal', '-shm']) {
    const file = `${dbPath}${ext}`;
    let st;
    try {
      st = fs.lstatSync(file);
    } catch {
      continue;
    }
    if (!st.isFile() || (uid !== null && st.uid !== uid)) continue;
    if ((st.mode & 0o777) !== 0o660) fs.chmodSync(file, 0o660);
    // A copied file keeps its source's group; the instance's group is its directory's.
    const gid = fs.statSync(path.dirname(file)).gid;
    if (st.gid !== gid) fs.chownSync(file, st.uid, gid);
  }
}

module.exports = { assertInside, shareDatabase };
