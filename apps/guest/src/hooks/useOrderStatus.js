/**
 * One order, read again while its card payment is being confirmed (rule 33: the return from Qonto lands on
 * the order, which polls its status; the server's read triggers the on-demand Qonto poll).
 */
import { useEffect, useRef, useState } from 'react';
import { api } from '../services/api';

const POLL_MS = 3000;
const POLL_LIMIT = 40;

export function useOrderStatus(id, lang) {
  const [state, setState] = useState({ order: null, error: null, polling: false });
  const tries = useRef(0);
  useEffect(() => {
    let live = true;
    let timer = null;
    tries.current = 0;
    const read = async () => {
      try {
        const order = await api.orderById(id);
        if (!live) return;
        const waiting = order.status === 'awaiting_payment' && tries.current < POLL_LIMIT;
        setState({ order, error: null, polling: waiting });
        if (waiting) { tries.current += 1; timer = setTimeout(read, POLL_MS); }
      } catch (error) {
        if (live) setState((s) => ({ ...s, error, polling: false }));
      }
    };
    read();
    return () => { live = false; clearTimeout(timer); };
  }, [id, lang]);
  return state;
}
