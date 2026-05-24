/**
 * useDirtyFormGuard — encapsulates the "form has unsaved changes" UX:
 *
 *  - Detects dirty state via JSON.stringify deep-equal between `draft` and `saved`.
 *  - Hooks the project-wide `window.__guestflowBeforeNavigate` mechanism
 *    (intercepts internal sidebar/router navigation while dirty).
 *  - Adds a `beforeunload` listener so the browser warns on tab close/reload.
 *  - Listens to `popstate` so the user is prompted before back/forward navigation.
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

export default function useDirtyFormGuard({ draft, saved, navigate }) {
  const isDirty = useMemo(() => {
    try {
      return JSON.stringify(draft) !== JSON.stringify(saved);
    } catch (_) {
      return false;
    }
  }, [draft, saved]);

  const dirtyRef = useRef(false);
  const pendingNavRef = useRef(null);
  const [guardDialogOpen, setGuardDialogOpen] = useState(false);

  useEffect(() => {
    dirtyRef.current = isDirty;
  }, [isDirty]);

  // Project-wide navigation guard (sidebar / router-level).
  useEffect(() => {
    const guardHandler = (targetPath) => {
      if (!dirtyRef.current) return false;
      if (!targetPath || targetPath === window.location.pathname) return false;
      pendingNavRef.current = targetPath;
      setGuardDialogOpen(true);
      return true; // signal: navigation blocked
    };
    window.__guestflowBeforeNavigate = guardHandler;
    return () => {
      if (window.__guestflowBeforeNavigate === guardHandler) {
        delete window.__guestflowBeforeNavigate;
      }
    };
  }, []);

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
    if (!isDirty) return undefined;
    const handler = () => {
      pendingNavRef.current = null;
      setGuardDialogOpen(true);
      // Keep the URL where it was.
      window.history.pushState(null, '', window.location.href);
    };
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, [isDirty]);

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
