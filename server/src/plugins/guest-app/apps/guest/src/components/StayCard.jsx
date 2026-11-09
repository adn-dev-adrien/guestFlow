/**
 * StayCard — the card over the hero (§6.4): the dates, the party, the server's status line, the night progress.
 *
 * Props: `datesLabel`, `partyLabel`, `statusLine`, `nights` ({ done, total } or null), `progressLabel`.
 */
export default function StayCard({ datesLabel, partyLabel, statusLine, nights, progressLabel }) {
  return (
    <div className="stay">
      <div className="stay-top"><b>{datesLabel}</b>{partyLabel ? <span>{partyLabel}</span> : null}</div>
      {statusLine ? <span>{statusLine}</span> : null}
      {nights && nights.total > 0 ? (
        <div className="nights" role="img" aria-label={progressLabel}>
          {Array.from({ length: nights.total }, (_, i) => <i key={i} className={i < nights.done ? 'full' : ''} />)}
        </div>
      ) : null}
    </div>
  );
}
