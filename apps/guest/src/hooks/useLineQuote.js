/**
 * The server's price of one prospective line (rule 24, §6.5 « show the real price before every commitment »):
 * the sheet's « AJOUTER · 12,00 € » is the quote of exactly that line, never a multiplication in the app.
 */
import { useEffect, useState } from 'react';
import { api } from '../services/api';

export function useLineQuote(line, enabled) {
  const [state, setState] = useState({ quote: null, loading: false, error: null });
  const body = JSON.stringify(line);
  useEffect(() => {
    if (!enabled || !line) { setState({ quote: null, loading: false, error: null }); return undefined; }
    let live = true;
    setState((s) => ({ ...s, loading: true }));
    const timer = setTimeout(() => {
      api.quote([JSON.parse(body)])
        .then((quote) => { if (live) setState({ quote, loading: false, error: null }); })
        .catch((error) => { if (live) setState({ quote: null, loading: false, error }); });
    }, 200);
    return () => { live = false; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body, enabled]);
  return state;
}
