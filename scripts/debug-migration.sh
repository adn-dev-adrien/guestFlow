#!/usr/bin/env bash
set -euo pipefail

# Debug script to diagnose WordPress migration issues
# Usage: DOMAIN=www.domainesolio.com ./scripts/debug-migration.sh

DOMAIN="${DOMAIN:-www.domainesolio.com}"
WORKDIR="${WORKDIR:-$PWD/.domain-migration}"

if [[ ! -d "$WORKDIR" ]]; then
  echo "[ERROR] Migration directory not found: $WORKDIR"
  echo "Run import_domain_to_wordpress.sh first"
  exit 1
fi

cd "$WORKDIR"

echo "=========================================="
echo "WordPress Migration Debug Report"
echo "=========================================="
echo ""

# 1. Check if urls.txt exists
echo "[1] URL Discovery"
echo "----------------------------------------"
if [[ -f urls.txt ]]; then
  URL_COUNT=$(wc -l < urls.txt)
  echo "✓ urls.txt found ($URL_COUNT URLs)"
  echo "First 5 URLs:"
  head -5 urls.txt | sed 's/^/  /'
  echo ""
else
  echo "✗ urls.txt not found - URL discovery failed"
  exit 1
fi

# 2. Check if pages.json exists and inspect content
echo "[2] Content Extraction"
echo "----------------------------------------"
if [[ -f pages.json ]]; then
  python3 << 'PY'
import json
import os

with open("pages.json", "r", encoding="utf-8") as f:
    pages = json.load(f)

total_pages = len(pages)
print(f"✓ pages.json found ({total_pages} pages)")
print("")

if not pages:
    print("✗ No pages extracted - content extraction failed!")
    exit(1)

# Analyze content
empty_count = 0
short_count = 0
full_count = 0

for page in pages:
    content_len = len(page.get("content", ""))
    if content_len == 0:
        empty_count += 1
    elif content_len < 100:
        short_count += 1
    else:
        full_count += 1

print(f"Content distribution:")
print(f"  Full content (>100 chars): {full_count}")
print(f"  Short content (1-100 chars): {short_count}")
print(f"  Empty content: {empty_count}")
print("")

# Show details of first 3 pages
print("First 3 pages:")
for i, page in enumerate(pages[:3]):
    content_preview = page.get("content", "")[:100].replace("\n", " ")
    content_len = len(page.get("content", ""))
    print(f"  [{i+1}] {page['slug']}")
    print(f"      Title: {page['title']}")
    print(f"      Content length: {content_len} chars")
    if content_len > 0:
        print(f"      Preview: {content_preview}...")
    else:
        print(f"      Preview: [EMPTY]")
    print("")

if empty_count == total_pages:
    print("✗ ALL pages have empty content - extraction completely failed!")
elif empty_count > 0:
    print(f"⚠ {empty_count} pages have empty content - extraction partially failed")

PY

else
  echo "✗ pages.json not found - content extraction may have failed"
  exit 1
fi

# 3. Test trafilatura directly on one page
echo "[3] Direct Trafilatura Test"
echo "----------------------------------------"
python3 << 'PY'
import sys
import requests
import trafilatura
from bs4 import BeautifulSoup

domain = "www.domainesolio.com"
test_url = f"https://{domain}"

print(f"Testing trafilatura on: {test_url}")
print("")

try:
    # Fetch the page
    session = requests.Session()
    session.headers.update({"User-Agent": "Mozilla/5.0"})
    response = session.get(test_url, timeout=10)
    
    if response.status_code != 200:
        print(f"✗ Failed to fetch page (HTTP {response.status_code})")
        sys.exit(1)
    
    html = response.text
    print(f"✓ Page fetched ({len(html)} bytes)")
    print("")
    
    # Try trafilatura
    print("Attempting content extraction:")
    extracted = trafilatura.extract(
        html,
        output_format="html",
        include_links=True,
        include_images=True,
        favor_recall=True,
    )
    
    if extracted:
        print(f"  ✓ trafilatura succeeded ({len(extracted)} chars)")
        print(f"    Preview: {extracted[:150].replace(chr(10), ' ')}...")
    else:
        print(f"  ✗ trafilatura returned None or empty")
        
        # Try fallback
        print("")
        print("Trying fallback (BeautifulSoup):")
        soup = BeautifulSoup(html, "lxml")
        main = soup.find("main") or soup.find("article") or soup.find("body")
        fallback = str(main) if main else ""
        
        if fallback and len(fallback) > 80:
            print(f"  ✓ fallback succeeded ({len(fallback)} chars)")
            print(f"    Preview: {fallback[:150]}...")
        else:
            print(f"  ✗ fallback failed or too short")
    
except Exception as e:
    print(f"✗ Error during extraction: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)

PY

echo ""
echo "[4] Database Check"
echo "----------------------------------------"
echo "Check WordPress database for imported pages:"
echo "  Run this command on your RPi:"
echo "  $ docker exec wp_db mysql -u wpuser -p<password> wordpress -e"
echo "    \"SELECT ID, post_title, LENGTH(post_content) as content_len FROM wp_posts"
echo "     WHERE post_type='page' LIMIT 5;\""
echo ""
echo "=========================================="
echo "Diagnostic complete"
echo "=========================================="
