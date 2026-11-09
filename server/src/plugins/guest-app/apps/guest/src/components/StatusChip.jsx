/**
 * StatusChip — the soft status pill of the house (`.st`): success, warning, error or muted, the text from the
 * server or the app's words. Generic: orders, stock, included items.
 *
 * Props: `tone` ('ok' | 'warn' | 'bad' | 'mut'), `children`.
 */
export default function StatusChip({ tone = 'mut', children }) {
  return <span className={`st ${tone}`}>{children}</span>;
}
