import { setFavicon, DEFAULT_HREF, DYNAMIC_FLAG, __test } from '../setFavicon';

// JSDOM gives us a real `document` — we mutate it directly. Each test starts from a clean head.

beforeEach(() => {
  document.head.innerHTML = '';
});

function readIconLink() {
  return document.head.querySelector('link[rel~="icon"]');
}

describe('setFavicon', () => {
  test('inserts a single <link rel="icon"> with the supplied href + dynamic flag', () => {
    setFavicon({ href: '/uploads/company-logo.png' });

    const link = readIconLink();
    expect(link).not.toBeNull();
    expect(link.getAttribute('href')).toBe('/uploads/company-logo.png');
    expect(link.getAttribute(DYNAMIC_FLAG)).toBe('1');
    expect(link.getAttribute('type')).toBe('image/png');
    // Exactly one — never duplicates the default + the dynamic one.
    expect(document.head.querySelectorAll('link[rel~="icon"]').length).toBe(1);
  });

  test('removes every prior `<link rel="icon">` so the browser only sees the new one', () => {
    // Seed two competing icon links (e.g. the bundled defaults from index.html).
    document.head.innerHTML = `
      <link rel="icon" href="/favicon.ico" />
      <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
      <link rel="shortcut icon" href="/legacy.ico" />
    `;
    setFavicon({ href: '/uploads/logo.svg' });

    const links = document.head.querySelectorAll('link[rel~="icon"], link[rel="shortcut icon"]');
    expect(links.length).toBe(1);
    expect(links[0].getAttribute('href')).toBe('/uploads/logo.svg');
    expect(links[0].getAttribute('type')).toBe('image/svg+xml');
  });

  test('empty / null href restores the bundled default favicon path', () => {
    document.head.innerHTML = `<link rel="icon" href="/uploads/old-logo.png" data-dynamic-favicon="1" />`;
    setFavicon({ href: null });
    const link = readIconLink();
    expect(link.getAttribute('href')).toBe(DEFAULT_HREF);
    // The flag is still there (so future calls can detect it's our managed link).
    expect(link.getAttribute(DYNAMIC_FLAG)).toBe('1');
  });

  test('empty string href is treated the same as null (back to default)', () => {
    setFavicon({ href: '   ' });
    expect(readIconLink().getAttribute('href')).toBe(DEFAULT_HREF);
  });

  test('appends a cache-busting `?v=...` when a version token is supplied', () => {
    setFavicon({ href: '/uploads/logo.png', version: '2026-05-31T10:00:00Z' });
    expect(readIconLink().getAttribute('href'))
      .toBe('/uploads/logo.png?v=2026-05-31T10%3A00%3A00Z');
  });

  test('cache-buster respects an existing query string (uses & not ?)', () => {
    setFavicon({ href: '/uploads/logo.png?foo=bar', version: '7' });
    expect(readIconLink().getAttribute('href'))
      .toBe('/uploads/logo.png?foo=bar&v=7');
  });

  test('idempotent: calling setFavicon twice with the same input yields one link, not two', () => {
    setFavicon({ href: '/uploads/logo.png', version: '1' });
    setFavicon({ href: '/uploads/logo.png', version: '1' });
    expect(document.head.querySelectorAll('link[rel~="icon"]').length).toBe(1);
  });

  test('no document available → silent no-op (no throw)', () => {
    // Pass a `doc: null` to force the early return without monkey-patching the global document.
    expect(() => setFavicon({ href: '/x.png', doc: null })).not.toThrow();
  });
});

describe('mimeFromHref', () => {
  test.each([
    ['/x.png', 'image/png'],
    ['/x.PNG', 'image/png'],
    ['/x.jpg', 'image/jpeg'],
    ['/x.jpeg', 'image/jpeg'],
    ['/x.webp', 'image/webp'],
    ['/x.gif', 'image/gif'],
    ['/x.svg', 'image/svg+xml'],
    ['/x.ico', 'image/x-icon'],
    ['/x.png?v=42', 'image/png'],
    ['/no-extension', undefined],
  ])('mimeFromHref(%s) → %s', (input, expected) => {
    expect(__test.mimeFromHref(input)).toBe(expected);
  });
});
