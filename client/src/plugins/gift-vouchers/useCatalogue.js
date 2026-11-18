// The catalogue a composition is picked from (specs/gift-voucher-campaigns.md rule 4): read once from the server, with its failure and a retry.
import { useCallback, useEffect, useState } from 'react';
import giftVouchersApi from './giftVouchersApi';

export default function useCatalogue() {
  const [elements, setElements] = useState(null);
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    setError(false);
    giftVouchersApi.catalogue().then((result) => setElements(result.elements)).catch(() => setError(true));
  }, []);
  useEffect(load, [load]);

  return { elements, error, retry: load };
}
