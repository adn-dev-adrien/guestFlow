/**
 * useVatRegime — the VAT regime of Paramètres › TVA & exercice (specs/vat-optional-mode.md §4.3): the state
 * (period in force, history, mentions), and the three calls a switch needs. The server decides everything
 * (validation, preview, effects); this hook only carries the calls.
 *
 * Returns: { state, loading, error, reload, notSubject, preview(input), switchRegime(input), deletePeriod(id) }
 *   notSubject — the regime in force is « Sans TVA » (false while loading or when the role cannot read it)
 */
import { useCallback, useEffect, useState } from 'react';
import api from '../api';

export default function useVatRegime() {
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const reload = useCallback(async () => {
    try {
      const next = await api.getVatRegime();
      setState(next);
      setError(false);
      return next;
    } catch {
      setError(true);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const switchRegime = useCallback(async (input) => {
    const result = await api.switchVatRegime(input);
    await reload();
    return result;
  }, [reload]);

  const deletePeriod = useCallback(async (id) => {
    await api.deleteVatPeriod(id);
    return reload();
  }, [reload]);

  const notSubject = Boolean(state && state.inForce && state.inForce.regime === 'not_subject');
  return { state, loading, error, reload, notSubject, preview: api.previewVatSwitch, switchRegime, deletePeriod };
}
