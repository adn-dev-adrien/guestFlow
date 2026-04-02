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

export function navigateBackWithFrom(navigate, from) {
  if (from) navigate(from);
  else navigate(-1);
}
