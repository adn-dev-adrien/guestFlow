#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   DOMAIN=www.domainesolio.com \
#   WP_URL=http://192.168.0.196:8080 \
#   WP_DB_HOST=wp_db:3306 \
#   WP_DB_NAME=wordpress \
#   WP_DB_USER=wpuser \
#   WP_DB_PASSWORD='your-db-password' \
#   WP_CONTAINER=wp_app \
#   ./scripts/import_domain_to_wordpress.sh

DOMAIN="${DOMAIN:-www.domainesolio.com}"
WP_URL="${WP_URL:-http://192.168.0.196:8080}"
WP_DB_HOST="${WP_DB_HOST:-wp_db:3306}"
WP_DB_NAME="${WP_DB_NAME:-wordpress}"
WP_DB_USER="${WP_DB_USER:-wpuser}"
WP_DB_PASSWORD="${WP_DB_PASSWORD:-}"
WP_CONTAINER="${WP_CONTAINER:-wp_app}"
WORKDIR="${WORKDIR:-$PWD/.domain-migration}"
PUBLISH_STATUS="${PUBLISH_STATUS:-publish}"

if [[ -z "$WP_DB_PASSWORD" ]]; then
  echo "[ERROR] WP_DB_PASSWORD is required"
  exit 1
fi

for cmd in docker python3 curl; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "[ERROR] Missing required command: $cmd"
    exit 1
  fi
done

mkdir -p "$WORKDIR"
cd "$WORKDIR"

echo "[1/5] Preparing Python environment..."
python3 -m venv .venv
# shellcheck disable=SC1091
source .venv/bin/activate
pip install --quiet --upgrade pip
pip install --quiet requests beautifulsoup4 lxml trafilatura

cat > discover_and_extract.py << 'PY'
#!/usr/bin/env python3
import json
import re
import sys
import requests
import trafilatura
from bs4 import BeautifulSoup
from urllib.parse import urlparse, urljoin
from xml.etree import ElementTree as ET

DOMAIN = sys.argv[1]
base = f"https://{DOMAIN}"
session = requests.Session()
session.headers.update({"User-Agent": "Mozilla/5.0 (compatible; DomainMigrator/1.0)"})

def norm(url):
    u = url.strip()
    if not u:
        return ""
    if u.startswith("//"):
        u = "https:" + u
    if not u.startswith("http"):
        return ""
    parsed = urlparse(u)
    if parsed.netloc.replace("www.", "") != DOMAIN.replace("www.", ""):
        return ""
    clean = parsed._replace(fragment="", query="").geturl()
    return clean.rstrip("/") if parsed.path not in ["", "/"] else clean

def fetch(url):
    try:
        r = session.get(url, timeout=20)
        if r.status_code == 200:
            return r.text
    except Exception:
        pass
    return ""

def parse_sitemap(url, seen, urls):
    if url in seen:
        return
    seen.add(url)
    xml = fetch(url)
    if not xml:
        return
    try:
        root = ET.fromstring(xml)
    except Exception:
        return

    ns = "{http://www.sitemaps.org/schemas/sitemap/0.9}"

    # sitemapindex
    for loc in root.findall(f".//{ns}sitemap/{ns}loc"):
        child = (loc.text or "").strip()
        if child:
            parse_sitemap(child, seen, urls)

    # urlset
    for loc in root.findall(f".//{ns}url/{ns}loc"):
        u = norm(loc.text or "")
        if u:
            urls.add(u)

    # fallback without namespace
    for loc in root.findall(".//loc"):
        txt = (loc.text or "").strip()
        if not txt:
            continue
        if txt.endswith(".xml") and "sitemap" in txt:
            parse_sitemap(txt, seen, urls)
        else:
            u = norm(txt)
            if u:
                urls.add(u)


def crawl_fallback(start_url, limit=150):
    queue = [start_url]
    seen = set()
    urls = set()
    while queue and len(seen) < limit:
        cur = queue.pop(0)
        if cur in seen:
            continue
        seen.add(cur)
        html = fetch(cur)
        if not html:
            continue
        urls.add(cur)
        soup = BeautifulSoup(html, "lxml")
        for a in soup.find_all("a", href=True):
            u = norm(urljoin(cur, a["href"]))
            if not u:
                continue
            if u in seen:
                continue
            if any(x in u for x in ["/wp-json", "/feed", "/tag/", "/category/", "/author/"]):
                continue
            queue.append(u)
    return urls

# 1) discover URLs
all_urls = set()
seen_maps = set()

# robots.txt declared sitemaps
robots = fetch(f"{base}/robots.txt")
for line in robots.splitlines():
    if line.lower().startswith("sitemap:"):
        sm = line.split(":", 1)[1].strip()
        if sm:
            parse_sitemap(sm, seen_maps, all_urls)

# common sitemap locations
for sm in [f"{base}/sitemap.xml", f"{base}/sitemap_index.xml"]:
    parse_sitemap(sm, seen_maps, all_urls)

# fallback crawl if sitemap missing/poor
if len(all_urls) <= 1:
    all_urls |= crawl_fallback(base)

# prioritize short/simple URLs first
def sort_key(u):
    p = urlparse(u).path
    return (p.count("/"), len(p), p)

urls = sorted(all_urls, key=sort_key)
with open("urls.txt", "w", encoding="utf-8") as f:
    for u in urls:
        f.write(u + "\n")

# 2) extract page content
pages = []
used_slugs = set()
for url in urls:
    if any(x in url for x in ["/wp-json", "/feed", "/tag/", "/category/", "/author/"]):
        continue

    html = fetch(url)
    if not html:
        continue

    extracted = trafilatura.extract(
        html,
        output_format="html",
        include_links=True,
        include_images=True,
        favor_recall=True,
    )

    if not extracted:
        # fallback if extractor fails
        soup = BeautifulSoup(html, "lxml")
        main = soup.find("main") or soup.find("article") or soup.find("body")
        extracted = str(main) if main else ""

    if not extracted or len(extracted.strip()) < 80:
        continue

    soup = BeautifulSoup(html, "lxml")
    title = ""
    if soup.title and soup.title.text:
        title = soup.title.text.strip()
    if not title:
        h1 = soup.find("h1")
        title = h1.get_text(strip=True) if h1 else url

    parsed = urlparse(url)
    path = parsed.path.strip("/")
    slug = "accueil" if path == "" else path.split("/")[-1]
    slug = re.sub(r"[^a-zA-Z0-9-]", "-", slug.lower()).strip("-")
    if not slug:
        slug = "page"

    base_slug = slug
    i = 2
    while slug in used_slugs:
        slug = f"{base_slug}-{i}"
        i += 1
    used_slugs.add(slug)

    pages.append({
        "url": url,
        "title": title,
        "slug": slug,
        "content": extracted,
    })

with open("pages.json", "w", encoding="utf-8") as f:
    json.dump(pages, f, ensure_ascii=False, indent=2)

print(f"Discovered URLs: {len(urls)}")
print(f"Extracted pages: {len(pages)}")
PY

echo "[2/5] Discovering URLs and extracting page content..."
python discover_and_extract.py "$DOMAIN"

echo "[3/5] Importing pages into WordPress via wp-cli..."
python - << 'PY'
import json
import os
import subprocess
import tempfile

WP_CONTAINER = os.environ["WP_CONTAINER"]
WP_DB_HOST = os.environ["WP_DB_HOST"]
WP_DB_NAME = os.environ["WP_DB_NAME"]
WP_DB_USER = os.environ["WP_DB_USER"]
WP_DB_PASSWORD = os.environ["WP_DB_PASSWORD"]
WP_URL = os.environ["WP_URL"]
PUBLISH_STATUS = os.environ.get("PUBLISH_STATUS", "publish")
HOST_NAME = WP_URL.replace('http://','').replace('https://','')

pages = json.load(open("pages.json", "r", encoding="utf-8"))

created = 0
updated = 0
failed = 0

for page in pages:
    title = page["title"]
    slug = page["slug"]
    content = page["content"]

    # Create temporary file with content
    with tempfile.NamedTemporaryFile("w", suffix=".html", delete=False, encoding="utf-8") as tf:
      tf.write(content)
      content_file = tf.name

    # Check if page already exists
    inspect_cmd = [
      "docker", "run", "--rm",
      "--volumes-from", WP_CONTAINER,
      "--network", f"container:{WP_CONTAINER}",
      "--user", "33:33",
      "-e", f"WORDPRESS_DB_HOST={WP_DB_HOST}",
      "-e", f"WORDPRESS_DB_NAME={WP_DB_NAME}",
      "-e", f"WORDPRESS_DB_USER={WP_DB_USER}",
      "-e", f"WORDPRESS_DB_PASSWORD={WP_DB_PASSWORD}",
      "-e", f"HTTP_HOST={HOST_NAME}",
      "wordpress:cli",
      "wp", "post", "list",
      "--post_type=page",
      f"--name={slug}",
      "--field=ID",
      "--path=/var/www/html",
      f"--url={WP_URL}",
    ]

    result = subprocess.run(inspect_cmd, capture_output=True, text=True)
    existing_id = result.stdout.strip().splitlines()[0].strip() if result.stdout.strip() else ""

    # Build base command for create/update
    base_cmd = [
      "docker", "run", "--rm",
      "--volumes-from", WP_CONTAINER,
      "-v", f"{content_file}:/tmp/page_content.html:ro",
      "--network", f"container:{WP_CONTAINER}",
      "--user", "33:33",
      "-e", f"WORDPRESS_DB_HOST={WP_DB_HOST}",
      "-e", f"WORDPRESS_DB_NAME={WP_DB_NAME}",
      "-e", f"WORDPRESS_DB_USER={WP_DB_USER}",
      "-e", f"WORDPRESS_DB_PASSWORD={WP_DB_PASSWORD}",
      "-e", f"HTTP_HOST={HOST_NAME}",
      "wordpress:cli",
    ]

    if existing_id:
      # UPDATE existing page
      update_cmd = base_cmd + [
        "sh", "-c", (
          f"content=$(cat /tmp/page_content.html); "
          f'wp post update {existing_id} '
          f'--post_title={title!r} '
          f'--post_name={slug!r} '
          f'--post_status={PUBLISH_STATUS!r} '
          f'--path=/var/www/html --url={WP_URL!r} '
          f'<<EOF\n{content}\nEOF'
        )
      ]
      run = subprocess.run(update_cmd, capture_output=True, text=True)
      if run.returncode == 0:
        updated += 1
        print(f"[UPDATED] {title} ({slug})")
      else:
        failed += 1
        print(f"[FAILED UPDATE] {title} ({slug})")
        if run.stderr.strip():
          print(f"  Error: {run.stderr.strip()[:200]}")
    else:
      # CREATE new page using heredoc to pass content
      create_cmd = base_cmd + [
        "sh", "-c", (
          "exec wp post create "
          "--post_type=page "
          f"--post_title={title!r} "
          f"--post_name={slug!r} "
          f"--post_status={PUBLISH_STATUS!r} "
          f"--path=/var/www/html --url={WP_URL!r} "
          f"--prompt=post_content < /tmp/page_content.html"
        )
      ]
      run = subprocess.run(create_cmd, capture_output=True, text=True)
      if run.returncode == 0:
        created += 1
        print(f"[CREATED] {title} ({slug})")
      else:
        # Fallback: create without content first, then update
        create_cmd_basic = base_cmd + [
          "wp", "post", "create",
          "--post_type=page",
          f"--post_title={title}",
          f"--post_name={slug}",
          f"--post_status={PUBLISH_STATUS}",
          "--path=/var/www/html",
          f"--url={WP_URL}",
          "--field=ID",
        ]
        run_basic = subprocess.run(create_cmd_basic, capture_output=True, text=True)
        if run_basic.returncode == 0:
          new_id = run_basic.stdout.strip()
          # Now update with content using wp post update --stdin
          update_stdin_cmd = base_cmd + [
            "wp", "post", "update", new_id,
            "--path=/var/www/html",
            f"--url={WP_URL}",
            "--stdin",
          ]
          run_stdin = subprocess.run(update_stdin_cmd, input=content, capture_output=True, text=True)
          if run_stdin.returncode == 0:
            created += 1
            print(f"[CREATED] {title} ({slug}) [via stdin]")
          else:
            failed += 1
            print(f"[FAILED CREATE] {title} ({slug})")
            if run_stdin.stderr.strip():
              print(f"  Error: {run_stdin.stderr.strip()[:200]}")
        else:
          failed += 1
          print(f"[FAILED CREATE] {title} ({slug})")
          if run_basic.stderr.strip():
            print(f"  Error: {run_basic.stderr.strip()[:200]}")

print("---")
print(f"Created: {created}")
print(f"Updated: {updated}")
print(f"Failed: {failed}")
PY

echo "[4/5] Rewriting internal links to local WordPress URL..."
docker run --rm \
  --volumes-from "$WP_CONTAINER" \
  --network "container:$WP_CONTAINER" \
  --user 33:33 \
  -e WORDPRESS_DB_HOST="$WP_DB_HOST" \
  -e WORDPRESS_DB_NAME="$WP_DB_NAME" \
  -e WORDPRESS_DB_USER="$WP_DB_USER" \
  -e WORDPRESS_DB_PASSWORD="$WP_DB_PASSWORD" \
  -e HTTP_HOST="${WP_URL#http://}" \
  wordpress:cli \
  wp search-replace "https://$DOMAIN" "$WP_URL" --all-tables --precise --path=/var/www/html --url="$WP_URL" || true

echo "[5/5] Done."
echo "- URLs list:   $WORKDIR/urls.txt"
echo "- Pages JSON:  $WORKDIR/pages.json"
echo "- WP URL:      $WP_URL"
