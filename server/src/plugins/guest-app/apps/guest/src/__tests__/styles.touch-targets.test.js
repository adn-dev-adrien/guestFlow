// specs/guest-app.md §6.4 « Accessibility » — 44 px touch targets for the app bar's action and the wifi's « Copier »,
// and a visible focus ring on the booklet's search field (its input drops the global outline).
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const CSS = fs.readFileSync(path.resolve(__dirname, '../styles.css'), 'utf8');

/** Every declaration block whose selector list contains `selector`, joined. */
function rulesFor(selector) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(CSS))) {
    if (m[1].split(',').map((s) => s.trim()).includes(selector)) out.push(m[2]);
  }
  return out.join(';');
}

const minHeight = (selector) => Math.max(...[...rulesFor(selector).matchAll(/min-height:\s*(\d+)px/g)].map((m) => Number(m[1])));

describe('styles — touch targets and focus', () => {
  it('the app bar action and the wifi button are at least 44 px high', () => {
    expect(minHeight('.appbar .act')).toBeGreaterThanOrEqual(44);
    expect(minHeight('.wifi .btn')).toBeGreaterThanOrEqual(44);
  });

  it('the booklet search shows a focus ring, not only a border colour', () => {
    expect(rulesFor('.search:focus-within')).toMatch(/box-shadow:\s*0 0 0 3px var\(--ring\)/);
  });

  it('a sheet\'s close button is a 44 px target', () => {
    expect(rulesFor('.x')).toMatch(/width:\s*44px;height:\s*44px/);
  });
});
