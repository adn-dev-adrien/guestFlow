#!/usr/bin/env node
/**
 * A release directory built from this checkout, for development and the integration test
 * (specs/hosting-h1-fleet-runtime.md H-D6): the local drivers run real instances, and an instance
 * runs from `<releases>/<version>/` like on the host. The server's code is copied (its version is
 * read from the release's own package.json), its node_modules are linked, not installed.
 *
 *   node scripts/dev-release.js <releasesDir> <version> [--broken] [--copy-modules]
 *
 * `--broken` makes a release that exits at start: the one a fleet update must roll back from.
 * `--copy-modules` copies node_modules instead of linking them: on a real host the instances cannot
 * see the checkout the link would point into (deploy/hosting/test/).
 */

const fs = require('fs');
const path = require('path');

const { shareRelease } = require('../src/utils/releases');

const REPO = path.resolve(__dirname, '..', '..', '..');

function makeDevRelease({ releasesDir, version, broken = false, copyModules = false, repo = REPO }) {
  const dir = path.join(releasesDir, version);
  if (fs.existsSync(path.join(dir, 'server', 'src', 'index.js'))) return dir;
  const partial = `${dir}.partial`;
  fs.rmSync(partial, { recursive: true, force: true });
  const server = path.join(partial, 'server');
  fs.mkdirSync(server, { recursive: true });
  fs.cpSync(path.join(repo, 'server', 'src'), path.join(server, 'src'), { recursive: true, filter: (src) => !src.includes(`${path.sep}tests`) });
  fs.cpSync(path.join(repo, 'server', 'scripts'), path.join(server, 'scripts'), { recursive: true });
  fs.copyFileSync(path.join(repo, 'server', 'package.json'), path.join(server, 'package.json'));
  if (copyModules) fs.cpSync(path.join(repo, 'server', 'node_modules'), path.join(server, 'node_modules'), { recursive: true, verbatimSymlinks: true });
  else fs.symlinkSync(path.join(repo, 'server', 'node_modules'), path.join(server, 'node_modules'), 'dir');
  // The release archive ships the built client as client/build (release.sh); a checkout builds it to client/dist.
  const clientBuild = ['build', 'dist'].map((d) => path.join(repo, 'client', d)).find((d) => fs.existsSync(path.join(d, 'index.html')));
  if (clientBuild) {
    fs.mkdirSync(path.join(partial, 'client'), { recursive: true });
    fs.symlinkSync(clientBuild, path.join(partial, 'client', 'build'), 'dir');
  }
  fs.writeFileSync(path.join(partial, 'package.json'), JSON.stringify({ name: 'guestflow', version }, null, 2));
  if (broken) fs.writeFileSync(path.join(server, 'src', 'index.js'), "console.error('broken release'); process.exit(1);\n");
  shareRelease(partial);
  fs.renameSync(partial, dir);
  return dir;
}

module.exports = { makeDevRelease };

if (require.main === module) {
  const [releasesDir, version] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  if (!releasesDir || !/^\d+\.\d+\.\d+$/.test(version || '')) {
    console.error('usage: node scripts/dev-release.js <releasesDir> <x.y.z> [--broken]');
    process.exit(2);
  }
  console.log(makeDevRelease({
    releasesDir: path.resolve(releasesDir), version, broken: process.argv.includes('--broken'), copyModules: process.argv.includes('--copy-modules'),
  }));
}
