/**
 * Where an instance keeps the files that are its own and not the release's
 * (specs/hosting-h1-fleet-runtime.md H-D4).
 *
 * A hosted release directory is shared by every instance on the host, so nothing an instance writes
 * may land inside it. Two environment variables move those files out:
 *
 *   GUESTFLOW_UPLOADS_DIR  the uploaded logo, photos and documents   (default: server/uploads)
 *   GUESTFLOW_LOCAL_ENV    the generated secrets file (.env.local)    (default: server/.env.local)
 *
 * Unset, both keep the historical location: a self-hosted install (Solio) sees no difference.
 */

const path = require('path');

const SERVER_DIR = path.resolve(__dirname, '..', '..');

function uploadsDir(env = process.env) {
  return env.GUESTFLOW_UPLOADS_DIR ? path.resolve(env.GUESTFLOW_UPLOADS_DIR) : path.join(SERVER_DIR, 'uploads');
}

function localEnvPath(env = process.env) {
  return env.GUESTFLOW_LOCAL_ENV ? path.resolve(env.GUESTFLOW_LOCAL_ENV) : path.join(SERVER_DIR, '.env.local');
}

module.exports = { uploadsDir, localEnvPath, SERVER_DIR };
