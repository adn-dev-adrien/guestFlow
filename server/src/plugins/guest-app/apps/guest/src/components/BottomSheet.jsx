/**
 * BottomSheet — the sheet of the phone, the centred dialog of the tablet and the desktop (§6.4, §6.6
 * Responsive: max 560 px from 900 px). Built on MUI's Modal for the focus trap, Escape and scroll lock; the
 * look is the boards' `.layer` / `.sheet`.
 *
 * The grab handle follows the finger 1:1 and lets go with the finger's speed: a pull past a third of the
 * sheet, or a flick, closes it; anything less springs back (apple-design: direct manipulation, momentum).
 *
 * Props: `open`, `onClose`, `label` (accessible name) or `labelledBy`, `children`, `as` ('div' | 'form'),
 * `onSubmit` (with `as="form"`).
 */
import { useEffect, useRef, useState } from 'react';
import Modal from '@mui/material/Modal';

const CLOSE_MS = 240;

export default function BottomSheet({
  open, onClose, label, labelledBy, children, as: Tag = 'div', onSubmit,
}) {
  const [closing, setClosing] = useState(false);
  const sheet = useRef(null);
  const drag = useRef(null);

  useEffect(() => { if (open) setClosing(false); }, [open]);

  const close = () => {
    if (closing) return;
    const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) { onClose(); return; }
    setClosing(true);
    setTimeout(onClose, CLOSE_MS);
  };

  const onPointerDown = (e) => {
    if (!sheet.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { y: e.clientY, t: performance.now(), dy: 0, v: 0 };
    sheet.current.style.transition = 'none';
  };
  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d) return;
    const dy = Math.max(0, e.clientY - d.y);
    const now = performance.now();
    d.v = (dy - d.dy) / Math.max(1, now - d.t);
    d.dy = dy;
    d.t = now;
    sheet.current.style.transform = `translateY(${dy}px)`;
  };
  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d || !sheet.current) return;
    const el = sheet.current;
    if (d.dy > el.offsetHeight / 3 || d.v > 0.6) {
      el.style.transition = 'transform .22s cubic-bezier(.32,.72,0,1)';
      el.style.transform = 'translateY(100%)';
      setTimeout(onClose, 200);
    } else {
      el.style.transition = 'transform .3s cubic-bezier(.22,1,.36,1)';
      el.style.transform = '';
    }
  };

  return (
    <Modal open={open} onClose={close} hideBackdrop disablePortal disableScrollLock={false} aria-label={label} aria-labelledby={labelledBy}>
      <div className="layer" style={{ position: 'absolute', inset: 0 }}>
        <div className="scrimall" onClick={close} aria-hidden="true" style={closing ? { opacity: 0, transition: 'opacity .22s' } : undefined} />
        <Tag
          ref={sheet}
          className={`sheet${closing ? ' closing' : ''}`}
          role="dialog"
          aria-modal="true"
          aria-label={labelledBy ? undefined : label}
          aria-labelledby={labelledBy}
          onSubmit={onSubmit}
          noValidate={Tag === 'form' ? true : undefined}
        >
          <div className="grabzone" aria-hidden="true" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
            <div className="grab" />
          </div>
          {children}
        </Tag>
      </div>
    </Modal>
  );
}
