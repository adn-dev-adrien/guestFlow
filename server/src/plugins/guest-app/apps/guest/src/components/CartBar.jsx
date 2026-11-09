/**
 * CartBar — the floating pill above the tab bar (§6.4): count, « Voir le panier », the server's total. Slides
 * up the first time it appears; the count ticks when it changes.
 *
 * Props: `count`, `totalLabel` (the last quote's, or null while it is asked), `onOpen`.
 */
import { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n';

export default function CartBar({ count, totalLabel, onOpen }) {
  const t = useT();
  const first = useRef(true);
  const [tick, setTick] = useState(false);
  useEffect(() => {
    if (first.current) { first.current = false; return undefined; }
    setTick(true);
    const timer = setTimeout(() => setTick(false), 380);
    return () => clearTimeout(timer);
  }, [count]);
  return (
    <button type="button" className="cartbar arrive" onClick={onOpen}>
      <span className={`n${tick ? ' tick' : ''}`}>{count}</span>
      <b>{t('cart.view')}</b>
      <span aria-live="polite">{totalLabel || '…'}</span>
    </button>
  );
}
