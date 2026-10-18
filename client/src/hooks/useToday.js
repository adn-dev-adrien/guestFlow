import { useEffect, useState } from 'react';
import api from '../api';
import { localIsoDate } from '../utils/localDate';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The calendar day a page opens on: the server's, whose clock runs in the accommodations' time zone
 * (specs/upcoming-reservations-cards.md rule 7). Until it answers, the browser's own calendar day —
 * never its UTC date.
 */
export default function useToday() {
  const [today, setToday] = useState(() => localIsoDate());
  useEffect(() => {
    let alive = true;
    Promise.resolve()
      .then(() => api.getToday())
      .then((r) => { if (alive && r && ISO_DATE.test(r.today)) setToday(r.today); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  return today;
}
