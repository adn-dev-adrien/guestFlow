#!/bin/sh
# Titres Google du 2026-10-19 (specs/booking-drawer-friction.md règle 18), à lancer par Adrien.
set -e
cd "$(dirname "$0")"
H=adrien@192.168.0.23
scp -q apply.php $H:/tmp/seo-apply-20261019.php
scp -q meta.json $H:/tmp/seo-meta-20261019.json
ssh $H 'set -e
docker cp /tmp/seo-apply-20261019.php wp_app:/tmp/seo-apply-20261019.php
docker cp /tmp/seo-meta-20261019.json wp_app:/tmp/seo-meta-20261019.json
docker exec wp_app php /tmp/seo-apply-20261019.php
curl -s -o /dev/null -w "reconstruction FR %{http_code}\n" -H "Host: domainesolio.com" -H "X-Forwarded-Proto: https" http://localhost:8080/
curl -s -o /dev/null -w "reconstruction EN %{http_code}\n" -H "Host: domainesolio.com" -H "X-Forwarded-Proto: https" http://localhost:8080/en/'
echo "--- contrôles en ligne"
for u in / /le-domaine/ /autour-de-nous/; do
  printf "%s\n  " "$u"; curl -s "https://domainesolio.com$u" | grep -oE '<title>[^<]+' | head -1
done
curl -s -o /dev/null -w "/en/ %{http_code} redirection=[%{redirect_url}]\n" https://domainesolio.com/en/
