/** ImageBlock — one photo and its caption (rule 18 `image`); `GalleryBlock` — a horizontal strip of them. */
import { srcSetOf } from '../Photo';

export function Figure({ image, caption }) {
  return (
    <figure className="bimg">
      <img src={image.url} srcSet={srcSetOf(image.sizes)} sizes="(min-width: 900px) 680px, 100vw" alt={image.alt || ''} width={image.width} height={image.height} loading="lazy" decoding="async" />
      {caption ? <figcaption>{caption}</figcaption> : null}
    </figure>
  );
}

export default function ImageBlock({ block }) {
  return <Figure image={block.image} caption={block.caption} />;
}

export function GalleryBlock({ block }) {
  return (
    <div className="gallery">
      {block.items.map((item, i) => <Figure key={item.image.url || i} image={item.image} caption={item.caption} />)}
    </div>
  );
}
