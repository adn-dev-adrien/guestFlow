/**
 * The platform's sender, for a hosted instance without its own SMTP
 * (specs/hosting-h1-fleet-runtime.md rules 18–20, H-D5).
 *
 * The control plane writes it into the instance's environment at provisioning:
 *
 *   GUESTFLOW_MANAGED=1                        only a hosted instance ever sends through the platform
 *   GUESTFLOW_PLATFORM_SMTP_HOST/PORT/USER/PASS the shared transactional account
 *   GUESTFLOW_PLATFORM_SMTP_FROM               noreply@<platform domain>
 *   GUESTFLOW_PLATFORM_SMTP_OUTBOX             development and CI (the `local` mail driver): every
 *                                              message is written as JSON into that folder instead
 *   GUESTFLOW_PLATFORM_MAIL_DAILY_LIMIT        the console's CP_MAIL_DAILY_LIMIT (default 300)
 *
 * The day's count lives in `<data>/platform-mail.json` next to the database; the console reads it
 * every minute (rule 20). No table: the instance's schema does not change for the hosting.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_DAILY_LIMIT = 300;
const COUNTER_FILE = 'platform-mail.json';

const clean = (v) => (v == null ? '' : String(v).trim());

function config(env = process.env) {
  if (env.GUESTFLOW_MANAGED !== '1') return null;
  const host = clean(env.GUESTFLOW_PLATFORM_SMTP_HOST);
  const outbox = clean(env.GUESTFLOW_PLATFORM_SMTP_OUTBOX);
  const from = clean(env.GUESTFLOW_PLATFORM_SMTP_FROM);
  if ((!host && !outbox) || !from) return null;
  const limit = Number(env.GUESTFLOW_PLATFORM_MAIL_DAILY_LIMIT);
  return {
    host,
    port: Number(env.GUESTFLOW_PLATFORM_SMTP_PORT) || 587,
    user: clean(env.GUESTFLOW_PLATFORM_SMTP_USER),
    pass: clean(env.GUESTFLOW_PLATFORM_SMTP_PASS),
    from,
    outbox,
    dailyLimit: Number.isInteger(limit) && limit > 0 ? limit : DEFAULT_DAILY_LIMIT,
  };
}

const available = (env = process.env) => Boolean(config(env));

function counterFile(env = process.env) {
  const { resolveDataDir, resolveDbPath } = require('./deploymentPaths');
  return path.join(resolveDataDir(resolveDbPath(env)), COUNTER_FILE);
}

function today(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(now);
}

function readCount({ file, now = new Date() }) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed.day === today(now) ? Number(parsed.count) || 0 : 0;
  } catch {
    return 0;
  }
}

function writeCount({ file, count, now = new Date() }) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ day: today(now), count }));
  fs.renameSync(tmp, file);
}

// Rule 18: the platform sends in the company's name, and replies go to the company.
function headers({ cfg, fromName, replyTo }) {
  const name = clean(fromName) || 'GuestFlow';
  return {
    from: { name, address: cfg.from },
    replyTo: clean(replyTo) || undefined,
  };
}

// In development and CI the platform is a folder: one JSON file per message.
function outboxTransport(dir) {
  return {
    async sendMail(message) {
      fs.mkdirSync(dir, { recursive: true });
      const id = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
      fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(message, null, 2));
      return { messageId: id };
    },
  };
}

function limitError(limit) {
  const err = new Error(`Limite quotidienne d’envoi par la plateforme atteinte (${limit} emails) : envoi refusé.`);
  err.code = 'PLATFORM_MAIL_DAILY_LIMIT';
  return err;
}

module.exports = {
  DEFAULT_DAILY_LIMIT,
  COUNTER_FILE,
  config,
  available,
  counterFile,
  readCount,
  writeCount,
  headers,
  outboxTransport,
  limitError,
  today,
};
