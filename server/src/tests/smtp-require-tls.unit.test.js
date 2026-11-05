// specs/admin-account-management.md rule 16, reading of 2026-11-04 (audit R22, E22-2) — « STARTTLS » is a promise: with
// a login on a non-implicit-TLS transport the upgrade is required. A server that does not offer it (or an on-path
// attacker who strips the EHLO line) gets no AUTH line, and the send fails. A relay without a login keeps working.
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('net');

const { createEmailService } = require('../utils/emailService');

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

const message = { to: 'guest@example.com', subject: 's', text: 't' };
const SETTINGS = { host: '127.0.0.1', fromEmail: 'from@example.com', fromName: 'x' };
const noOutbox = { env: { NODE_ENV: 'production' } };

test('a server with no STARTTLS: the password and the mail never leave', async (t) => {
  const smtp = await fakeSmtp();
  t.after(smtp.close);
  const service = createEmailService({ ...SETTINGS, port: smtp.port, secure: false, user: 'USER', password: 'PASS_XYZ' }, noOutbox);
  await assert.rejects(service.send(message));
  assert.equal(smtp.lines.some((line) => /^AUTH/i.test(line)), false, smtp.lines.join(' | '));
  assert.equal(smtp.lines.some((line) => /^(MAIL|DATA)/i.test(line)), false, smtp.lines.join(' | '));
});

test('the SMTP test button takes the same path: it fails, nothing sent', async (t) => {
  const smtp = await fakeSmtp();
  t.after(smtp.close);
  const service = createEmailService({ ...SETTINGS, port: smtp.port, secure: false, user: 'USER', password: 'PASS_XYZ' }, noOutbox);
  await assert.rejects(service.sendTest('admin@example.com'));
  assert.equal(smtp.lines.some((line) => /^AUTH/i.test(line)), false);
});

test('a relay without a login keeps working in clear', async (t) => {
  const smtp = await fakeSmtp();
  t.after(smtp.close);
  const service = createEmailService({ ...SETTINGS, port: smtp.port, secure: false }, noOutbox);
  await service.send(message);
  assert.equal(smtp.lines.some((line) => /^DATA/i.test(line)), true);
});

function captured(settings, options = {}) {
  const seen = [];
  const service = createEmailService(settings, {
    ...noOutbox,
    ...options,
    transportFactory: (config) => { seen.push(config); return { sendMail: async () => ({}) }; },
  });
  return { service, seen };
}

test('the operator transport: required with a login on 587, not on implicit TLS, not without a login', async () => {
  const cases = [
    [{ secure: false, user: 'u', password: 'p' }, true],
    [{ secure: true, user: 'u', password: 'p' }, false],
    [{ secure: false }, false],
  ];
  for (const [extra, expected] of cases) {
    const { service, seen } = captured({ ...SETTINGS, ...extra });
    await service.send(message);
    assert.equal(Boolean(seen[0].requireTLS), expected, JSON.stringify(extra));
  }
});

test('the platform transport: required with a login on 587, not on 465, not without a login', async (t) => {
  const os = require('os');
  const fs = require('fs');
  const path = require('path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smtp-require-tls-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const platform = {
    GUESTFLOW_MANAGED: '1',
    GUESTFLOW_PLATFORM_SMTP_HOST: 'smtp.platform.test',
    GUESTFLOW_PLATFORM_SMTP_FROM: 'noreply@guestflow.test',
    GUESTFLOW_PLATFORM_MAIL_DAILY_LIMIT: '50',
  };
  const login = { GUESTFLOW_PLATFORM_SMTP_USER: 'relay', GUESTFLOW_PLATFORM_SMTP_PASS: 'secret' };
  const cases = [
    [{ ...platform, ...login, GUESTFLOW_PLATFORM_SMTP_PORT: '587' }, true],
    [{ ...platform, ...login, GUESTFLOW_PLATFORM_SMTP_PORT: '465' }, false],
    [{ ...platform, GUESTFLOW_PLATFORM_SMTP_PORT: '587' }, false],
  ];
  let n = 0;
  for (const [env, expected] of cases) {
    n += 1;
    const { service, seen } = captured({ fromEmail: 'from@example.com', fromName: 'x' }, { env, counterFile: path.join(dir, `count-${n}.json`) });
    await service.send(message);
    assert.equal(Boolean(seen[0].requireTLS), expected, JSON.stringify(env));
  }
});
