/**
 * useServerToday — the server's date ('YYYY-MM-DD', Europe/Paris), from `GET /api/today`
 * (specs/ds-sweep-planning.md rules 28, 29). `null` until known; the browser's local date if the
 * server cannot be asked. Read again whenever the page comes back to the foreground, so a page left
 * open past midnight moves to the new day.
 */
import { useEffect, useState } from 'react';
import api from '../api';
import { localIsoToday } from '../utils/isoDay';

export default function useServerToday() {
  const [today, setToday] = useState(null);
  useEffect(() => {
    let alive = true;
    const read = () => Promise.resolve()
      .then(() => api.getToday())
      .then((r) => (r && /^\d{4}-\d{2}-\d{2}$/.test(r.today) ? r.today : localIsoToday()))
      .catch(() => localIsoToday())
      .then((day) => { if (alive) setToday(day); });
    const onVisible = () => { if (document.visibilityState === 'visible') read(); };
    read();
    window.addEventListener('focus', read);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      window.removeEventListener('focus', read);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
  return today;
}
