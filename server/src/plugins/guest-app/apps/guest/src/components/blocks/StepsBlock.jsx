/** StepsBlock — a numbered how-to as a vertical line, lichen numerals, an optional photo per step (rule 18 `steps`). */
import Photo from '../Photo';

export default function StepsBlock({ block }) {
  return (
    <ol className="bsteps" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
      {block.steps.map((step, i) => (
        // eslint-disable-next-line react/no-array-index-key
        <li className="bstep" key={i}>
          <em aria-hidden="true">{i + 1}</em>
          <div>
            <span style={{ color: 'var(--ink)', fontSize: 15 }}>{step.text}</span>
            {step.image ? <Photo src={step.image.url} sizes={step.image.sizes} alt={step.image.alt} className="sph" imgSizes="(min-width: 900px) 600px, 90vw" /> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
