// specs/admin-account-management.md rule 21 (2026-11-09) — the SMTP client greets the server with the domain of the
// address it sends From, never nodemailer's default `[127.0.0.1]` that lands in the receiver's `Received` header.
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createEmailService } = require('../utils/emailService');

const noOutbox = { NODE_ENV: 'production' };
const message = { to: 'guest@example.com', subject: 's', text: 't' };

function capture(settings, env = noOutbox) {
  const counterFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gf-ehlo-')), 'platform-mail.json');
  const seen = [];
  const transportFactory = (options) => {
    seen.push(options);
    return { sendMail: async () => ({ messageId: 'x' }) };
  };
  return { service: createEmailService(settings, { transportFactory, env, counterFile }), seen };
}

test('the operator SMTP greets with the From domain, as a real server sees it', async (t) => {
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
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((done) => { server.closeAllConnections?.(); server.close(done); }));

  const service = createEmailService(
    { host: '127.0.0.1', port: server.address().port, secure: false, fromEmail: 'contact@domainesolio.com', fromName: 'Domaine Solio' },
    { env: noOutbox },
  );
  await service.send(message);
  assert.ok(lines.includes('EHLO domainesolio.com'), lines.join(' | '));
});

test('the platform transport greets with its noreply domain', async () => {
  const { service, seen } = capture({}, {
    ...noOutbox,
    GUESTFLOW_MANAGED: '1',
    GUESTFLOW_PLATFORM_SMTP_HOST: 'smtp.platform.example',
    GUESTFLOW_PLATFORM_SMTP_FROM: 'noreply@mail.platform.example',
  });
  await service.send(message);
  assert.equal(seen[0].name, 'mail.platform.example');
});

test('an upper-case domain is lowered', async () => {
  const { service, seen } = capture({ host: 'smtp.example.com', fromEmail: 'Contact@DomaineSolio.COM' });
  await service.send(message);
  assert.equal(seen[0].name, 'domainesolio.com');
});

test('an address without a valid domain leaves the default greeting', async () => {
  for (const fromEmail of ['contact@localhost', 'contact@bad domain.com', 'contact']) {
    const { service, seen } = capture({ host: 'smtp.example.com', fromEmail });
    await service.send(message);
    assert.equal('name' in seen[0], false, fromEmail);
  }
});
