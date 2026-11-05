// specs/admin-account-management.md rule 16, reading of 2026-11-04 (audit R22, E22-2) — the console's mailer holds the
// same promise as the instance's: a login on 587 with no STARTTLS on offer sends no AUTH line and no mail.
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('net');

const { createMailer } = require('../utils/mailer');

function fakeSmtp() {
  const lines = [];
  const server = net.createServer((socket) => {
    socket.on('error', () => {});
    socket.write('220 fake ESMTP\r\n');
    let inData = false;
    socket.on('data', (chunk) => {
      const text = chunk.toString();
      lines.push(text.trim());
      if (inData) {
        if (/\r\n\.\r\n$/.test(text)) { inData = false; socket.write('250 ok\r\n'); }
        return;
      }
      if (/^EHLO/i.test(text)) socket.write('250-fake\r\n250 AUTH PLAIN LOGIN\r\n');
      else if (/^AUTH/i.test(text)) socket.write('235 ok\r\n');
      else if (/^DATA/i.test(text)) { inData = true; socket.write('354 go\r\n'); } else socket.write('250 ok\r\n');
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({
      port: server.address().port,
      lines,
      close: () => new Promise((done) => { server.closeAllConnections?.(); server.close(done); }),
    }));
  });
}

const message = { to: 'op@example.com', subject: 's', text: 't' };

test('a login, no STARTTLS on offer: refused, no AUTH line, no mail', async (t) => {
  const smtp = await fakeSmtp();
  t.after(smtp.close);
  const mailer = createMailer({ CP_SMTP_HOST: '127.0.0.1', CP_SMTP_PORT: String(smtp.port), CP_SMTP_USER: 'USER', CP_SMTP_PASS: 'PASS_XYZ' });
  await assert.rejects(mailer.send(message));
  assert.equal(smtp.lines.some((line) => /^(AUTH|MAIL|DATA)/i.test(line)), false, smtp.lines.join(' | '));
});

test('no login: the relay keeps working', async (t) => {
  const smtp = await fakeSmtp();
  t.after(smtp.close);
  const mailer = createMailer({ CP_SMTP_HOST: '127.0.0.1', CP_SMTP_PORT: String(smtp.port) });
  await mailer.send(message);
  assert.equal(smtp.lines.some((line) => /^DATA/i.test(line)), true);
});
