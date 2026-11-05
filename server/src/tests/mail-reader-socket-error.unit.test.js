// specs/airbnb-mail-intake.md rule 36 (audit R22, E22-4) — imapflow emits 'error' once connect() has resolved and throws
// with no listener, so a network reset reached uncaughtException. Real ImapFlow against a loopback fake server: the
// reader listens, logs the real cause, and the pass rejects as before. An uncaught throw fails the test by itself.
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('net');
const { ImapFlow } = require('imapflow');

const { readMailsFrom, testConnection } = require('../plugins/sdk/mailboxReader');

function fakeImap(t, { onFetch = () => {}, onLogout = null }) {
  const server = net.createServer((socket) => {
    socket.write('* OK IMAP4rev1 ready\r\n');
    let buffer = '';
    socket.on('error', () => {});
    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      let at = buffer.indexOf('\r\n');
      while (at >= 0) {
        const line = buffer.slice(0, at);
        buffer = buffer.slice(at + 2);
        at = buffer.indexOf('\r\n');
        const [tag, rawCommand, rawSub] = line.split(' ');
        const command = String(rawCommand).toUpperCase();
        const sub = String(rawSub).toUpperCase();
        if (command === 'CAPABILITY') socket.write(`* CAPABILITY IMAP4rev1\r\n${tag} OK\r\n`);
        else if (command === 'LOGIN') socket.write(`${tag} OK logged\r\n`);
        else if (command === 'EXAMINE' || command === 'SELECT') socket.write(`* 3 EXISTS\r\n* OK [UIDVALIDITY 1] x\r\n* OK [UIDNEXT 9] x\r\n${tag} OK [READ-ONLY] done\r\n`);
        else if (command === 'UID' && sub === 'SEARCH') { socket.write(`* SEARCH 5\r\n${tag} OK\r\n`); } else if (command === 'UID' && sub === 'FETCH') onFetch(socket);
        else if (command === 'LOGOUT') {
          if (onLogout) onLogout(socket);
          else { socket.write(`* BYE\r\n${tag} OK\r\n`); socket.end(); }
        } else socket.write(`${tag} OK\r\n`);
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      t.after(() => new Promise((done) => { server.close(done); server.closeAllConnections?.(); }));
      resolve(server.address().port);
    });
  });
}

const plainClient = (port, extra = {}) => class extends ImapFlow {
  constructor(options) {
    super({ ...options, secure: false, doSTARTTLS: false, disableAutoIdle: true, host: '127.0.0.1', port, ...extra });
  }
};

const read = (port, ImapClient, log) => readMailsFrom({
  host: '127.0.0.1', port, user: 'u', password: 'p', sender: 'a@b.fr', ImapClient, smtpHostOf: () => '127.0.0.1', log,
});

test('rule 36 — a connection reset during a pass: logged with its cause, the pass rejects, nothing uncaught', async (t) => {
  const port = await fakeImap(t, { onFetch: (socket) => socket.resetAndDestroy() });
  const logged = [];
  await assert.rejects(read(port, plainClient(port), (line) => logged.push(line)));
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.ok(logged.some((line) => /^mail intake: ECONNRESET /.test(line)), logged.join(' | '));
});

test('rule 36 — a silent server past the socket timeout: logged, the pass rejects, nothing uncaught', async (t) => {
  const port = await fakeImap(t, {});
  const logged = [];
  await assert.rejects(read(port, plainClient(port, { socketTimeout: 300 }), (line) => logged.push(line)));
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.ok(logged.some((line) => /^mail intake: ETIMEOUT /.test(line)), logged.join(' | '));
});

test('rule 36 — the connection test: a reset at logout stays inside the test, and logs when asked', async (t) => {
  const port = await fakeImap(t, { onLogout: (socket) => socket.resetAndDestroy() });
  const logged = [];
  const result = await testConnection({
    host: '127.0.0.1', port, user: 'u', password: 'p', ImapClient: plainClient(port), smtpHostOf: () => '127.0.0.1', log: (line) => logged.push(line),
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(typeof result.ok, 'boolean');
  assert.ok(logged.some((line) => /^mail intake: ECONNRESET /.test(line)), logged.join(' | '));
});

test('rule 36 — the connection test without a logger still listens', async (t) => {
  const port = await fakeImap(t, { onLogout: (socket) => socket.resetAndDestroy() });
  const result = await testConnection({ host: '127.0.0.1', port, user: 'u', password: 'p', ImapClient: plainClient(port), smtpHostOf: () => '127.0.0.1' });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(typeof result.ok, 'boolean');
});
