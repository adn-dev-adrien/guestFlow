/**
 * PhotoCard — a booklet entry (§6.4): the page's cover, the scrim, eyebrow and Marcellus title inside the
 * photo. Two sizes: the home's strip card (`variant="strip"`) and the booklet index card.
 *
 * Props: `cover` (media payload or null), `eyebrow`, `title`, `sub`, `excerpt` (search sentence, with
 * `highlight` { start, length }), `current`, `variant`, `onClick`.
 */
import Photo from './Photo';

function Excerpt({ text, highlight }) {
  if (!highlight) return <span className="snip">{text}</span>;
  const { start, length } = highlight;
  return <span className="snip">{text.slice(0, start)}<b>{text.slice(start, start + length)}</b>{text.slice(start + length)}</span>;
}

export default function PhotoCard({
  cover, eyebrow, title, sub, excerpt, highlight, current, variant = 'index', onClick,
}) {
  const strip = variant === 'strip';
  return (
    <Photo
      as="button"
      type="button"
      src={cover ? cover.url : null}
      sizes={cover ? cover.sizes : null}
      imgSizes={strip ? '140px' : '(min-width: 900px) 330px, 100vw'}
      scrim
      className={strip ? 'pcard' : 'bkcard'}
      aria-current={current ? 'page' : undefined}
      onClick={onClick}
    >
      <span className={strip ? 'lbl' : 'in'}>
        {eyebrow ? <small>{eyebrow}</small> : null}
        <b>{title}</b>
        {sub ? <span>{sub}</span> : null}
        {excerpt ? <Excerpt text={excerpt} highlight={highlight} /> : null}
      </span>
    </Photo>
  );
}
