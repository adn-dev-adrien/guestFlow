// specs/admin-account-management.md rule 21, reading R35-CON-L1 (2026-11-09) — the console's SMTP client greets its server
// with the domain of `CP_SMTP_FROM`, as the instance's transports do (server smtp-ehlo-name), never nodemailer's default:
// the machine's hostname, `[127.0.0.1]` on a VM whose name has no dot. Login codes, export links, closing and renewal
// mails all leave through it.
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('net');
const os = require('os');
const nodemailer = require('nodemailer');

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
      if (/^EHLO/i.test(text)) socket.write('250 fake\r\n');
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

test('the console greets with the From domain, on a VM whose hostname has no dot', async (t) => {
  t.mock.method(os, 'hostname', () => 'console-vps');
  const smtp = await fakeSmtp();
  t.after(smtp.close);
  const mailer = createMailer({ CP_SMTP_HOST: '127.0.0.1', CP_SMTP_PORT: String(smtp.port), CP_SMTP_FROM: 'Console GuestFlow <Console@GuestFlow.FR>' });
  await mailer.send(message);
  const ehlo = smtp.lines.find((line) => /^EHLO/i.test(line));
  assert.equal(ehlo, 'EHLO guestflow.fr');
});

test('a bare address, the default sender, and an unreadable one', (t) => {
  const seen = [];
  t.mock.method(nodemailer, 'createTransport', (options) => { seen.push(options); return { sendMail: async () => {} }; });
  const cases = [
    ['console@guestflow.fr', 'guestflow.fr'],
    [undefined, 'guestflow.local'],
    ['Console <no-domain>', undefined],
  ];
  for (const [from, expected] of cases) {
    seen.length = 0;
    createMailer({ CP_SMTP_HOST: 'smtp.example.test', ...(from ? { CP_SMTP_FROM: from } : {}) });
    assert.equal(seen[0].name, expected, String(from));
  }
});
