#!/bin/sh
# Safari de Peaugres a 25 min (et non 20) dans la FAQ « avec enfants », les distances du llms.txt et la description par defaut.
set -e
cd "$(dirname "$0")"
MU=../../mu-plugins
H=adrien@192.168.0.23
for f in gf-seo-facts.php gf-seo-head.php; do scp -q $MU/$f $H:/tmp/$f; done
ssh $H 'set -e
for f in gf-seo-facts.php gf-seo-head.php; do
  docker cp /tmp/$f wp_app:/var/www/html/wp-content/mu-plugins/$f
  docker exec -u 0 wp_app chown 1000:1000 /var/www/html/wp-content/mu-plugins/$f
done'
echo "--- contrôles"
curl -s https://domainesolio.com/llms.txt | grep -o 'Safari de Peaugres [0-9]* min'
echo "mentions 20 min restantes sur Autour de nous : $(curl -s https://domainesolio.com/autour-de-nous/ | grep -c 'Peaugres à 20')"
