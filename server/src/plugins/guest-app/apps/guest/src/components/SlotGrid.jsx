/**
 * SlotGrid — the bath's days and slots (§6.4, rules 28-31, 78, 84): a chip for every day of the stay (a day with nothing
 * bookable is greyed, its reason said, and cannot be picked), the bath's opening as a thin bar of the chosen day, then the slots of the chosen day, two columns, time range and price. Only bookable slots exist here
 * (`free`, `evening` with its gold dot and « tarif soirée »); taken, past, heating and staff slots are never
 * drawn — the server does not even send them.
 *
 * Props: `days` ([{ date, label, available, reasonLabel, openingBands, slots:[{ start, end, state, band, priceLabel }] }]), `day` (selected date),
 * `onDay(date)`, `selected` (Set of `date|start|end`), `onToggle(slot, date)`.
 */
import { useLang, useT } from '../i18n';
import { clockLabel } from '../utils/format';

const toMinutes = (time) => { const [h, m] = String(time).split(':').map(Number); return h * 60 + m; };

export const slotKey = (date, slot) => `${date}|${slot.start}|${slot.end}`;

/** « sam. 7 nov. » → [« sam. », « 7 »]: the chip prints the weekday over the day's number. */
function dayParts(label) {
  const [weekday, number] = String(label).split(' ');
  return [weekday, number];
}

export default function SlotGrid({ days, day, onDay, selected, onToggle }) {
  const t = useT();
  const lang = useLang();
  const current = days.find((d) => d.date === day && d.available) || days.find((d) => d.available) || days[0];
  return (
    <>
      <div className="daysrow" role="group" aria-label={t('bath.day')}>
        {days.map((d) => {
          const [weekday, number] = dayParts(d.label);
          return (
            <button key={d.date} type="button" className="day" disabled={!d.available} aria-pressed={current && current.date === d.date} aria-label={d.available ? d.label : `${d.label} · ${d.reasonLabel}`} onClick={() => onDay(d.date)}>
              {weekday}<b>{number}</b>
            </button>
          );
        })}
      </div>
      {current && !current.available ? <p className="hint">{current.reasonLabel}</p> : null}
      {current && current.openingBands ? (
        <div className="openbar" role="img" aria-label={current.openingBands.filter((b) => b.open).map((b) => `${b.from} – ${b.to}`).join(', ')}>
          {current.openingBands.map((b) => <span key={b.from} className={b.open ? 'on' : 'off'} style={{ flexGrow: Math.max(1, toMinutes(b.to) - toMinutes(b.from)) }} />)}
        </div>
      ) : null}
      {current ? (
        <div className="slots">
          {current.slots.map((slot) => {
            const key = slotKey(current.date, slot);
            return (
              <button key={key} type="button" className={`slot ${slot.state}`} aria-pressed={selected.has(key)} onClick={() => onToggle(slot, current.date)}>
                <b>{clockLabel(slot.start, lang)} – {clockLabel(slot.end, lang)}</b>
                <span>{slot.priceLabel}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </>
  );
}
