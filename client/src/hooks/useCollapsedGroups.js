/**
 * useCollapsedGroups — which sections of a GroupedList the operator folded, remembered per browser.
 * A convenience only: every read and write is guarded, the list renders fine without storage.
 *
 *   const { isCollapsed, toggle } = useCollapsedGroups('options-catalogue', { defaultCollapsed: ['archived'] });
 *
 * `defaultCollapsed` keys are folded until the operator opens them once (a choice is then stored).
 */
import { useCallback, useState } from 'react';

const PREFIX = 'guestflow:collapsed:';

function read(storageKey, defaults) {
  try {
    const raw = window.localStorage.getItem(PREFIX + storageKey);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    }
  } catch { /* storage unavailable: fall back to the defaults */ }
  return Object.fromEntries(defaults.map((key) => [key, true]));
}

export default function useCollapsedGroups(storageKey, { defaultCollapsed = [] } = {}) {
  const [state, setState] = useState(() => read(storageKey, defaultCollapsed));

  const toggle = useCallback((key) => {
    setState((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try { window.localStorage.setItem(PREFIX + storageKey, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, [storageKey]);

  const isCollapsed = useCallback((key) => Boolean(state[key]), [state]);
  return { isCollapsed, toggle };
}
