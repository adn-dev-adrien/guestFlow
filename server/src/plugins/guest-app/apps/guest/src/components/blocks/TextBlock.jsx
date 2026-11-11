/**
 * TextBlock — rich text (rule 18 `text`): paragraphs, bold, italic, lists, links. The HTML is the server's,
 * already sanitised to that allow-list (`bookletBlocks.sanitizeRichText`). A web link opens in a new tab, so
 * the guest keeps the app where it was; `tel:` and `mailto:` stay as they are.
 */
import { useMemo } from 'react';

export function withExternalLinks(html) {
  return String(html || '').replace(/<a\s([^>]*)>/gi, (tag, attributes) => {
    if (!/\bhref="https:\/\//i.test(attributes)) return tag;
    const rest = attributes.replace(/\s*\b(?:target|rel)="[^"]*"/gi, '').trim();
    return `<a ${rest} target="_blank" rel="noopener noreferrer">`;
  });
}

export default function TextBlock({ block }) {
  const html = useMemo(() => withExternalLinks(block.html), [block.html]);
  // eslint-disable-next-line react/no-danger
  return <div className="btext" dangerouslySetInnerHTML={{ __html: html }} />;
}
