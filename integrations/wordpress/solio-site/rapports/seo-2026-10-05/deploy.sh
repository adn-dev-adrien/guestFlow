#!/bin/sh
# Correctifs SEO du 2026-10-05 sur le WordPress de .23 (sauvegarde base : ~/wp-backups/seo-20261005-122118).
set -e
cd "$(dirname "$0")"
MU=../../mu-plugins
H=adrien@192.168.0.23
scp -q apply.php $H:/tmp/seo-apply.php
scp -q meta.json $H:/tmp/seo-meta.json
scp -q $MU/gf-seo-head.php $H:/tmp/gf-seo-head.php
scp -q $MU/gf-seo-schema.php $H:/tmp/gf-seo-schema.php
scp -q $MU/gf-seo-redirects.php $H:/tmp/gf-seo-redirects.php
ssh $H 'set -e
docker cp /tmp/seo-apply.php wp_app:/tmp/seo-apply.php
docker cp /tmp/seo-meta.json wp_app:/tmp/seo-meta.json
docker exec wp_app php /tmp/seo-apply.php
for f in gf-seo-head.php gf-seo-schema.php gf-seo-redirects.php; do
  docker cp /tmp/$f wp_app:/var/www/html/wp-content/mu-plugins/$f
  docker exec -u 0 wp_app chown 1000:1000 /var/www/html/wp-content/mu-plugins/$f
done
curl -s -o /dev/null -w "reconstruction FR %{http_code}\n" -H "Host: domainesolio.com" -H "X-Forwarded-Proto: https" http://localhost:8080/
curl -s -o /dev/null -w "reconstruction EN %{http_code}\n" -H "Host: domainesolio.com" -H "X-Forwarded-Proto: https" http://localhost:8080/en/'
echo "--- contrôles"
curl -s -o /dev/null -w "/en/ %{http_code} redirection=[%{redirect_url}]\n" https://domainesolio.com/en/
echo "IP du Pi dans l'accueil : $(curl -s https://domainesolio.com/ | grep -c 192.168.0.196)"
curl -s https://domainesolio.com/en/ | grep -oE '<title>[^<]+|og:locale" content="[^"]+|href="/en/(la-granja-gite|estiva-safari-tent)/"'
echo "H1 sur /cgv/ : $(curl -s https://domainesolio.com/cgv/ | grep -c '<h1')"
curl -s https://domainesolio.com/la-granja/ | grep -oE '"dateModified": "[^"]+"'
for u in /listing/fr/808379 /listing/en/806256 /en/life-on-the-estate; do curl -s -o /dev/null -w "$u -> %{http_code} %{redirect_url}\n" "https://domainesolio.com$u"; done
