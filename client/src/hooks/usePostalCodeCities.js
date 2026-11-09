/**
 * usePostalCodeCities — the communes of a French postcode, for a city field picked from a list
 * (specs/resource-booking-pricing-and-invoicing.md rule 27). Generic: used by the clients directory, the fiche's new-client
 * dialog and the billing address of a resource booking.
 *
 * From 2 digits on, asks geo.api.gouv.fr (debounced 250 ms, the previous request aborted), narrowed by what the city field
 * already holds. A help, never a check: an empty list or a failed lookup leaves free typing.
 *
 * @param {string} postalCode the postcode as typed
 * @param {string} [city]     the city field, to narrow the list
 * @param {{ enabled?: boolean }} [options] `enabled: false` (a closed dialog) keeps the list empty
 * @returns {string[]} commune names, deduplicated
 */
import { useEffect, useState } from 'react';

const DEBOUNCE_MS = 250;

export default function usePostalCodeCities(postalCode, city = '', { enabled = true } = {}) {
  const [options, setOptions] = useState([]);

  useEffect(() => {
    const cp = String(postalCode || '').trim();
    if (!enabled || cp.length < 2) {
      setOptions([]);
      return undefined;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ codePostal: cp, fields: 'nom,code,codesPostaux', limit: '20' });
        const cityQuery = String(city || '').trim();
        if (cityQuery) params.set('nom', cityQuery);
        const res = await fetch(`https://geo.api.gouv.fr/communes?${params.toString()}`, { signal: controller.signal });
        if (!res.ok) return;
        const data = await res.json();
        setOptions(Array.from(new Set((data || []).map((c) => c.nom).filter(Boolean))));
      } catch (e) {
        if (e.name !== 'AbortError') setOptions([]);
      }
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [postalCode, city, enabled]);

  return options;
}
