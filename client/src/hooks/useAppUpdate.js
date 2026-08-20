/**
 * Single source of update state for the client (specs/self-update-and-releases.md §4.2).
 *
 * The server ships everything ready to render — whether an update exists, its notes already split
 * into sections, the French label of the current phase. This hook only fetches, holds and triggers;
 * it compares no version and builds no sentence.
 *
 * Admin-only: every `/api/system/*` endpoint is admin-gated server-side, so a non-admin session
 * never calls them at all rather than collecting 403s.
 */
import { useCallback, useEffect, useState } from 'react';
import api from '../api';
import { useAuth } from './useAuth';
import { ADMIN, userHasRole } from '../constants/roles';

/** Fired when an update starts, so the app-level progress overlay takes over from anywhere. */
export const UPDATE_STARTED_EVENT = 'guestflow:update-started';

export default function useAppUpdate() {
  const { user } = useAuth();
  const isAdmin = userHasRole(user, ADMIN);

  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(isAdmin);
  const [checking, setChecking] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    if (!isAdmin) {
      setInfo(null);
      setLoading(false);
      return null;
    }
    try {
      const payload = await api.getSystemVersion();
      setInfo(payload);
      setError(null);
      return payload;
    } catch (err) {
      setError(err.message || 'Impossible de lire la version installée.');
      return null;
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => { refresh(); }, [refresh]);

  const checkNow = useCallback(async () => {
    setChecking(true);
    setError(null);
    try {
      const payload = await api.checkSystemVersion();
      setInfo(payload);
      return payload;
    } catch (err) {
      setError(err.message || 'La vérification a échoué.');
      return null;
    } finally {
      setChecking(false);
    }
  }, []);

  const start = useCallback(async (targetVersion) => {
    setStarting(true);
    setError(null);
    try {
      await api.startUpdate(targetVersion);
      // The overlay owns the screen from here — wherever the user triggered it from.
      window.dispatchEvent(new CustomEvent(UPDATE_STARTED_EVENT, { detail: { targetVersion } }));
      return true;
    } catch (err) {
      setError(err.message || "La mise à jour n'a pas pu démarrer.");
      return false;
    } finally {
      setStarting(false);
    }
  }, []);

  const dismiss = useCallback(async (version) => {
    try {
      await api.dismissUpdate(version);
    } catch {
      // A failed dismissal is not worth an error banner: the alert simply comes back.
    }
    return refresh();
  }, [refresh]);

  return { isAdmin, info, loading, checking, starting, error, refresh, checkNow, start, dismiss };
}
