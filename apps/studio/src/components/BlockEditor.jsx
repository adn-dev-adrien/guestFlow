/**
 * BlockEditor — the editor of one booklet block, by type (rule 18). Each type edits its own `data` in the server's
 * stored shape; the server validates and sanitises it again on save.
 *
 * Props: `type`, `data`, `onChange(data)`, and the lookups some types need — `media` (photos), `pages` (the
 * booklet's pages, for a button), `items` (the articles sold here, for a button).
 */
import TextEditor from './blockEditors/TextEditor';
import ImageEditor from './blockEditors/ImageEditor';
import GalleryEditor from './blockEditors/GalleryEditor';
import CalloutEditor from './blockEditors/CalloutEditor';
import StepsEditor from './blockEditors/StepsEditor';
import WifiEditor from './blockEditors/WifiEditor';
import ContactEditor from './blockEditors/ContactEditor';
import PlaceEditor from './blockEditors/PlaceEditor';
import FaqEditor from './blockEditors/FaqEditor';
import ButtonEditor from './blockEditors/ButtonEditor';
import HoursEditor from './blockEditors/HoursEditor';

export const EDITORS = Object.freeze({
  text: TextEditor,
  image: ImageEditor,
  gallery: GalleryEditor,
  callout: CalloutEditor,
  steps: StepsEditor,
  wifi: WifiEditor,
  contact: ContactEditor,
  place: PlaceEditor,
  faq: FaqEditor,
  button: ButtonEditor,
  hours: HoursEditor,
});

/** What a block holds when it comes out of the palette (rule 18). */
export function emptyData(type) {
  switch (type) {
    case 'text': return { html: { fr: '', en: '' } };
    case 'image': return { mediaId: null };
    case 'gallery': return { items: [{ mediaId: null }] };
    case 'callout': return { tone: 'info', text: { fr: '', en: '' } };
    case 'steps': return { steps: [] };
    case 'contact': return { source: 'lodging' };
    case 'place': return { name: { fr: '', en: '' }, address: '' };
    case 'faq': return { items: [{ question: { fr: '', en: '' }, answer: { fr: '', en: '' } }] };
    case 'button': return { label: { fr: '', en: '' }, target: { kind: 'page', slug: '' } };
    case 'hours': return { rows: [{ label: { fr: '', en: '' }, value: { fr: '', en: '' } }] };
    default: return {};
  }
}

export default function BlockEditor({ type, data, onChange, media, pages, items }) {
  const Editor = EDITORS[type];
  return Editor ? <Editor data={data} onChange={onChange} media={media} pages={pages} items={items} /> : null;
}
