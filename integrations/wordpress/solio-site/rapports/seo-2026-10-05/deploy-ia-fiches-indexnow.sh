#!/bin/sh
# Fiches publiques du domaine en sameAs et dans llms.txt, puis IndexNow : la cle est publiee,
# et toutes les pages du sitemap sont signalees une premiere fois a Bing.
set -e
cd "$(dirname "$0")"
MU=../../mu-plugins
H=adrien@192.168.0.23
FICHIERS="gf-seo-facts.php gf-seo-schema.php gf-seo-indexation.php"
for f in $FICHIERS; do scp -q $MU/$f $H:/tmp/$f; done
ssh $H "set -e; for f in $FICHIERS; do docker cp /tmp/\$f wp_app:/var/www/html/wp-content/mu-plugins/\$f; docker exec -u 0 wp_app chown 1000:1000 /var/www/html/wp-content/mu-plugins/\$f; done"

CLE=$(sed -n "s/^const GF_INDEXNOW_CLE = '\([a-f0-9]*\)';/\1/p" $MU/gf-seo-indexation.php)
echo "--- contrôles"
echo "clé IndexNow servie : $(curl -s "https://domainesolio.com/$CLE.txt")  (attendu : $CLE)"
echo "fiches dans llms.txt : $(curl -s "https://domainesolio.com/llms.txt?v=$$" | grep -c '^- .* : https')"
curl -s "https://domainesolio.com/la-granja/?v=$$" | python3 -c '
import sys,re,json
for b in re.findall(r"<script type=\"application/ld\+json\"[^>]*>(.*?)</script>",sys.stdin.read(),re.S):
  for n in json.loads(b).get("@graph",[]):
    if n.get("@type") in ("LodgingBusiness","VacationRental"): print("sameAs", n["@type"], len(n.get("sameAs",[])))'

echo "--- premier signal IndexNow (attendu : 200 ou 202)"
URLS=$(curl -s https://domainesolio.com/wp-sitemap-posts-page-1.xml https://domainesolio.com/en/wp-sitemap-posts-page-1.xml | grep -o '<loc>[^<]*</loc>' | sed 's/<\/*loc>//g' | python3 -c 'import sys,json;print(json.dumps([l.strip() for l in sys.stdin if l.strip()]))')
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://api.indexnow.org/indexnow \
  -H 'Content-Type: application/json; charset=utf-8' \
  -d "{\"host\":\"domainesolio.com\",\"key\":\"$CLE\",\"keyLocation\":\"https://domainesolio.com/$CLE.txt\",\"urlList\":$URLS}"
