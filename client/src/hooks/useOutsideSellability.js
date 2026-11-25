/**
 * useOutsideSellability — can the article being edited be sold with no stay? (`GET /api/standalone-sales/sellability`, specs/pricing-components.md rule 124). The server answers
 * `{ sellable, code, reason }` for the draft; this hook only asks again when the price type, the planning card or the insurance flag changes, and keeps the last answer while the next
 * one is pending. A failed read leaves the answer as it was (the server still judges the save).
 *
 *   useOutsideSellability(enabled, kind, { id, priceType, showsPlanningCard, isCancellationInsurance }) → { sellable, code, reason } | null
 *   (`id` the article edited: a new one, or the panel closing, drops the previous article's answer)
 */
import { useEffect, useState } from 'react';
import api from '../api';

export default function useOutsideSellability(enabled, kind, { id, priceType, showsPlanningCard = false, isCancellationInsurance = false } = {}) {
  const [answer, setAnswer] = useState(null);
  // Another article, or the panel closed: the last answer belonged to the previous one.
  useEffect(() => { setAnswer(null); }, [enabled, kind, id]);
  useEffect(() => {
    if (!enabled || !priceType) return undefined;
    let current = true;
    Promise.resolve()
      .then(() => api.getOutsideSellability({
        kind, priceType, showsPlanningCard: showsPlanningCard ? 1 : 0, isCancellationInsurance: isCancellationInsurance ? 1 : 0,
      }))
      .then((res) => { if (current) setAnswer(res); })
      .catch(() => {});
    return () => { current = false; };
  }, [enabled, kind, priceType, showsPlanningCard, isCancellationInsurance]);
  return answer;
}
