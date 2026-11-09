/**
 * ProductCard — one article of the shop (§6.4): square photo, title, the server's price and unit, a 44 px
 * « + » on the photo. Included / free states replace the price with a soft chip (rule 25); a sold-out
 * article reads « Épuisé » and cannot be added, a low stock « Plus que 2 » (rule 37quater); an item the
 * stay can no longer order says why (rules 25, 42).
 *
 * Props: `item` (the shop payload's item), `readOnly` (pre-arrival), `onOpen`, `onAdd`.
 */
import Icon from './Icon';
import Photo from './Photo';
import StatusChip from './StatusChip';
import { useT } from '../i18n';

export function soldOut(item) { return Boolean(item.stock && item.stock.soldOut); }
export function orderable(item) { return !item.unavailableReason && !soldOut(item); }

export function PriceLine({ item }) {
  if (item.included) return <StatusChip tone="ok">{item.priceLabel}</StatusChip>;
  if (item.freeLeftLabel) return <StatusChip tone="ok">{item.freeLeftLabel}</StatusChip>;
  return <span className="price">{item.priceLabel}{item.priceUnitLabel ? <small> · {item.priceUnitLabel}</small> : null}</span>;
}

export default function ProductCard({ item, readOnly = false, onOpen, onAdd }) {
  const t = useT();
  const can = orderable(item);
  const label = [item.title, item.included ? item.priceLabel : `${item.priceLabel}${item.priceUnitLabel ? ` ${item.priceUnitLabel}` : ''}`].join(', ');
  return (
    <div className={`prod${can ? '' : ' off'}`}>
      <div className="addwrap">
        <Photo as="button" type="button" src={item.imageUrl} style={{ border: 0, width: '100%', display: 'block', aspectRatio: '1' }} imgSizes="(min-width: 900px) 25vw, 50vw" aria-label={label} onClick={onOpen} />
        {!readOnly && can ? (
          <button type="button" className="add" aria-label={t('shop.addItem', { title: item.title })} onClick={onAdd}><Icon name="plus" /></button>
        ) : null}
      </div>
      <div className="t">
        <b>{item.title}</b>
        {can ? <PriceLine item={item} /> : <StatusChip tone="mut">{soldOut(item) ? t('shop.soldOut') : item.unavailableReason}</StatusChip>}
        {can && item.stock && item.stock.leftLabel ? <StatusChip tone="warn">{item.stock.leftLabel}</StatusChip> : null}
        {can && item.needsStaff ? <span className="hint">{item.kind === 'breakfast' ? t('shop.breakfastWhen') : t('shop.staff')}</span> : null}
      </div>
    </div>
  );
}
