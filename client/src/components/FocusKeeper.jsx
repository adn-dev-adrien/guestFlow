/**
 * FocusKeeper — a region that never lets the keyboard focus fall to the page when the control holding it goes away
 * (specs/plugins-phase-1-sdk.md rule 54, reading 2026-11-18, loop t22 UI22-1).
 *
 * A sale dialog swaps blocks when the server answers: a refusal replaces the « Facture » checkbox and its address, a payment link
 * replaces « Créer le lien », a collected line folds under « Déjà payé », a failed preview's « Réessayer » goes when it is clicked.
 * When the focused control is removed, disabled or hidden that way, the browser puts the focus on the page body and the operator
 * loses their place. The region watches its subtree and, in that case only, moves the focus to the nearest region still drawn
 * around the lost control: the closest ancestor marked `data-focus-anchor` (a FocusKeeper is one), so Tab resumes from there.
 * It never takes the focus from anywhere else, and a control the operator left on purpose is forgotten.
 *
 * Props: any Box prop (`sx`, `component`, `data-testid`…); children.
 */
import React, { useCallback, useRef } from 'react';
import { Box } from '@mui/material';

const isHidden = (element) => {
  if (!element.isConnected) return true;
  const view = element.ownerDocument.defaultView;
  const style = view ? view.getComputedStyle(element) : null;
  return Boolean(style && (style.visibility === 'hidden' || style.display === 'none'));
};
const isLost = (element) => !element.isConnected || element.disabled === true || element.getAttribute('aria-disabled') === 'true' || isHidden(element);

export default function FocusKeeper({ children, sx, ...rest }) {
  const record = useRef(null);
  const cleanup = useRef(null);

  const attach = useCallback((root) => {
    if (cleanup.current) { cleanup.current(); cleanup.current = null; }
    if (!root) return;
    const onFocusIn = (event) => {
      if (event.target === root) { record.current = null; return; }
      const anchors = [];
      for (let node = event.target.parentElement; node && node !== root; node = node.parentElement) {
        if (node.hasAttribute('data-focus-anchor')) anchors.push(node);
      }
      anchors.push(root);
      record.current = { target: event.target, anchors };
    };
    const onFocusOut = (event) => {
      // Left on purpose (a click elsewhere, Tab): forget it. A browser may blur a control while removing it, before it is disconnected,
      // so the verdict waits for the end of the current change: a control removed, disabled or hidden while focused is still remembered.
      const left = event.target;
      queueMicrotask(() => {
        if (record.current && record.current.target === left && !isLost(left) && root.ownerDocument.activeElement !== left) record.current = null;
      });
    };
    const observer = typeof MutationObserver === 'function' ? new MutationObserver(() => {
      const held = record.current;
      if (!held || !isLost(held.target)) return;
      const doc = root.ownerDocument;
      const active = doc.activeElement;
      // The focus went somewhere the operator chose: leave it. The page, the lost control itself, or a container around this region
      // (a dialog's focus trap catching the loss first) all mean the focus was lost.
      const chosen = active && active !== doc.body && active !== held.target && !active.contains(root);
      if (chosen) { record.current = null; return; }
      const anchor = held.anchors.find((node) => node.isConnected && !isHidden(node));
      record.current = null;
      if (anchor) anchor.focus({ preventScroll: true });
    }) : null;
    root.addEventListener('focusin', onFocusIn);
    root.addEventListener('focusout', onFocusOut);
    if (observer) observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['disabled', 'aria-disabled', 'class', 'style', 'aria-hidden'] });
    cleanup.current = () => {
      root.removeEventListener('focusin', onFocusIn);
      root.removeEventListener('focusout', onFocusOut);
      if (observer) observer.disconnect();
    };
  }, []);

  return (
    <Box ref={attach} tabIndex={-1} data-focus-anchor="" sx={[{ outline: 'none' }, ...(Array.isArray(sx) ? sx : [sx])]} {...rest}>
      {children}
    </Box>
  );
}
