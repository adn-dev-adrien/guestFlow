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
 *  - Listens to `popstate` (unless `guardBack: false`) so the user is prompted before back/forward
 *    navigation; the page's own entry is put back with ITS state and ITS URL (the URL the browser
 *    already moved away from is never kept).
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
  const [guardDialogOpen, setGuardDialogOpen] = useState(false);

  // Project-wide navigation guard (sidebar / router-level): held only while dirty, previous one restored.
  useEffect(() => {
    if (!isDirty) return undefined;
    const previous = window.__guestflowBeforeNavigate;
    const guardHandler = (targetPath) => {
      if (!targetPath || targetPath === window.location.pathname) return false;
      pendingNavRef.current = targetPath;
      setGuardDialogOpen(true);
      return true; // signal: navigation blocked
    };
    window.__guestflowBeforeNavigate = guardHandler;
    return () => {
      if (window.__guestflowBeforeNavigate !== guardHandler) return;
      if (previous) window.__guestflowBeforeNavigate = previous;
      else delete window.__guestflowBeforeNavigate;
    };
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

  // Browser back/forward guard.
  useEffect(() => {
    if (!isDirty || !guardBack) return undefined;
    const pageState = window.history.state;
    const pageUrl = window.location.href;
    const handler = () => {
      pendingNavRef.current = null;
      setGuardDialogOpen(true);
      // Keep the URL where it was.
      // The page's own router state, not null: a null entry loses `idx`, and the next « Retour » would
      // think the page was opened directly (specs/ui-review-2026-10-19-operations.md rule 26).
      window.history.pushState(pageState, '', pageUrl);
    };
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
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
      if (dest) navigate(dest);
      else navigate(-1);
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
