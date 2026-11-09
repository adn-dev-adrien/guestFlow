/**
 * ButtonBlock — a button to a page, an article or a link (rule 18 `button`). The server has already dropped
 * every target this session cannot follow; the app only opens it.
 *
 * Props: `block`, `onNavigate(target)`.
 */
export default function ButtonBlock({ block, onNavigate }) {
  if (block.target && block.target.kind === 'url') {
    return <a className="btn ghost block" href={block.target.href} target="_blank" rel="noopener noreferrer">{block.label}</a>;
  }
  return <button type="button" className="btn ghost block" onClick={() => onNavigate && onNavigate(block.target)}>{block.label}</button>;
}
