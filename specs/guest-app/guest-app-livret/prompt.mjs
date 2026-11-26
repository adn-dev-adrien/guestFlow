// The import script's prompts (specs/guest-app.md rule 64, audit R37-EXT-2): a question typed at the terminal, and a
// secret one — the password — whose answer is never written back, so it stays out of the scrollback, a screen share or
// a recording. The streams are injectable for the suite.
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import process, { stdin, stdout } from 'node:process';

/** A question whose answer is shown as it is typed (the 2FA code, short-lived). */
export async function ask(question, { input = stdin, output = stdout } = {}) {
  const rl = createInterface({ input, output });
  try { return (await rl.question(question)).trim(); } finally { rl.close(); }
}

/**
 * A question whose answer is never echoed: the question goes to `output`, readline writes what is typed to a stream
 * that drops it (on a terminal, readline takes the keys raw, so the terminal itself echoes nothing either).
 */
export async function askSecret(question, { input = stdin, output = stdout } = {}) {
  output.write(question);
  const muted = new Writable({ write(_chunk, _encoding, done) { done(); } });
  const rl = createInterface({ input, output: muted, terminal: Boolean(input.isTTY) });
  // Raw keys: Ctrl-C reaches readline, not the process; it still stops the script.
  rl.on('SIGINT', () => { output.write('\n'); process.exit(130); });
  try { return (await rl.question('')).trim(); } finally {
    rl.close();
    output.write('\n');
  }
}
