/**
 * The host drivers (specs/hosting-h1-fleet-runtime.md H-D6). Every host action goes through one of
 * four: `process`, `proxy`, `backup`, `mail`. Each has a `local` implementation, so the whole
 * lifecycle runs on a laptop and in CI; production selects the real ones by environment:
 *
 *   CP_PROCESS_DRIVER   local | systemd      CP_SYSTEMCTL (default `sudo -n systemctl`)
 *   CP_PROXY_DRIVER     none  | caddy        CP_CADDY_SITES_DIR, CP_CADDYFILE, CP_CLOSED_PAGE_DIR
 *   CP_BACKUP_DRIVER    local | litestream   CP_LITESTREAM_CONFIG, CP_BACKUP_URL, CP_BACKUP_ENDPOINT,
 *                                            CP_BACKUP_REGION, CP_RCLONE_REMOTE, CP_LITESTREAM_RESTART
 *   CP_MAIL_DRIVER      local | platform     CP_PLATFORM_SMTP_*, CP_PLATFORM_MAIL_FROM, CP_MAIL_DAILY_LIMIT
 *
 * Every driver works on the same instance shape: { customerId, key, slug, dir, dbPath, port, version }.
 */

const fs = require('fs');
const path = require('path');
const { createExec } = require('./exec');
const { createLocalProcessDriver } = require('./process-local');
const { createSystemdProcessDriver } = require('./process-systemd');
const { createCaddyProxyDriver } = require('./proxy-caddy');
const { createNoneProxyDriver } = require('./proxy-none');
const { createLocalBackupDriver } = require('./backup-local');
const { createLitestreamBackupDriver } = require('./backup-litestream');
const { createMailDriver } = require('./mail-platform');

function choose(value, allowed, fallback) {
  const v = String(value || fallback);
  if (!allowed.includes(v)) throw new Error(`driver « ${v} » inconnu (${allowed.join(' | ')})`);
  return v;
}

function createDrivers({ env = process.env, root, releasesDir, dataDir, domain, now = () => new Date(), exec = createExec(), listReplicas = () => [] }) {
  const processKind = choose(env.CP_PROCESS_DRIVER, ['local', 'systemd'], 'local');
  const proxyKind = choose(env.CP_PROXY_DRIVER, ['none', 'caddy'], 'none');
  const backupKind = choose(env.CP_BACKUP_DRIVER, ['local', 'litestream'], 'local');
  const mailKind = choose(env.CP_MAIL_DRIVER, ['local', 'platform'], 'local');

  return {
    process: processKind === 'systemd'
      ? createSystemdProcessDriver({ exec, releasesDir, systemctl: env.CP_SYSTEMCTL || 'sudo -n systemctl' })
      : createLocalProcessDriver({ releasesDir }),
    proxy: proxyKind === 'caddy'
      ? createCaddyProxyDriver({
        exec,
        domain,
        sitesDir: env.CP_CADDY_SITES_DIR || '/etc/caddy/sites',
        caddyfile: env.CP_CADDYFILE || '/etc/caddy/Caddyfile',
        closedDir: env.CP_CLOSED_PAGE_DIR || '/srv/guestflow/closed',
      })
      : createNoneProxyDriver({ root }),
    backup: backupKind === 'litestream'
      ? createLitestreamBackupDriver({
        exec,
        listReplicas,
        writeFile: (file, text) => fs.writeFileSync(file, text),
        configFile: env.CP_LITESTREAM_CONFIG || '/etc/litestream.yml',
        url: env.CP_BACKUP_URL,
        endpoint: env.CP_BACKUP_ENDPOINT || '',
        region: env.CP_BACKUP_REGION || '',
        restartCommand: env.CP_LITESTREAM_RESTART || 'sudo -n systemctl restart litestream',
        rcloneRemote: env.CP_RCLONE_REMOTE,
      })
      : createLocalBackupDriver({
        dir: env.CP_LOCAL_BACKUP_DIR || path.join(dataDir, 'backups'),
        now,
        intervalMs: Number(env.CP_LOCAL_BACKUP_INTERVAL_MS) || undefined,
      }),
    mail: createMailDriver({ kind: mailKind, domain, env }),
  };
}

module.exports = { createDrivers };
