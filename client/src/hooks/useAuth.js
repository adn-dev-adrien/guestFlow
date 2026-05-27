import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import api from '../api';

/**
 * App-wide authentication state.
 *
 * Bootstraps the current user via `GET /api/auth/me` on mount, exposes `login` / `logout` /
 * `changePassword`, and listens for the global `guestflow:unauthenticated` event (fired by api.js on a
 * 401) to drop the session and send the user back to the login screen.
 */
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

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

  const login = useCallback(async (email, password) => {
    const me = await api.login(email, password);
    setUser(me);
    return me;
  }, []);

  const logout = useCallback(async () => {
    try { await api.logout(); } catch { /* ignore network/already-out */ }
    setUser(null);
  }, []);

  const changePassword = useCallback(async (currentPassword, newPassword) => {
    await api.changePassword(currentPassword, newPassword);
    setUser((u) => (u ? { ...u, mustChangePassword: false } : u));
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, changePassword, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
