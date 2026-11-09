/**
 * Photo — a photo surface (`.ph`): the server's image when there is one, the estate's fallback ground
 * otherwise, the site's scrim when text sits on it (§6.1 `scrim`, §6.3 photography).
 *
 * Props: `src` (url or null), `sizes` (`{ 400, 800, 1600 }` from the media payload, optional), `alt`
 * (empty = decorative), `scrim`, `fallback` ('forest' | 'night' | 'map'), `as` (element, default `div`),
 * `className`, `style`, `children`, any other prop goes to the element (a photo can be a button).
 */
export function srcSetOf(sizes) {
  if (!sizes) return undefined;
  return Object.entries(sizes).map(([w, url]) => `${url} ${w}w`).join(', ');
}

export default function Photo({
  src, sizes, alt = '', scrim = false, fallback = 'forest', as: Tag = 'div', className = '', style, children, imgSizes = '100vw', ...rest
}) {
  const cls = ['ph', scrim ? 'scrim' : '', src ? '' : (fallback === 'night' ? 'fallback-night' : fallback === 'map' ? 'fallback-map' : 'fallback'), className].filter(Boolean).join(' ');
  return (
    <Tag className={cls} style={style} {...rest}>
      {src ? <img className="fill" src={src} srcSet={srcSetOf(sizes)} sizes={imgSizes} alt={alt} loading="lazy" decoding="async" /> : null}
      {children}
    </Tag>
  );
}
