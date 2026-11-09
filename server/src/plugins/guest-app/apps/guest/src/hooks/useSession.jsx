/**
 * The session of this device (specs/guest-app.md rules 1-9, 19, 53): how the app got in (stay link, lodging
 * poster, lookup), what `/me` and `/lodging` say, the language and the day / night register.
 *
 * The stay link is kept on the device and exchanged again whenever the server says the session is dead
 * (401 `SESSION_EXPIRED`): a pre-arrival session thus becomes a stay session by itself at H-3, and a stay
 * that ended falls back to the visitor mode the server opens for that link (rules 4, 9). Without a link that
 * still opens, the lodging poster code opens the visitor mode; without either, the generic « Ce code n'est
 * pas reconnu » screen.
 */
import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import { api, onSessionExpired, setLanguage } from '../services/api';
import { device } from '../services/device';

// Exported for the studio's phone preview, which renders these screens from the editor's state (rule 49).
export const SessionContext = createContext(null);

const prefersDark = () => typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;

/** One exchange of what the device holds; true when a session is open again. */
async function reopenFromDevice() {
  const stayToken = device.get('stayToken');
  if (stayToken) {
    try {
      const opened = await api.openStay(stayToken);
      device.set('ended', Boolean(opened && opened.ended));
      return true;
    } catch (err) {
      if (err.code === 'CODE_NOT_FOUND') device.set('stayToken', null);
      else if (err.code !== 'NETWORK') throw err;
    }
  }
  const lodgingCode = device.get('lodgingCode');
  if (lodgingCode) {
    try {
      await api.openLodging(lodgingCode);
      return true;
    } catch (err) {
      if (err.code === 'CODE_NOT_FOUND') device.set('lodgingCode', null);
      else if (err.code !== 'NETWORK') throw err;
    }
  }
  return false;
}

export function SessionProvider({ children }) {
  const [state, setState] = useState({ status: 'loading', me: null, lodging: null, error: null });
  const [langChoice, setLangChoice] = useState(() => device.get('lang') || null);
  const [nightChoice, setNightChoice] = useState(() => device.get('register') || null);
  const [darkScheme, setDarkScheme] = useState(prefersDark);
  const reopening = useRef(null);

  // Rule 4 — every dead session goes back through the stored link once, whoever noticed it first.
  useEffect(() => {
    onSessionExpired(() => {
      if (!reopening.current) {
        reopening.current = reopenFromDevice().finally(() => { reopening.current = null; });
      }
      return reopening.current;
    });
    return () => onSessionExpired(null);
  }, []);

  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setDarkScheme(mq.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);

  const load = useCallback(async () => {
    setLanguage(langChoice);
    try {
      const [me, lodging] = await Promise.all([api.me(), api.lodging()]);
      setState({ status: 'ready', me, lodging, error: null });
    } catch (err) {
      if (err.code === 'PLUGIN_INACTIVE') setState({ status: 'inactive', me: null, lodging: null, error: err });
      else if (err.status === 401 || err.code === 'CODE_NOT_FOUND') setState({ status: 'unknown', me: null, lodging: null, error: err });
      else setState((s) => ({ ...s, status: s.me ? 'ready' : 'error', error: err }));
    }
  }, [langChoice]);

  /** `/s/:token`, `/l/:code` and the lookup: open, remember what opened it, then read the session. */
  const enter = useCallback(async (how) => {
    setState((s) => ({ ...s, status: 'loading' }));
    try {
      if (how.stayToken) {
        const opened = await api.openStay(how.stayToken);
        device.set('stayToken', how.stayToken);
        device.set('ended', Boolean(opened && opened.ended));
      } else if (how.lodgingCode) {
        await api.openLodging(how.lodgingCode);
        device.set('lodgingCode', how.lodgingCode);
        device.set('ended', false);
      }
    } catch (err) {
      if (err.code === 'PLUGIN_INACTIVE') { setState({ status: 'inactive', me: null, lodging: null, error: err }); return false; }
      if (err.code === 'CODE_NOT_FOUND') {
        if (how.stayToken && device.get('stayToken') === how.stayToken) device.set('stayToken', null);
        setState({ status: 'unknown', me: null, lodging: null, error: err });
        return false;
      }
      setState({ status: 'error', me: null, lodging: null, error: err });
      return false;
    }
    await load();
    return true;
  }, [load]);

  /** After a successful lookup the server holds the session; the app only reads it. */
  const afterLookup = useCallback(async () => { await load(); }, [load]);

  useEffect(() => {
    if (window.location.pathname.startsWith('/s/') || window.location.pathname.startsWith('/l/')) return;
    load();
  }, [load]);

  // Rule 4 — at H-3 the pre-arrival session ends on the server: read again then, the link reopens the stay.
  const opensAt = state.me && state.me.opensAt;
  useEffect(() => {
    if (!opensAt) return undefined;
    const wait = Date.parse(opensAt) - Date.now() + 2000;
    if (!(wait > 0) || wait > 24 * 3600 * 1000) return undefined;
    const timer = setTimeout(load, wait);
    return () => clearTimeout(timer);
  }, [opensAt, load]);

  const lang = langChoice || (state.me && state.me.language) || 'fr';
  // §6.1 — the night register: the guest's choice, else the device's dark scheme or the server's night.
  const night = nightChoice ? nightChoice === 'night' : (darkScheme || Boolean(state.me && state.me.isNight));

  const chooseLang = useCallback((next) => { device.set('lang', next); setLangChoice(next); }, []);
  const toggleNight = useCallback(() => {
    const next = night ? 'day' : 'night';
    device.set('register', next);
    setNightChoice(next);
  }, [night]);

  const value = useMemo(() => ({
    ...state, lang, night, chooseLang, toggleNight, reload: load, enter, afterLookup,
  }), [state, lang, night, chooseLang, toggleNight, load, enter, afterLookup]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export const useSession = () => useContext(SessionContext);

/** The modules the session shows, by key (rule 11bis): `has('shop')`. */
export function useModules() {
  const { lodging, me } = useSession() || {};
  const keys = new Set([
    ...((lodging && lodging.modules) || []).map((m) => m.key),
    ...((me && me.tiles) || []).map((m) => m.key),
  ]);
  return { has: (key) => keys.has(key), keys };
}

export { reopenFromDevice };
