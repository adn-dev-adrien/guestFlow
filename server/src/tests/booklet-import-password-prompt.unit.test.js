// specs/guest-app.md rule 64 (audit R37-EXT-2) — the booklet import script reads the operator's password without
// echoing it: on a terminal the typed keys never reach the output, only the question does; the script's login asks the
// password through that prompt. A plain question (the 2FA code) still echoes, which is why the password has its own.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PassThrough, Writable } = require('node:stream');
const { pathToFileURL } = require('node:url');

const DIR = path.join(__dirname, '..', '..', '..', 'specs', 'guest-app-livret');
const prompts = () => import(pathToFileURL(path.join(DIR, 'prompt.mjs')).href);

/** A terminal: raw keys in, everything written out captured. */
function terminal() {
  const input = new PassThrough();
  input.isTTY = true;
  input.setRawMode = () => input;
  let written = '';
  const output = new Writable({ write(chunk, _e, done) { written += chunk.toString(); done(); } });
  output.isTTY = true;
  output.columns = 80;
  return { input, output, written: () => written };
}

test('rule 64: the password typed at the terminal is returned and never written back', async () => {
  const { askSecret } = await prompts();
  const tty = terminal();
  const answer = askSecret('Mot de passe : ', tty);
  tty.input.write('s3cret-Passw0rd\r');
  assert.equal(await answer, 's3cret-Passw0rd');
  assert.match(tty.written(), /Mot de passe : /);
  assert.doesNotMatch(tty.written(), /s3cret/);
});

test('rule 64: a plain question echoes on a terminal — the password never goes through it', async () => {
  const { ask } = await prompts();
  const tty = terminal();
  const answer = ask('Code : ', tty);
  tty.input.write('123456\r');
  assert.equal(await answer, '123456');
  assert.match(tty.written(), /123456/);
  const script = fs.readFileSync(path.join(DIR, 'import.mjs'), 'utf8');
  assert.match(script, /GUESTFLOW_PASSWORD \|\| await askSecret\(/);
  assert.doesNotMatch(script, /createInterface/, 'every prompt of the script is prompt.mjs’s');
});
