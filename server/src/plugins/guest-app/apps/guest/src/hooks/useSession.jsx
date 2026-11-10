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
import {
  api, onPluginInactive, onSessionExpired, setLanguage,
} from '../services/api';
import { device } from '../services/device';

// Exported for the studio's phone preview, which renders these screens from the editor's state (rule 49).
export const SessionContext = createContext(null);

// Rule 19 — the language the guest chose on this device is the one every request asks for from the first one on.
setLanguage(device.get('lang') || null);

const prefersDark = () => typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;

/**
 * One exchange of what the device holds: true when a session is open again, false when nothing the device
 * holds opens one any more. Throws the network error when the network alone kept it from opening: the link is
 * kept for the next try.
 */
async function reopenFromDevice() {
  let offline = null;
  const stayToken = device.get('stayToken');
  if (stayToken) {
    try {
      const opened = await api.openStay(stayToken);
      device.set('ended', Boolean(opened && opened.ended));
      return true;
    } catch (err) {
      if (err.code === 'CODE_NOT_FOUND') device.set('stayToken', null);
      else if (err.code === 'NETWORK') offline = err;
      else throw err;
    }
  }
  const lodgingCode = device.get('lodgingCode');
  if (lodgingCode) {
    try {
      await api.openLodging(lodgingCode);
      return true;
    } catch (err) {
      if (err.code === 'CODE_NOT_FOUND') device.set('lodgingCode', null);
      else if (err.code === 'NETWORK') offline = offline || err;
      else throw err;
    }
  }
  if (offline) throw offline;
  return false;
}

/** M12 — a device that no longer holds a stay keeps nothing personal offline: the worker drops its data cache. */
function purgeOfflineData() {
  const worker = typeof navigator !== 'undefined' && navigator.serviceWorker && navigator.serviceWorker.controller;
  if (worker) worker.postMessage({ type: 'purge' });
}

export function SessionProvider({ children }) {
  const [state, setState] = useState({ status: 'loading', me: null, lodging: null, error: null });
  const [langChoice, setLangChoice] = useState(() => device.get('lang') || null);
  const [nightChoice, setNightChoice] = useState(() => device.get('register') || null);
  const [darkScheme, setDarkScheme] = useState(prefersDark);
  const reopening = useRef(null);
  const loads = useRef(0);
  const read = useRef(null);

  // Rule 4 — every dead session goes back through the stored link once, whoever noticed it first. The session
  // reopened may not be the one shown (the stay ended, was cancelled, its link regenerated): `/me` and `/lodging`
  // are read again, and a device nothing reopens goes to « Ce code n'est pas reconnu ».
  useEffect(() => {
    onSessionExpired(() => {
      if (!reopening.current) {
        reopening.current = reopenFromDevice()
          .then((reopened) => {
            if (!reopened) setState({ status: 'unknown', me: null, lodging: null, error: null });
            else if (!loads.current) read.current({ noRetry: true });
            return reopened;
          })
          .finally(() => { reopening.current = null; });
      }
      return reopening.current;
    });
    return () => onSessionExpired(null);
  }, []);

  // Rule 63 — the plugin switched off while the app is open: whichever request learns it, the app is unavailable.
  useEffect(() => {
    onPluginInactive((err) => setState({ status: 'inactive', me: null, lodging: null, error: err }));
    return () => onPluginInactive(null);
  }, []);

  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setDarkScheme(mq.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);

  const load = useCallback(async (options) => {
    setLanguage(langChoice);
    loads.current += 1;
    try {
      const [me, lodging] = await Promise.all([api.me(options), api.lodging(options)]);
      setState({ status: 'ready', me, lodging, error: null });
    } catch (err) {
      if (err.code === 'PLUGIN_INACTIVE') setState({ status: 'inactive', me: null, lodging: null, error: err });
      else if (err.status === 401 || err.code === 'CODE_NOT_FOUND') setState({ status: 'unknown', me: null, lodging: null, error: err });
      else setState((s) => ({ ...s, status: s.me ? 'ready' : 'error', error: err }));
    } finally {
      loads.current -= 1;
    }
  }, [langChoice]);
  read.current = load;

  /**
   * `/s/:token`, `/l/:code` and the lookup: open, remember what opened it, then read the session → `{ opened, error }`.
   * What opened it is kept before the exchange, so a network failure never loses the link; only a code the server
   * does not know is forgotten.
   */
  const enter = useCallback(async (how) => {
    setState((s) => ({ ...s, status: 'loading', error: null }));
    if (how.stayToken) device.set('stayToken', how.stayToken);
    if (how.lodgingCode) device.set('lodgingCode', how.lodgingCode);
    try {
      if (how.stayToken) {
        const opened = await api.openStay(how.stayToken);
        device.set('ended', Boolean(opened && opened.ended));
      } else if (how.lodgingCode) {
        await api.openLodging(how.lodgingCode);
        device.set('ended', false);
      }
    } catch (err) {
      if (err.code === 'PLUGIN_INACTIVE') {
        setState({ status: 'inactive', me: null, lodging: null, error: err });
      } else if (err.code === 'CODE_NOT_FOUND') {
        if (how.stayToken && device.get('stayToken') === how.stayToken) device.set('stayToken', null);
        if (how.lodgingCode && device.get('lodgingCode') === how.lodgingCode) device.set('lodgingCode', null);
        setState({ status: 'unknown', me: null, lodging: null, error: err });
      } else {
        setState({ status: 'error', me: null, lodging: null, error: err });
      }
      return { opened: false, error: err };
    }
    await load();
    return { opened: true, error: null };
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

  const anonymous = state.status === 'unknown' || Boolean(state.me && state.me.mode === 'visitor');
  useEffect(() => { if (anonymous) purgeOfflineData(); }, [anonymous]);

  const lang = langChoice || (state.me && state.me.language) || 'fr';
  // §6.1 — the night register: the guest's choice, else the device's dark scheme or the server's night.
  const night = nightChoice ? nightChoice === 'night' : (darkScheme || Boolean(state.me && state.me.isNight));

  // The API asks for the new language before any page re-reads its data (audit R36-C-L1): a child's effect runs before
  // this provider's, and read the orders and the booklet again in the old one.
  const chooseLang = useCallback((next) => {
    device.set('lang', next);
    setLanguage(next);
    setLangChoice(next);
  }, []);
  const toggleNight = useCallback(() => {
    const next = night ? 'day' : 'night';
    device.set('register', next);
    setNightChoice(next);
  }, [night]);

  const value = useMemo(() => ({
    ...state, lang, night, chooseLang, toggleNight, reload: () => load(), enter, afterLookup,
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
