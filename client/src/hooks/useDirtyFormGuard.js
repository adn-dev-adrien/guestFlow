/**
 * useDirtyFormGuard — encapsulates the "form has unsaved changes" UX:
 *
 *  - Detects dirty state via JSON.stringify deep-equal between `draft` and `saved`.
 *  - Hooks the project-wide `window.__guestflowBeforeNavigate` mechanism
 *    (intercepts internal sidebar/router navigation) — ONLY WHILE DIRTY. The slot is a single global:
 *    the guard takes it when the form becomes dirty and puts the previous handler back when it is clean
 *    or unmounted, so a clean page, a closed panel or two mounted forms never hold or erase each
 *    other's guard.
 *  - Adds a `beforeunload` listener so the browser warns on tab close/reload.
 *  - Holds the `window.__guestflowBeforeBack` slot (unless `guardBack: false`) so the interceptor of
 *    utils/backGuard.js — installed before the router, because the router's own popstate listener
 *    would otherwise unmount the form first — prompts before back/forward navigation; the page's own
 *    entry is put back with ITS state and ITS URL (the URL the browser already moved away from is
 *    never kept). Both slots re-check that the form is still dirty before blocking anything.
 *
 * Returns:
 *  - `isDirty: boolean`
 *  - `guardDialogOpen: boolean` — true when navigation has been intercepted
 *  - `openGuard(): void`         — manually open the dialog
 *  - `dismissGuard(): void`      — close the dialog, cancel the pending navigation
 *  - `confirmLeave(): void`      — close the dialog and navigate to the pending path
 *
 * Usage:
 *
 *   const navigate = useNavigate();
 *   const { isDirty, guardDialogOpen, dismissGuard, confirmLeave } =
 *     useDirtyFormGuard({ draft, saved, navigate });
 *
 *   ...
 *
 *   <ConfirmDialog open={guardDialogOpen} onClose={dismissGuard} onConfirm={confirmLeave} ... />
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export default function useDirtyFormGuard({
  draft, saved, navigate, guardBack = true,
}) {
  const isDirty = useMemo(() => {
    try {
      return JSON.stringify(draft) !== JSON.stringify(saved);
    } catch (_) {
      return false;
    }
  }, [draft, saved]);

  const pendingNavRef = useRef(null);
  const dirtyRef = useRef(false);
  const leavingRef = useRef(false);
  const [guardDialogOpen, setGuardDialogOpen] = useState(false);

  useEffect(() => {
    dirtyRef.current = isDirty;
  }, [isDirty]);

  // Takes a global slot (`window[slot]`) for as long as `active`, and puts the previous holder back. The
  // handler re-checks `dirtyRef`: when two forms release out of order the restored handler may belong to
  // a form that is clean by now, and a clean form must never block anything.
  const holdSlot = (slot, handler) => {
    const previous = window[slot];
    window[slot] = handler;
    return () => {
      if (window[slot] !== handler) return;
      if (previous) window[slot] = previous;
      else delete window[slot];
    };
  };

  // Sidebar / router-level navigation (clicks): held only while dirty.
  useEffect(() => {
    if (!isDirty) return undefined;
    return holdSlot('__guestflowBeforeNavigate', (targetPath) => {
      if (!dirtyRef.current || !targetPath || targetPath === window.location.pathname) return false;
      pendingNavRef.current = targetPath;
      setGuardDialogOpen(true);
      return true; // signal: navigation blocked
    });
  }, [isDirty]);

  // Tab close / reload guard.
  useEffect(() => {
    if (!isDirty) return undefined;
    const handler = (e) => {
      e.preventDefault();
      // Some browsers require returnValue to be set.
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  // Browser back/forward: the interceptor of utils/backGuard.js asks this handler. It answers the page's
  // own history entry — its state and ITS URL, never the one the browser already moved to — to be put back.
  useEffect(() => {
    if (!isDirty || !guardBack) return undefined;
    const keep = { state: window.history.state, url: window.location.href };
    return holdSlot('__guestflowBeforeBack', () => {
      if (!dirtyRef.current || leavingRef.current) return null;
      pendingNavRef.current = null;
      setGuardDialogOpen(true);
      return keep;
    });
  }, [isDirty, guardBack]);

  const openGuard = useCallback(() => setGuardDialogOpen(true), []);

  const dismissGuard = useCallback(() => {
    pendingNavRef.current = null;
    setGuardDialogOpen(false);
  }, []);

  const confirmLeave = useCallback(() => {
    setGuardDialogOpen(false);
    const dest = pendingNavRef.current;
    pendingNavRef.current = null;
    if (typeof navigate === 'function') {
      if (dest) {
        navigate(dest);
      } else {
        leavingRef.current = true; // the pop this triggers must not be blocked again
        navigate(-1);
      }
    }
  }, [navigate]);

  return {
    isDirty,
    guardDialogOpen,
    openGuard,
    dismissGuard,
    confirmLeave,
  };
}
