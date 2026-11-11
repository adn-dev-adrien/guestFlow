/**
 * The three layouts of rule 51: phone, tablet (≥ 900 px: rail, two panes, dialogs) and desktop (≥ 1200 px:
 * content capped at 1200 px, six tiles in a row, wider hero).
 */
import { useEffect, useState } from 'react';

const WIDE = '(min-width: 900px)';
const DESK = '(min-width: 1200px)';

const matches = (q) => typeof window !== 'undefined' && Boolean(window.matchMedia) && window.matchMedia(q).matches;

export function useLayout() {
  const [layout, setLayout] = useState(() => ({ wide: matches(WIDE), desk: matches(DESK) }));
  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const lists = [window.matchMedia(WIDE), window.matchMedia(DESK)];
    const update = () => setLayout({ wide: lists[0].matches, desk: lists[1].matches });
    lists.forEach((l) => l.addEventListener?.('change', update));
    return () => lists.forEach((l) => l.removeEventListener?.('change', update));
  }, []);
  return layout;
}
