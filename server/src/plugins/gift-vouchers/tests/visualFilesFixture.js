// The folder the visual files of a suite go to (specs/gift-voucher-campaigns.md rule 47): one per process, removed at its end. Not a test file.
const fs = require('fs');
const os = require('os');
const path = require('path');

let folder = null;
function filesDir() {
  if (!folder) {
    folder = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-visuals-'));
    process.on('exit', () => fs.rmSync(folder, { recursive: true, force: true }));
  }
  return folder;
}

module.exports = { filesDir };
