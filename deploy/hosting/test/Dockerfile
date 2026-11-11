# A throwaway Debian 12 host with systemd as PID 1, for the real-host check of
# specs/hosting-h1-fleet-runtime.md (deploy/hosting/test/README.md). Never used in production.
FROM debian:12
ENV container=docker DEBIAN_FRONTEND=noninteractive
RUN apt-get update -qq && apt-get install -y -qq systemd systemd-sysv sudo curl ca-certificates gnupg git python3 \
      procps iproute2 util-linux jq sqlite3 >/dev/null && apt-get clean \
 && rm -f /lib/systemd/system/multi-user.target.wants/getty* /etc/systemd/system/getty.target.wants/* \
 && systemctl mask systemd-logind.service getty.target console-getty.service
STOPSIGNAL SIGRTMIN+3
CMD ["/sbin/init"]
