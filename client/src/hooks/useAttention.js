/**
 * The home's attention payload (specs/shell-and-home-day-first.md §3.B): `{ pinned, items, total }`,
 * counted and ordered by the server. Read on mount and again after every write the app makes
 * (rule 11), so a subject whose last item was handled leaves the box. `enabled: false` (reception)
 * makes no call at all.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../api';
import { DATA_CHANGED_EVENT } from '../constants/appEvents';

const EMPTY = { pinned: [], items: [], total: 0 };
// Several writes in a row (« Tout solder », a check box then another) read the counts once.
const SETTLE_MS = 250;

export default function useAttention({ enabled = true } = {}) {
  const [attention, setAttention] = useState(EMPTY);
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!enabled) return;
    const mine = ++seq.current;
    try {
      const payload = await api.getAttention();
      if (mine !== seq.current) return;
      setAttention({
        pinned: Array.isArray(payload?.pinned) ? payload.pinned : [],
        items: Array.isArray(payload?.items) ? payload.items : [],
        total: Number(payload?.total) || 0,
      });
    } catch {
      // The home keeps what it showed: a failed read never empties it nor breaks the page.
    }
  }, [enabled]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!enabled) return undefined;
    let timer = null;
    const onChange = () => {
      clearTimeout(timer);
      timer = setTimeout(load, SETTLE_MS);
    };
    window.addEventListener(DATA_CHANGED_EVENT, onChange);
    return () => {
      clearTimeout(timer);
      window.removeEventListener(DATA_CHANGED_EVENT, onChange);
    };
  }, [enabled, load]);

  return { ...attention, reload: load };
}
