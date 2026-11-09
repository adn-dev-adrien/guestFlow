// specs/guest-app.md rules 15, 18 — Soliomap opens in the app only on its own origin, a suggestion with a bad
// link costs the home nothing, and a booklet's web links open in a new tab without handing over the app.
import { renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { soliomapUrl } from '../pages/SoliomapPage';
import { withExternalLinks } from '../components/blocks/TextBlock';
import { useActions } from '../hooks/useActions';
import { SessionContext } from '../hooks/useSession';

const BASE = 'https://map.domainesolio.com';

describe('Soliomap — the address asked for (rule 15)', () => {
  it('keeps a place on Soliomap\'s own origin', () => {
    expect(soliomapUrl(`${BASE}/lieu/lavoir`, BASE)).toBe(`${BASE}/lieu/lavoir`);
    expect(soliomapUrl(null, BASE)).toBe(BASE);
  });

  it('refuses a look-alike host, a user-info trick and garbage, falling back to Soliomap', () => {
    expect(soliomapUrl('https://map.domainesolio.com.evil.tld/x', BASE)).toBe(BASE);
    expect(soliomapUrl('https://map.domainesolio.com@evil.tld/x', BASE)).toBe(BASE);
    expect(soliomapUrl('http://map.domainesolio.com/x', BASE)).toBe(BASE);
    expect(soliomapUrl('not a url', BASE)).toBe(BASE);
    expect(soliomapUrl('https://map.domainesolio.com/x', null)).toBeNull();
  });
});

describe('useActions — a suggestion with a bad link (rule 15)', () => {
  it('does not throw and leaves Soliomap out', () => {
    const value = { me: { suggestion: { url: 'pas une adresse' } }, lodging: {} };
    const wrapper = ({ children }) => <MemoryRouter><SessionContext.Provider value={value}>{children}</SessionContext.Provider></MemoryRouter>;
    const { result } = renderHook(() => useActions(), { wrapper });
    expect(result.current.soliomapEmbedded).toBe(false);
  });
});

describe('TextBlock — web links (rule 18)', () => {
  it('opens https links in a new tab with noopener noreferrer, and leaves tel: and mailto: alone', () => {
    const html = '<p><a href="https://example.test/a" rel="noopener noreferrer">site</a> <a href="tel:+33600000000">Appeler</a> <a href="mailto:a@b.fr">Écrire</a></p>';
    const out = withExternalLinks(html);
    expect(out).toContain('<a href="https://example.test/a" target="_blank" rel="noopener noreferrer">site</a>');
    expect(out).toContain('<a href="tel:+33600000000">Appeler</a>');
    expect(out).toContain('<a href="mailto:a@b.fr">Écrire</a>');
    expect(withExternalLinks('<a href="https://x.test" target="_self">x</a>')).toBe('<a href="https://x.test" target="_blank" rel="noopener noreferrer">x</a>');
  });
});
