/**
 * The mail drivers (specs/hosting-h1-fleet-runtime.md H-D5, H-D6, rules 18–20). Both write the
 * platform sender into each instance's environment and read the day's count the instance keeps in
 * `<data>/platform-mail.json`:
 *
 *   platform — the transactional account of the platform domain (CP_PLATFORM_SMTP_*);
 *   local    — development and CI: each message lands as JSON in `<instance>/outbox`.
 */

const fs = require('fs');
const path = require('path');

const COUNTER_FILE = 'platform-mail.json';
const DEFAULT_DAILY_LIMIT = 300;

function readCount(inst, day) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(inst.dir, 'data', COUNTER_FILE), 'utf8'));
    return parsed.day === day ? Number(parsed.count) || 0 : 0;
  } catch {
    return 0;
  }
}

function createMailDriver({ kind, domain, env = {} }) {
  const limitRaw = Number(env.CP_MAIL_DAILY_LIMIT);
  const dailyLimit = Number.isInteger(limitRaw) && limitRaw > 0 ? limitRaw : DEFAULT_DAILY_LIMIT;
  const from = env.CP_PLATFORM_MAIL_FROM || `noreply@${domain}`;
  return {
    name: kind,
    dailyLimit,
    envFor(inst) {
      const common = { GUESTFLOW_PLATFORM_SMTP_FROM: from, GUESTFLOW_PLATFORM_MAIL_DAILY_LIMIT: String(dailyLimit) };
      if (kind === 'local') return { ...common, GUESTFLOW_PLATFORM_SMTP_OUTBOX: path.join(inst.dir, 'outbox') };
      return {
        ...common,
        GUESTFLOW_PLATFORM_SMTP_HOST: env.CP_PLATFORM_SMTP_HOST || '',
        GUESTFLOW_PLATFORM_SMTP_PORT: env.CP_PLATFORM_SMTP_PORT || '587',
        GUESTFLOW_PLATFORM_SMTP_USER: env.CP_PLATFORM_SMTP_USER || '',
        GUESTFLOW_PLATFORM_SMTP_PASS: env.CP_PLATFORM_SMTP_PASS || '',
      };
    },
    readCount,
  };
}

module.exports = { createMailDriver, readCount, DEFAULT_DAILY_LIMIT };
