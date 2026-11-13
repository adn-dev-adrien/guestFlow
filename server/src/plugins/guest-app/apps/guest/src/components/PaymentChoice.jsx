/**
 * PaymentChoice — « Payer par carte » or the note (rules 33, 86, §6.4): one radio group of two rows of the same component,
 * size and weight, the card FIRST and selected when the cart opens, the selected row taking the sapin outline and tint
 * every selected control takes; no banner, no badge. A single available way is stated, not offered. The card exists only
 * while the server says it works (`canPayCard`); the note's words are the server's (`noteLabel`).
 *
 * Props: `canNote`, `canCard`, `noteLabel`, `value` ('note' | 'card'), `onChange`.
 */
import Icon from './Icon';
import { useT } from '../i18n';

function Option({ value, current, icon, title, text, onChange }) {
  const checked = current === value;
  return (
    <button type="button" className="pc" role="radio" aria-checked={checked} tabIndex={checked ? 0 : -1} onClick={() => onChange(value)}>
      <span className="ic"><Icon name={icon} /></span>
      <span><b>{title}</b><span>{text}</span></span>
      <span className="rd" />
    </button>
  );
}

export default function PaymentChoice({
  canNote, canCard, noteLabel, value, onChange,
}) {
  const t = useT();
  if (!canNote && !canCard) return <p className="hint bad">{t('cart.noPayment')}</p>;
  if (!canCard || !canNote) {
    const card = canCard;
    return (
      <div className="paychoice">
        <h2 style={{ fontSize: 17 }}>{t('cart.payment')}</h2>
        <div className="payone">
          <span className="ic"><Icon name={card ? 'card' : 'orders'} /></span>
          <span><b>{card ? t('cart.card') : (noteLabel || t('cart.noteOnly'))}</b><span>{card ? t('cart.cardText') : t('cart.noteText')}</span></span>
        </div>
      </div>
    );
  }
  const onKey = (e) => {
    if (['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft'].includes(e.key)) {
      e.preventDefault();
      onChange(value === 'note' ? 'card' : 'note');
    }
  };
  return (
    <div className="paychoice" role="radiogroup" aria-label={t('cart.payment')} onKeyDown={onKey}>
      <h2 style={{ fontSize: 17 }}>{t('cart.payment')}</h2>
      <Option value="card" current={value} icon="card" title={t('cart.card')} text={t('cart.cardText')} onChange={onChange} />
      <Option value="note" current={value} icon="orders" title={noteLabel || t('cart.note')} text={t('cart.noteText')} onChange={onChange} />
    </div>
  );
}
