import { useCallback, useEffect, useState } from 'react';

/**
 * useElementWidth — the measured width of an element, kept current by a ResizeObserver
 * (specs/report-grammar.md rule 35: a chart thins its labels from the room it really has, not from the
 * window's breakpoint). Returns a callback ref and the width: `null` until measured, or where
 * ResizeObserver does not exist (tests). The element may mount later (an empty chart that fills).
 *
 * @returns {[(el: Element|null) => void, number|null]}
 */
export default function useElementWidth() {
  const [el, setEl] = useState(null);
  const [width, setWidth] = useState(null);
  const ref = useCallback((node) => setEl(node), []);
  useEffect(() => {
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, [el]);
  return [ref, width];
}
