#!/usr/bin/env bash
set -euo pipefail

# Improved WordPress migration script
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
    except Exception as e:
        print(f"[FETCH ERROR] {url}: {e}", file=sys.stderr)
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
    except Exception as e:
        print(f"[SITEMAP PARSE ERROR] {url}: {e}", file=sys.stderr)
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

    # Primary extraction with trafilatura
    extracted = trafilatura.extract(
        html,
        output_format="html",
        include_links=True,
        include_images=True,
        favor_recall=True,
    )

    # Fallback to BeautifulSoup if trafilatura fails
    if not extracted:
        soup = BeautifulSoup(html, "lxml")
        
        # Try to find main content container
        main = soup.find("main") or soup.find("article")
        if main:
            extracted = str(main)
        else:
            # Last resort: extract all text from body
            body = soup.find("body")
            if body:
                # Remove script and style elements
                for script in body(["script", "style", "nav"]):
                    script.decompose()
                extracted = str(body)

    # Validate extraction
    if not extracted or len(extracted.strip()) < 80:
        continue

    # Extract title
    soup = BeautifulSoup(html, "lxml")
    title = ""
    if soup.title and soup.title.text:
        title = soup.title.text.strip()
    if not title:
        h1 = soup.find("h1")
        title = h1.get_text(strip=True) if h1 else url

    # Generate slug
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

print(f"Discovered {len(urls)} URLs", file=sys.stderr)
print(f"Extracted {len(pages)} pages", file=sys.stderr)

PY

echo "[2/5] Discovering URLs and extracting page content..."
python discover_and_extract.py "$DOMAIN" 2>&1

echo "[3/5] Importing pages into WordPress via wp-cli..."
python - << 'PY'
import json
import os
import subprocess
import sys

WP_CONTAINER = os.environ["WP_CONTAINER"]
WP_DB_HOST = os.environ["WP_DB_HOST"]
WP_DB_NAME = os.environ["WP_DB_NAME"]
WP_DB_USER = os.environ["WP_DB_USER"]
WP_DB_PASSWORD = os.environ["WP_DB_PASSWORD"]
WP_URL = os.environ["WP_URL"]
PUBLISH_STATUS = os.environ.get("PUBLISH_STATUS", "publish")

pages = json.load(open("pages.json", "r", encoding="utf-8"))

created = 0
updated = 0
failed = 0

for page in pages:
    title = page["title"]
    slug = page["slug"]
    content = page["content"]
    
    # Step 1: Check if page already exists
    inspect_cmd = [
        "docker", "run", "--rm",
        "--volumes-from", WP_CONTAINER,
        "--network", f"container:{WP_CONTAINER}",
        "--user", "33:33",
        "-e", f"WORDPRESS_DB_HOST={WP_DB_HOST}",
        "-e", f"WORDPRESS_DB_NAME={WP_DB_NAME}",
        "-e", f"WORDPRESS_DB_USER={WP_DB_USER}",
        "-e", f"WORDPRESS_DB_PASSWORD={WP_DB_PASSWORD}",
        "-e", f"HTTP_HOST={WP_URL.replace('http://','').replace('https://','')}",
        "wordpress:cli",
        "wp", "post", "list",
        "--post_type=page",
        "--name=" + slug,
        "--field=ID",
        "--path=/var/www/html",
        "--url=" + WP_URL,
    ]

    result = subprocess.run(inspect_cmd, capture_output=True, text=True)
    existing_id = result.stdout.strip().splitlines()[0].strip() if result.stdout.strip() else ""

    # Step 2: Create or update page, passing content via stdin
    if existing_id:
        # UPDATE: use stdin for content
        run_cmd = [
            "docker", "run", "--rm",
            "--volumes-from", WP_CONTAINER,
            "--interactive",
            "--network", f"container:{WP_CONTAINER}",
            "--user", "33:33",
            "-e", f"WORDPRESS_DB_HOST={WP_DB_HOST}",
            "-e", f"WORDPRESS_DB_NAME={WP_DB_NAME}",
            "-e", f"WORDPRESS_DB_USER={WP_DB_USER}",
            "-e", f"WORDPRESS_DB_PASSWORD={WP_DB_PASSWORD}",
            "-e", f"HTTP_HOST={WP_URL.replace('http://','').replace('https://','')}",
            "wordpress:cli",
            "wp", "post", "update", existing_id,
            "--post_title=" + title,
            "--post_name=" + slug,
            "--post_status=" + PUBLISH_STATUS,
            "--path=/var/www/html",
            "--url=" + WP_URL,
        ]
        
        run = subprocess.run(run_cmd, input=content, capture_output=True, text=True)
        if run.returncode == 0:
            updated += 1
            print(f"[UPDATED] {title} ({slug})")
        else:
            failed += 1
            print(f"[FAILED UPDATE] {title} ({slug})")
            print(run.stderr.strip() or run.stdout.strip())
    else:
        # CREATE: pass content via stdin
        run_cmd = [
            "docker", "run", "--rm",
            "--volumes-from", WP_CONTAINER,
            "--interactive",
            "--network", f"container:{WP_CONTAINER}",
            "--user", "33:33",
            "-e", f"WORDPRESS_DB_HOST={WP_DB_HOST}",
            "-e", f"WORDPRESS_DB_NAME={WP_DB_NAME}",
            "-e", f"WORDPRESS_DB_USER={WP_DB_USER}",
            "-e", f"WORDPRESS_DB_PASSWORD={WP_DB_PASSWORD}",
            "-e", f"HTTP_HOST={WP_URL.replace('http://','').replace('https://','')}",
            "wordpress:cli",
            "wp", "post", "create",
            "--post_type=page",
            "--post_title=" + title,
            "--post_name=" + slug,
            "--post_status=" + PUBLISH_STATUS,
            "--path=/var/www/html",
            "--url=" + WP_URL,
        ]
        
        run = subprocess.run(run_cmd, input=content, capture_output=True, text=True)
        if run.returncode == 0:
            created += 1
            print(f"[CREATED] {title} ({slug})")
        else:
            failed += 1
            print(f"[FAILED CREATE] {title} ({slug})")
            print(run.stderr.strip() or run.stdout.strip())

print(f"---")
print(f"Created: {created}, Updated: {updated}, Failed: {failed}")

PY

echo ""
echo "[4/5] Running link replacement (domain → localhost)..."
docker run --rm \
  --volumes-from "$WP_CONTAINER" \
  --network "container:$WP_CONTAINER" \
  --user "33:33" \
  -e "WORDPRESS_DB_HOST=$WP_DB_HOST" \
  -e "WORDPRESS_DB_NAME=$WP_DB_NAME" \
  -e "WORDPRESS_DB_USER=$WP_DB_USER" \
  -e "WORDPRESS_DB_PASSWORD=$WP_DB_PASSWORD" \
  -e "HTTP_HOST=${WP_URL#*://}" \
  wordpress:cli \
  wp search-replace \
  "https://$DOMAIN" \
  "$WP_URL" \
  --path=/var/www/html \
  --url="$WP_URL" || echo "⚠ Link replacement completed with warnings"

echo ""
echo "[5/5] Migration summary"
echo "Migration complete! Check your WordPress installation:"
echo "  URL: $WP_URL"
echo "  For debugging: DOMAIN=$DOMAIN ./scripts/debug-migration.sh"
