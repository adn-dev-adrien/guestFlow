/**
 * useExternalVatRates — the VAT classes of the catalogue with the external customer's rate of each (`GET /api/standalone-sales/vat-rates`), for the article editors' « Vendable hors séjour »
 * block. Loaded once per open editor; a failed read leaves the list empty (the rate field is then simply blank, the server judging the save).
 */
import { useEffect, useState } from 'react';
import api from '../api';

export default function useExternalVatRates(enabled) {
  const [classes, setClasses] = useState([]);
  useEffect(() => {
    if (!enabled) return undefined;
    let current = true;
    Promise.resolve().then(() => api.getStandaloneVatRates()).then((res) => { if (current) setClasses(res.classes || []); }).catch(() => {});
    return () => { current = false; };
  }, [enabled]);
  return classes;
}
