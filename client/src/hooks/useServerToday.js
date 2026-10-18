/**
 * useServerToday — the server's date ('YYYY-MM-DD', Europe/Paris), from `GET /api/today`
 * (specs/ds-sweep-planning.md rule 28). `null` until known; the browser's local date if the server
 * cannot be asked.
 */
import { useEffect, useState } from 'react';
import api from '../api';
import { localIsoToday } from '../utils/isoDay';

export default function useServerToday() {
  const [today, setToday] = useState(null);
  useEffect(() => {
    let alive = true;
    Promise.resolve()
      .then(() => api.getToday())
      .then((r) => (r && /^\d{4}-\d{2}-\d{2}$/.test(r.today) ? r.today : localIsoToday()))
      .catch(() => localIsoToday())
      .then((day) => { if (alive) setToday(day); });
    return () => { alive = false; };
  }, []);
  return today;
}
