#!/bin/sh
# La Granja : champs exiges par les resultats enrichis « location de vacances » de Google
# (identifier, latitude/longitude, heures ISO 8601, additionalType) ; plus d'offre sur le VacationRental.
set -e
cd "$(dirname "$0")"
F=gf-seo-schema.php
H=adrien@192.168.0.23
scp -q ../../mu-plugins/$F $H:/tmp/$F
ssh $H "docker cp /tmp/$F wp_app:/var/www/html/wp-content/mu-plugins/$F && docker exec -u 0 wp_app chown 1000:1000 /var/www/html/wp-content/mu-plugins/$F"
echo "--- contrôle (doit afficher identifier, latitude, checkinTime 16:00:00+0X:00, pas de makesOffer)"
for p in la-granja en/la-granja-gite; do
  curl -s "https://domainesolio.com/$p/?v=$$" | python3 -c '
import sys,re,json
for b in re.findall(r"<script type=\"application/ld\+json\"[^>]*>(.*?)</script>",sys.stdin.read(),re.S):
  for n in json.loads(b).get("@graph",[]):
    if n.get("@type")=="VacationRental":
      print(n.get("identifier"),n.get("latitude"),n.get("checkinTime"),n.get("additionalType"),"makesOffer" in n)'
done
