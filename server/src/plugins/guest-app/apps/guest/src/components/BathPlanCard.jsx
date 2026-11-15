/**
 * BathPlanCard — the home's bath card (specs/guest-app-bath-home-scheduling.md rules 4-6, §6): the night ground, the eyebrow, the
 * server's title and line, the sessions to come, and its buttons stacked full width at one height — never a text button beside a
 * filled one (Adrien's review of the mock-up, 2026-11-13). Every word is the server's (`/me` → `bath`).
 *
 * Props: `card` (one `bath` entry of `/me`), `onAction(key, card)` with key ∈ schedule | add | change.
 */
import Photo from './Photo';

export default function BathPlanCard({ card, onAction }) {
  return (
    <section className="bathcard" aria-label={card.name}>
      <Photo fallback="night" scrim className="bg" />
      <div className="in">
        <em>{card.eyebrow}</em>
        <b>{card.title}</b>
        {card.detail ? <p>{card.detail}</p> : null}
        {card.upcoming && card.upcoming.length ? (
          <ul>{card.upcoming.map((s) => <li key={`${s.date}${s.start}`}>{s.label}</li>)}</ul>
        ) : null}
        <div className="acts">
          {card.actions.map((a, i) => (
            <button key={a.key} type="button" className={`btn block${i ? ' light' : ''}`} onClick={() => onAction(a.key, card)}>{a.label}</button>
          ))}
        </div>
      </div>
    </section>
  );
}
