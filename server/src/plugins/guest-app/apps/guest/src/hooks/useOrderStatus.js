/**
 * One order, read again while its card payment is being confirmed (rule 33: the return from Qonto lands on
 * the order, which polls its status; the server's read triggers the on-demand Qonto poll).
 *
 * Without network the read is tried again, waiting longer each time, instead of giving up. After POLL_LIMIT
 * tries the hook stops and says so (`stalled`); `recheck()` starts again (« Vérifier à nouveau »).
 */
import { useCallback, useEffect, useState } from 'react';
import { api } from '../services/api';

export const POLL_MS = 3000;
export const POLL_LIMIT = 40;
const BACKOFF_MAX_MS = 30000;

export function useOrderStatus(id, lang) {
  const [state, setState] = useState({ order: null, error: null, polling: false, stalled: false });
  const [round, setRound] = useState(0);
  useEffect(() => {
    let live = true;
    let timer = null;
    let tries = 0;
    let failures = 0;
    const read = async () => {
      try {
        const order = await api.orderById(id);
        if (!live) return;
        failures = 0;
        const waiting = order.status === 'awaiting_payment';
        const again = waiting && tries < POLL_LIMIT;
        setState({ order, error: null, polling: again, stalled: waiting && !again });
        if (again) { tries += 1; timer = setTimeout(read, POLL_MS); }
      } catch (error) {
        if (!live) return;
        if (error.code === 'NETWORK' && tries < POLL_LIMIT) {
          tries += 1;
          failures += 1;
          timer = setTimeout(read, Math.min(POLL_MS * 2 ** (failures - 1), BACKOFF_MAX_MS));
          return;
        }
        setState((s) => ({ ...s, error, polling: false, stalled: true }));
      }
    };
    read();
    return () => { live = false; clearTimeout(timer); };
  }, [id, lang, round]);

  const recheck = useCallback(() => {
    setState((s) => ({ ...s, error: null, stalled: false, polling: Boolean(s.order && s.order.status === 'awaiting_payment') }));
    setRound((r) => r + 1);
  }, []);

  return { ...state, recheck };
}
