export function withFrom(path, from) {
  if (!from) return path;
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}from=${encodeURIComponent(from)}`;
}

export function getFromParam(searchSource) {
  if (!searchSource) return '';

  if (typeof searchSource.get === 'function') {
    return searchSource.get('from') || '';
  }

  if (typeof searchSource === 'string') {
    const raw = searchSource.startsWith('?') ? searchSource.slice(1) : searchSource;
    return new URLSearchParams(raw).get('from') || '';
  }

  return '';
}

// Where a page opened directly goes back to: the planning (specs/ui-review-2026-10-19-operations.md
// rule 22).
export const DEFAULT_BACK_PATH = '/planning';

/**
 * True when the browser's previous entry is a page of this app. React Router numbers the entries it
 * pushes (`history.state.idx`, 0 for the page the tab opened on): a page opened directly — a link
 * in a new tab, a bookmark — has nothing of the app behind it, and `navigate(-1)` would leave it.
 */
export function hasInAppHistory() {
  const state = typeof window !== 'undefined' ? window.history.state : null;
  return Boolean(state && Number(state.idx) > 0);
}

/** Back one page inside the app, or to `fallback` when the page was opened directly. */
export function navigateBack(navigate, fallback = DEFAULT_BACK_PATH) {
  if (hasInAppHistory()) navigate(-1);
  else navigate(fallback, { replace: true });
}

export function navigateBackWithFrom(navigate, from, fallback = DEFAULT_BACK_PATH) {
  if (from) navigate(from);
  else navigateBack(navigate, fallback);
}
