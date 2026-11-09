/**
 * BreakfastSheet — the breakfast (rule 27bis): the mornings left in the stay, one hour for all of them (a
 * morning where that hour is not a delivery time says so), the number of people up to the party, and the
 * server's total « par personne et par matin ». Where the stay includes it, it only sets mornings and hour.
 *
 * The hours offered are the delivery times the server gives for this item (rule 41).
 *
 * Props: `item` (a `breakfast` shop item), `partySize`, `readOnly`, `open`, `onClose`, `onAdd(line)`, `initial` (the cart's line).
 */
import { useEffect, useMemo, useState } from 'react';
import BottomSheet from './BottomSheet';
import Photo from './Photo';
import QuantityStepper from './QuantityStepper';
import Banner from './Banner';
import { PriceLine } from './ProductCard';
import { useLineQuote } from '../hooks/useLineQuote';
import { api } from '../services/api';
import { clockLabel } from '../utils/format';
import { useLang, useT } from '../i18n';

const PARIS = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** The delivery picker's instants, read back as (Paris date, HH:MM) pairs: which hour each morning allows. */
function hoursByMorning(delivery) {
  const map = new Map();
  (delivery && delivery.days ? delivery.days : []).forEach((day) => day.slots.forEach((slot) => {
    const parts = Object.fromEntries(PARIS.formatToParts(new Date(slot.at)).map((p) => [p.type, p.value]));
    const date = `${parts.year}-${parts.month}-${parts.day}`;
    if (!map.has(date)) map.set(date, new Set());
    map.get(date).add(`${parts.hour}:${parts.minute}`);
  }));
  return map;
}

export default function BreakfastSheet({ item, partySize, readOnly, open, onClose, onAdd, initial }) {
  const t = useT();
  const lang = useLang();
  const [mornings, setMornings] = useState([]);
  const [time, setTime] = useState(null);
  const [persons, setPersons] = useState(1);
  const [delivery, setDelivery] = useState(null);

  useEffect(() => {
    if (!open || !item) return;
    setMornings(initial ? initial.mornings : (item.mornings || []).map((m) => m.date));
    setTime(initial ? initial.time : item.defaultTime);
    setPersons(initial ? initial.persons : Math.max(1, Math.min(partySize || 1, item.maxQuantity || partySize || 1)));
    if (!readOnly && item.needsStaff) api.deliverySlots([{ kind: 'breakfast', id: item.id }]).then(setDelivery).catch(() => setDelivery(null));
  }, [open, item, initial, partySize, readOnly]);

  const byMorning = useMemo(() => hoursByMorning(delivery), [delivery]);
  const staffTimes = item && item.needsStaff && delivery && delivery.needed;
  const hours = useMemo(() => {
    if (!staffTimes) return item && item.defaultTime ? [item.defaultTime] : [];
    return [...new Set([...byMorning.values()].flatMap((s) => [...s]))].sort();
  }, [staffTimes, byMorning, item]);
  const fits = (date) => !staffTimes || (byMorning.get(date) || new Set()).has(time);
  const chosen = mornings.filter(fits);
  const line = item && chosen.length && time ? { kind: 'breakfast', id: item.id, mornings: chosen, time, persons } : null;
  const { quote } = useLineQuote(line, open && !readOnly && Boolean(line));
  if (!item) return null;
  const maxPersons = Math.max(1, partySize || 1);
  const toggle = (date) => setMornings((cur) => (cur.includes(date) ? cur.filter((d) => d !== date) : [...cur, date]));

  return (
    <BottomSheet open={open} onClose={onClose} labelledBy="breakfast-title">
      <Photo src={item.imageUrl} style={{ height: 180, borderRadius: 4 }} />
      <h3 id="breakfast-title">{item.title}</h3>
      {item.shortDescription ? <p>{item.shortDescription}</p> : null}
      <div><PriceLine item={item} /></div>
      {readOnly ? <Banner tone="mut">{t('cart.preArrival')}</Banner> : null}
      {!readOnly && !(item.mornings || []).length ? <Banner tone="mut">{t('bk.noMorning')}</Banner> : null}
      {!readOnly && (item.mornings || []).length ? (
        <>
          <div className="dgroup" role="group" aria-label={t('bk.mornings')}>
            <small>{t('bk.mornings')}</small>
            <div className="dchips">
              {item.mornings.map((m) => (
                <button key={m.date} type="button" className="chip" aria-pressed={mornings.includes(m.date) && fits(m.date)} aria-disabled={!fits(m.date)} onClick={() => fits(m.date) && toggle(m.date)}>
                  {m.label}{fits(m.date) ? '' : ` · ${lang === 'en' ? 'not at' : 'pas à'} ${clockLabel(time, lang)}`}
                </button>
              ))}
            </div>
          </div>
          {hours.length > 1 ? (
            <div className="dgroup" role="group" aria-label={t('bk.time')}>
              <small>{t('bk.time')}</small>
              <div className="dchips">
                {hours.map((h) => <button key={h} type="button" className="chip" aria-pressed={time === h} onClick={() => setTime(h)}>{clockLabel(h, lang)}</button>)}
              </div>
            </div>
          ) : null}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
            <span>{t('bk.persons')}</span>
            <QuantityStepper value={persons} max={maxPersons} onChange={setPersons} label={t('bk.persons')} />
          </div>
          <button type="button" className="btn block" disabled={!line} onClick={() => onAdd(line)}>
            {!line ? t('bk.pickOne') : quote ? t('shop.addTotal', { total: quote.totalLabel }) : t('shop.add')}
          </button>
        </>
      ) : null}
    </BottomSheet>
  );
}
