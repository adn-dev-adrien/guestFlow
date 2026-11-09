// specs/guest-app.md rule 18 — the studio's rich-text notation: what the operator types becomes the markup the server
// keeps, and stored markup reads back into the same notation.
import { describe, expect, it } from 'vitest';
import { toHtml, toNotation } from '../utils/richText';

describe('richText (rule 18)', () => {
  it('paragraphs, line breaks, bold, italic, lists and safe links', () => {
    expect(toHtml('Bonjour **Marie**\nà *bientôt*\n\n- un\n- deux\n\n1. a\n2. b\n\n[Appeler](tel:+33612345678)'))
      .toBe('<p>Bonjour <strong>Marie</strong><br>à <em>bientôt</em></p><ul><li>un</li><li>deux</li></ul><ol><li>a</li><li>b</li></ol><p><a href="tel:+33612345678">Appeler</a></p>');
  });

  it('escapes markup and keeps an unsafe link as text', () => {
    expect(toHtml('<script>x</script> [clic](javascript:alert(1))')).toBe('<p>&lt;script&gt;x&lt;/script&gt; [clic](javascript:alert(1))</p>');
  });

  it('round-trips stored markup', () => {
    const html = '<p>Le <strong>poêle</strong> se charge <em>par le haut</em>.</p><ul><li>bois sec</li><li><a href="https://example.com/doc">la notice</a></li></ul>';
    expect(toHtml(toNotation(html))).toBe(html);
    expect(toNotation('')).toBe('');
  });
});
