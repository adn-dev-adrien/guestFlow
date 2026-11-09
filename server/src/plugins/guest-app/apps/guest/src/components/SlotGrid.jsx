/**
 * SlotGrid — the bath's days and slots (§6.4, rules 28-31): day chips of the days that still have a bookable
 * slot, then the slots of the chosen day, two columns, time range and price. Only bookable slots exist here
 * (`free`, `evening` with its gold dot and « tarif soirée »); taken, past, heating and staff slots are never
 * drawn — the server does not even send them.
 *
 * Props: `days` ([{ date, label, slots:[{ start, end, state, priceLabel }] }]), `day` (selected date),
 * `onDay(date)`, `selected` (Set of `date|start|end`), `onToggle(slot, date)`.
 */
import { useLang, useT } from '../i18n';
import { clockLabel } from '../utils/format';

export const slotKey = (date, slot) => `${date}|${slot.start}|${slot.end}`;

/** « sam. 7 nov. » → [« sam. », « 7 »]: the chip prints the weekday over the day's number. */
function dayParts(label) {
  const [weekday, number] = String(label).split(' ');
  return [weekday, number];
}

export default function SlotGrid({ days, day, onDay, selected, onToggle }) {
  const t = useT();
  const lang = useLang();
  const current = days.find((d) => d.date === day) || days[0];
  return (
    <>
      <div className="daysrow" role="group" aria-label={t('bath.day')}>
        {days.map((d) => {
          const [weekday, number] = dayParts(d.label);
          return (
            <button key={d.date} type="button" className="day" aria-pressed={current && current.date === d.date} aria-label={d.label} onClick={() => onDay(d.date)}>
              {weekday}<b>{number}</b>
            </button>
          );
        })}
      </div>
      {current ? (
        <div className="slots">
          {current.slots.map((slot) => {
            const key = slotKey(current.date, slot);
            return (
              <button key={key} type="button" className={`slot ${slot.state}`} aria-pressed={selected.has(key)} onClick={() => onToggle(slot, current.date)}>
                <b>{clockLabel(slot.start, lang)} – {clockLabel(slot.end, lang)}</b>
                <span>{slot.priceLabel}{slot.state === 'evening' ? ` · ${t('bath.evening')}` : ''}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </>
  );
}
