/**
 * BlockRenderer — one booklet block, by type (rule 18, §6.4). Pure: the resolved block comes in, nothing is
 * fetched, so the studio's phone preview renders the very same components (rule 49).
 *
 * Props: `block` (a resolved block of `/booklet/pages/:slug`), `onNavigate(target)` (page / item targets),
 * `onCopy(text)` (wifi password). An unknown type renders nothing.
 */
import TextBlock from './blocks/TextBlock';
import ImageBlock, { GalleryBlock } from './blocks/ImageBlock';
import CalloutBlock from './blocks/CalloutBlock';
import StepsBlock from './blocks/StepsBlock';
import WifiBlock from './blocks/WifiBlock';
import ContactBlock from './blocks/ContactBlock';
import PlaceBlock from './blocks/PlaceBlock';
import FaqBlock from './blocks/FaqBlock';
import ButtonBlock from './blocks/ButtonBlock';
import HoursBlock from './blocks/HoursBlock';

export const RENDERERS = Object.freeze({
  text: TextBlock,
  image: ImageBlock,
  gallery: GalleryBlock,
  callout: CalloutBlock,
  steps: StepsBlock,
  wifi: WifiBlock,
  contact: ContactBlock,
  place: PlaceBlock,
  faq: FaqBlock,
  button: ButtonBlock,
  hours: HoursBlock,
});

export default function BlockRenderer({ block, onNavigate, onCopy }) {
  const Renderer = block && RENDERERS[block.type];
  return Renderer ? <Renderer block={block} onNavigate={onNavigate} onCopy={onCopy} /> : null;
}

/** The blocks of one page with the booklet's 24 px rhythm. */
export function BlockList({ blocks, onNavigate, onCopy }) {
  return (
    <div className="blocks">
      {(blocks || []).map((block, i) => (
        // eslint-disable-next-line react/no-array-index-key
        <BlockRenderer key={`${block.type}-${i}`} block={block} onNavigate={onNavigate} onCopy={onCopy} />
      ))}
    </div>
  );
}
