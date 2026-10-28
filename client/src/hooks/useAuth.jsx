import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { useLocation } from 'react-router';
import api from '../api';

/**
 * App-wide authentication state.
 *
 * Bootstraps the current user via `GET /api/auth/me` on mount, exposes `login` / `logout` /
 * `changePassword`, re-reads `/api/auth/me` when the route changes or the tab comes back (at most once
 * every 30 s) so a module the operator switched off leaves the menu
 * (specs/plugin-operator-provisioning.md rule 36), and listens for the global `guestflow:unauthenticated` event (fired by api.js on a
 * 401) to drop the session and send the user back to the login screen.
 */
const AuthContext = createContext(null);
const REVALIDATE_MS = 30 * 1000;

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const { pathname } = useLocation();
  const lastRead = useRef(Date.now());
  const signedIn = Boolean(user);

  // A failed re-read changes nothing: a 401 already fires `guestflow:unauthenticated`, and a network
  // error must not sign anyone out.
  const revalidate = useCallback(async () => {
    const now = Date.now();
    if (now - lastRead.current < REVALIDATE_MS) return;
    lastRead.current = now;
    try {
      const me = await api.getMe();
      setUser((current) => (current && JSON.stringify(current) === JSON.stringify(me) ? current : me));
    } catch { /* keep the session as it is */ }
  }, []);

  useEffect(() => {
    if (signedIn) revalidate();
  }, [pathname, signedIn, revalidate]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible' && signedIn) revalidate(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [signedIn, revalidate]);

  const refresh = useCallback(async () => {
    try {
      setUser(await api.getMe());
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const me = await api.getMe();
        lastRead.current = Date.now();
        if (active) setUser(me);
      } catch {
        if (active) setUser(null);
      } finally {
        if (active) setLoading(false);
      }
    })();
    const onUnauth = () => setUser(null);
    window.addEventListener('guestflow:unauthenticated', onUnauth);
    return () => {
      active = false;
      window.removeEventListener('guestflow:unauthenticated', onUnauth);
    };
  }, []);

  // → the user, or `{ step: 'second-factor', … }` when the account has a second step
  // (specs/hosting-h2-account-security.md rule 7): the login page then asks for the code.
  const login = useCallback(async (email, password) => {
    const me = await api.login(email, password);
    if (me && me.step) return me;
    lastRead.current = Date.now();
    setUser(me);
    return me;
  }, []);

  const completeSecondFactor = useCallback(async (code, trustDevice) => {
    const me = await api.verifySecondFactor(code, trustDevice);
    lastRead.current = Date.now();
    setUser(me);
    return me;
  }, []);

  // The forgotten password logs the user in itself (rule 4).
  const resetPassword = useCallback(async (token, password) => {
    const me = await api.resetPassword(token, password);
    if (me && me.step) return me;
    setUser(me);
    return me;
  }, []);

  const logout = useCallback(async () => {
    try { await api.logout(); } catch { /* ignore network/already-out */ }
    setUser(null);
  }, []);

  const changePassword = useCallback(async (currentPassword, newPassword, { wasMustChange = false } = {}) => {
    await api.changePassword(currentPassword, newPassword);
    if (wasMustChange) {
      // Server destroyed the session — drop the local auth state so the next render goes through
      // the AuthGate again (specs/admin-account-management.md §3.3 rule 15). The caller
      // (UserManagementPage) navigates to /login?reason=password-changed for the snackbar.
      setUser(null);
    } else {
      setUser((u) => (u ? { ...u, mustChangePassword: false } : u));
    }
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, changePassword, refresh, completeSecondFactor, resetPassword }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
