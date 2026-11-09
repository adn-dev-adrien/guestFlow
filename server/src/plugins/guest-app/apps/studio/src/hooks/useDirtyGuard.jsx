/**
 * The dirty-form guard (CLAUDE.md §6.0: local UI state): a screen with unsaved edits says so, and leaving it — another
 * lodging, another screen, closing the tab — asks first. Screens call `useDirtyGuard(dirty)`; the shell navigates
 * through `useGuardedNavigate()`.
 */
import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import { useNavigate } from 'react-router';
import ConfirmDialog from '@guestflow/components/ConfirmDialog';

const GuardContext = createContext(null);

export function DirtyGuardProvider({ children }) {
  const dirty = useRef(false);
  const [pending, setPending] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    const warn = (event) => {
      if (!dirty.current) return undefined;
      event.preventDefault();
      event.returnValue = '';
      return '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  const go = useCallback((to) => {
    if (dirty.current) setPending({ to });
    else navigate(to);
  }, [navigate]);

  const value = useMemo(() => ({ dirty, go }), [go]);
  return (
    <GuardContext.Provider value={value}>
      {children}
      <ConfirmDialog
        open={Boolean(pending)}
        title="Quitter sans enregistrer ?"
        message="Vos modifications de cet écran seront perdues."
        confirmLabel="Quitter"
        cancelLabel="Rester"
        confirmColor="error"
        onClose={() => setPending(null)}
        onConfirm={() => { dirty.current = false; const { to } = pending; setPending(null); navigate(to); }}
      />
    </GuardContext.Provider>
  );
}

export function useDirtyGuard(isDirty) {
  const guard = useContext(GuardContext);
  useEffect(() => {
    if (!guard) return undefined;
    guard.dirty.current = Boolean(isDirty);
    return () => { guard.dirty.current = false; };
  }, [guard, isDirty]);
}

export function useGuardedNavigate() {
  const guard = useContext(GuardContext);
  const navigate = useNavigate();
  return guard ? guard.go : navigate;
}
