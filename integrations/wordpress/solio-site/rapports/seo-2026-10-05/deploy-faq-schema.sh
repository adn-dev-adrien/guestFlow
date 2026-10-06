#!/bin/sh
# FAQ du JSON-LD : decode les entites HTML (&nbsp;, &rsquo;) lues dans le contenu des pages.
set -e
cd "$(dirname "$0")"
F=gf-seo-schema.php
H=adrien@192.168.0.23
scp -q ../../mu-plugins/$F $H:/tmp/$F
ssh $H "docker cp /tmp/$F wp_app:/var/www/html/wp-content/mu-plugins/$F && docker exec -u 0 wp_app chown 1000:1000 /var/www/html/wp-content/mu-plugins/$F"
echo "--- contrôle (doit afficher 0)"
curl -s "https://domainesolio.com/autour-de-nous/?v=$$" | grep -cE '"(name|text)": ".*&(nbsp|rsquo);' || true
