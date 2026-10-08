#!/usr/bin/env bash
#
# Read-only security inventory of ONE host (a Proxmox node, an LXC, a VM, the legacy Pi).
# docs/security/2026-10-08-infrastructure-security-audit.md §6 explains what to do with the output.
#
# It changes nothing: every command only reads. Secrets are redacted before they reach the
# report (any KEY/SECRET/PASSWORD/TOKEN value in an env file or `pm2 env` is replaced by its
# length). Still, read the report before sharing it: it names users, ports and versions.
#
#   bash host-audit.sh                       # report on stdout
#   bash host-audit.sh > "$(hostname)-$(date +%F).txt"
#   sudo bash host-audit.sh                  # more complete (sshd config, firewall, docker)
#
# Works on Debian/Ubuntu/Raspberry Pi OS and Proxmox VE. Each section is skipped when its tool
# is absent, so it is safe to run everywhere.

set -u

section() { printf '\n==================== %s ====================\n' "$*"; }
have() { command -v "$1" >/dev/null 2>&1; }
redact() { sed -E 's/((KEY|SECRET|PASSWORD|PASS|TOKEN|PRIVATE|CREDENTIAL)[A-Z0-9_]*=)(.*)/\1<redacted:\3 chars>/I' | awk '{ if (match($0, /<redacted:/)) { s = substr($0, RSTART + 10); sub(/ chars>.*/, "", s); sub(/<redacted:.*/, "<redacted:" length(s) " chars>", $0) } print }'; }
as_root() { [ "$(id -u)" = 0 ]; }

section "HOST"
hostname; date -Is; uname -a
[ -f /etc/os-release ] && . /etc/os-release && echo "OS: ${PRETTY_NAME:-?}"
have pveversion && pveversion
uptime
echo "User running this audit: $(id)"
echo "Virtualisation: $(have systemd-detect-virt && systemd-detect-virt || echo unknown)"

section "PENDING UPDATES (apt)"
if have apt-get; then
  apt-get -s upgrade 2>/dev/null | grep -E '^[0-9]+ upgraded' || echo "(apt-get simulate failed: run as root or apt update first)"
  apt list --upgradable 2>/dev/null | grep -iE 'linux-image|openssl|openssh|sudo|libc6|curl|nginx|caddy|apache|php|docker|pve|node' | head -40
  echo "--- unattended-upgrades:"
  dpkg -l unattended-upgrades 2>/dev/null | grep -E '^ii' || echo "unattended-upgrades NOT installed"
  [ -f /etc/apt/apt.conf.d/20auto-upgrades ] && cat /etc/apt/apt.conf.d/20auto-upgrades
  echo "--- needs reboot: $([ -f /var/run/reboot-required ] && echo YES || echo no)"
fi

section "LISTENING SOCKETS (what is exposed on this host)"
if have ss; then ss -tulpnH 2>/dev/null | awk '{print $1, $5, $7}' | sort -u; else netstat -tulpn 2>/dev/null; fi

section "FIREWALL"
if have ufw; then ufw status verbose 2>/dev/null || echo "ufw present but status needs root"; fi
if have nft; then echo "--- nftables ruleset (first 80 lines):"; nft list ruleset 2>/dev/null | head -80 || echo "(needs root)"; fi
if have iptables; then echo "--- iptables -S (first 60 lines):"; iptables -S 2>/dev/null | head -60 || echo "(needs root)"; fi
if have pve-firewall; then echo "--- pve-firewall:"; pve-firewall status 2>/dev/null; cat /etc/pve/firewall/cluster.fw 2>/dev/null | head -40; fi
have fail2ban-client && { echo "--- fail2ban:"; fail2ban-client status 2>/dev/null || echo "(needs root)"; }

section "SSH DAEMON"
if [ -r /etc/ssh/sshd_config ]; then
  if have sshd && as_root; then
    sshd -T 2>/dev/null | grep -iE '^(permitrootlogin|passwordauthentication|pubkeyauthentication|kbdinteractiveauthentication|challengeresponseauthentication|port|x11forwarding|allowusers|allowgroups|maxauthtries|permitemptypasswords|allowtcpforwarding)\b'
  else
    grep -iE '^\s*(PermitRootLogin|PasswordAuthentication|PubkeyAuthentication|Port|X11Forwarding|AllowUsers|MaxAuthTries|KbdInteractiveAuthentication)' /etc/ssh/sshd_config /etc/ssh/sshd_config.d/*.conf 2>/dev/null || echo "(defaults in effect: PermitRootLogin prohibit-password, PasswordAuthentication yes)"
  fi
else
  echo "sshd_config not readable (run as root)"
fi
echo "--- authorized_keys files:"
for h in /root $(awk -F: '$3>=1000 && $7 !~ /nologin|false/ {print $6}' /etc/passwd); do
  for f in "$h"/.ssh/authorized_keys "$h"/.ssh/authorized_keys2; do
    [ -r "$f" ] && echo "$f: $(grep -cvE '^\s*(#|$)' "$f") key(s), mode $(stat -c %a "$f")"
  done
done

section "ACCOUNTS AND PRIVILEGES"
echo "--- login-capable users:"; awk -F: '$7 !~ /nologin|false/ {print $1 " uid=" $3 " shell=" $7}' /etc/passwd
echo "--- sudoers (group sudo/wheel + /etc/sudoers.d):"
getent group sudo wheel admin 2>/dev/null
ls -l /etc/sudoers.d 2>/dev/null; grep -rhE 'NOPASSWD|ALL=' /etc/sudoers /etc/sudoers.d 2>/dev/null | grep -v '^#' || echo "(needs root)"
echo "--- accounts with empty password:"; awk -F: '($2 == "" ) {print $1}' /etc/shadow 2>/dev/null || echo "(needs root)"
echo "--- last logins:"; last -n 10 -w 2>/dev/null | head -12
echo "--- failed SSH auth (last 7 days, if journal):"
have journalctl && journalctl -u ssh -u sshd --since '7 days ago' 2>/dev/null | grep -ciE 'failed password|invalid user' | sed 's/^/count: /'

section "TIME SYNC"
have timedatectl && timedatectl 2>/dev/null | grep -iE 'time zone|synchronized|ntp'

section "DOCKER"
if have docker; then
  docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}\t{{.Status}}' 2>/dev/null || echo "(docker needs root or docker group)"
  echo "--- privileged / host-network / docker.sock-mounted containers:"
  for c in $(docker ps -q 2>/dev/null); do
    docker inspect "$c" --format '{{.Name}} privileged={{.HostConfig.Privileged}} net={{.HostConfig.NetworkMode}} caps={{.HostConfig.CapAdd}} binds={{range .HostConfig.Binds}}{{.}} {{end}}' 2>/dev/null | grep -E 'privileged=true|net=host|docker.sock' || true
  done
  echo "--- images (age):"; docker images --format '{{.Repository}}:{{.Tag}} {{.CreatedSince}}' 2>/dev/null | head -20
  echo "--- compose files found:"; find / -maxdepth 4 \( -name 'docker-compose*.yml' -o -name 'compose*.yml' \) 2>/dev/null | head
  echo "--- docker daemon listening on TCP? "; ss -tlnpH 2>/dev/null | grep -E ':2375|:2376' || echo "no"
fi

section "WORDPRESS (if a wp_app container or a wp-cli install is here)"
WPC="$(docker ps --format '{{.Names}}' 2>/dev/null | grep -m1 -iE 'wp|wordpress' || true)"
if [ -n "$WPC" ]; then
  echo "container: $WPC"
  docker exec "$WPC" sh -c 'command -v wp >/dev/null && wp --allow-root core version --extra 2>/dev/null; command -v wp >/dev/null && wp --allow-root plugin list --fields=name,status,version,update,auto_update 2>/dev/null; command -v wp >/dev/null && wp --allow-root theme list --fields=name,status,version,update 2>/dev/null; command -v wp >/dev/null && wp --allow-root user list --fields=user_login,roles --role=administrator 2>/dev/null; php -v 2>/dev/null | head -1' 2>/dev/null || echo "(wp-cli not in container — run: docker exec $WPC php -r 'include \"/var/www/html/wp-includes/version.php\"; echo \$wp_version;')"
  echo "--- wp-config hardening constants:"
  docker exec "$WPC" sh -c 'grep -E "DISALLOW_FILE_EDIT|DISALLOW_FILE_MODS|FORCE_SSL_ADMIN|WP_DEBUG|AUTOMATIC_UPDATER_DISABLED|WP_AUTO_UPDATE_CORE" /var/www/html/wp-config.php' 2>/dev/null || echo "(none set → file editor enabled, debug off by default)"
  echo "--- xmlrpc.php present: $(docker exec "$WPC" sh -c 'test -f /var/www/html/xmlrpc.php && echo yes || echo no' 2>/dev/null)"
  echo "--- uploads .htaccess (PHP execution blocked?):"
  docker exec "$WPC" sh -c 'cat /var/www/html/wp-content/uploads/.htaccess 2>/dev/null | head -20' 2>/dev/null
  echo "--- mu-plugins:"; docker exec "$WPC" sh -c 'ls -1 /var/www/html/wp-content/mu-plugins 2>/dev/null' 2>/dev/null
  echo "--- stray PHP in uploads (should be empty):"; docker exec "$WPC" sh -c 'find /var/www/html/wp-content/uploads -name "*.php" 2>/dev/null | head' 2>/dev/null
fi
have wp && { wp core version --extra 2>/dev/null; wp plugin list 2>/dev/null; }

section "REVERSE PROXY (Caddy / nginx / Apache)"
for f in /etc/caddy/Caddyfile /etc/nginx/nginx.conf /etc/apache2/apache2.conf; do
  [ -r "$f" ] && { echo "--- $f (first 120 lines):"; sed -n 1,120p "$f"; }
done
ls /etc/nginx/sites-enabled /etc/caddy/conf.d 2>/dev/null
have caddy && caddy version 2>/dev/null

section "TLS CERTIFICATES (expiry)"
for c in ~/guestflow/certs/server.crt /etc/letsencrypt/live/*/fullchain.pem /var/lib/caddy/.local/share/caddy/certificates/*/*/*.crt; do
  [ -r "$c" ] && have openssl && echo "$c: $(openssl x509 -in "$c" -noout -enddate -subject 2>/dev/null | tr '\n' ' ')"
done
for k in ~/guestflow/certs/server.key /etc/letsencrypt/live/*/privkey.pem; do [ -e "$k" ] && echo "$k mode=$(stat -c %a "$k") owner=$(stat -c %U:%G "$k")"; done

section "GUESTFLOW (if deployed here)"
GF="${GUESTFLOW_ROOT:-$HOME/guestflow}"
if [ -d "$GF" ]; then
  echo "root: $GF"; ls -la "$GF" 2>/dev/null
  echo "--- current release: $(readlink -f "$GF/current" 2>/dev/null)"
  echo "--- data dir perms:"; ls -la "$GF/data" 2>/dev/null
  for f in "$GF/data/.env.local" "$GF/data/guestflow.db" "$GF/data/backups" "$GF/data/uploads"; do
    [ -e "$f" ] && echo "$f mode=$(stat -c %a "$f") owner=$(stat -c %U:%G "$f")"
  done
  echo "--- env keys set in .env.local (values redacted):"
  [ -r "$GF/data/.env.local" ] && sed -E 's/=.*//' "$GF/data/.env.local" | grep -vE '^\s*(#|$)'
  echo "--- ecosystem.config.js env (redacted):"; [ -r "$GF/ecosystem.config.js" ] && redact < "$GF/ecosystem.config.js" | grep -iE 'NODE_ENV|HTTPS_ENABLED|TRUST_PROXY_HOPS|PORT|CORS_ORIGINS|TLS_|GUESTFLOW_'
  echo "--- IMPORTANT: TRUST_PROXY_HOPS must be unset/false when Node is reached directly (port forward), and exactly 1 when a reverse proxy (Caddy edge) sits in front."
  have pm2 && { echo "--- pm2:"; pm2 jlist 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{for(const p of JSON.parse(s))console.log(p.name,p.pm2_env.status,"restarts="+p.pm2_env.restart_time,"node="+p.pm2_env.node_version,"user="+p.pm2_env.username)}catch(e){console.log("(pm2 jlist unreadable)")}})' 2>/dev/null; }
  have node && echo "node: $(node --version)"
  echo "--- who can read the DB (should be only the app user):"; [ -e "$GF/data/guestflow.db" ] && stat -c '%A %U:%G %n' "$GF/data/guestflow.db"
  echo "--- backups:"; ls -la "$GF/data/backups" 2>/dev/null | tail -8
fi

section "CRON / TIMERS"
crontab -l 2>/dev/null | grep -vE '^\s*#' ; ls /etc/cron.d 2>/dev/null
have systemctl && systemctl list-timers --all --no-pager 2>/dev/null | head -25

section "WORLD-WRITABLE / SUID OUTSIDE STANDARD PATHS (quick)"
find / -xdev \( -path /proc -o -path /sys -o -path /var/lib/docker \) -prune -o -type f -perm -0002 -print 2>/dev/null | head -20
find /home /opt /srv /var/www -xdev -type f -perm -4000 -print 2>/dev/null | head

section "PROXMOX (only on the pve node)"
if have pvesh; then
  echo "--- nodes/VMs/LXCs:"; pvesh get /cluster/resources --type vm --output-format json 2>/dev/null | head -c 4000; echo
  echo "--- web UI 8006 reachable from: $(ss -tlnpH 2>/dev/null | grep ':8006' | awk '{print $4}')"
  echo "--- users and 2FA (tfa column):"; pvesh get /access/users --output-format json 2>/dev/null | head -c 2000; echo
  echo "--- datacenter firewall enabled: $(grep -E '^enable' /etc/pve/firewall/cluster.fw 2>/dev/null || echo 'no cluster.fw')"
  echo "--- backup jobs:"; cat /etc/pve/jobs.cfg 2>/dev/null | head -40
  echo "--- subscription/repos:"; grep -rhE '^deb' /etc/apt/sources.list /etc/apt/sources.list.d/*.list 2>/dev/null | grep -i pve
fi

section "END"
echo "Report generated $(date -Is). Review it, then compare against docs/security/2026-10-08-infrastructure-security-audit.md §6."
