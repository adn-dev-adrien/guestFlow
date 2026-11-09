/**
 * MomentCard — the single highlight of the home (rule 11) and the activity suggestion (rule 15bis): photo
 * left, eyebrow, one sentence, one line under it. The whole card is the button.
 *
 * Props: `photo`, `fallback`, `eyebrow`, `title`, `text`, `external`, `onClick`, `style`.
 */
import Photo from './Photo';
import Icon from './Icon';

export default function MomentCard({ photo, fallback = 'forest', eyebrow, title, text, external, onClick, style }) {
  return (
    <button type="button" className="moment" onClick={onClick} style={style}>
      <Photo src={photo} scrim fallback={fallback} imgSizes="92px" />
      <div className="t">
        {eyebrow ? <em>{eyebrow}</em> : null}
        <b>{title}</b>
        {text || external ? <span>{text}{external ? <Icon name="ext" className="ext" /> : null}</span> : null}
      </div>
    </button>
  );
}
