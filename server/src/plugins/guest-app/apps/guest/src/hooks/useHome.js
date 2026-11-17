/**
 * The « Domotique » page's data (specs/guest-app-home-automation.md rule 21): read once, then every 60 s while the
 * page is visible — never in the background — and again when it comes back to the foreground.
 */
import { useEffect } from 'react';
import { useLoad } from './useLoad';
import { api } from '../services/api';

export const REFRESH_MS = 60 * 1000;

export function useHome(lang) {
  const home = useLoad(() => api.home(), [lang]);
  const { reload } = home;
  useEffect(() => {
    let timer = null;
    const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
    const start = () => { stop(); timer = setInterval(reload, REFRESH_MS); };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') { reload(); start(); } else stop();
    };
    if (document.visibilityState !== 'hidden') start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => { stop(); document.removeEventListener('visibilitychange', onVisibility); };
  }, [reload]);
  return home;
}
