/**
 * ProductSheet — an article opened (§6.4): large photo, category, title, description, the server's price,
 * the stepper bounded by `maxQuantity` and the stock left (rule 37quater), and the primary button carrying
 * the server's total for that quantity. Pre-arrival: read only, « Disponible pendant votre séjour ».
 *
 * Props: `item`, `category`, `readOnly`, `open`, `onClose`, `onAdd(quantity)`.
 */
import { useEffect, useState } from 'react';
import BottomSheet from './BottomSheet';
import Photo from './Photo';
import QuantityStepper from './QuantityStepper';
import Banner from './Banner';
import StatusChip from './StatusChip';
import { PriceLine, orderable, soldOut } from './ProductCard';
import { useLineQuote } from '../hooks/useLineQuote';
import { useT } from '../i18n';

export function maxFor(item) {
  const left = item.stock && typeof item.stock.left === 'number' ? item.stock.left : Infinity;
  const included = typeof item.includedLeft === 'number' ? item.includedLeft : Infinity;
  return Math.max(0, Math.min(item.maxQuantity || 1, left, included));
}

export default function ProductSheet({ item, category, readOnly, open, onClose, onAdd }) {
  const t = useT();
  const [quantity, setQuantity] = useState(1);
  useEffect(() => { if (open) setQuantity(1); }, [open, item && item.id]);
  const can = item && !readOnly && orderable(item);
  const max = item ? maxFor(item) : 1;
  const { quote, loading } = useLineQuote(item && can ? { kind: item.kind, id: item.id, quantity } : null, open && can);
  if (!item) return null;
  return (
    <BottomSheet open={open} onClose={onClose} labelledBy="product-title">
      <Photo src={item.imageUrl} style={{ height: 180, borderRadius: 4 }} imgSizes="(min-width: 900px) 520px, 100vw" />
      {category ? <p className="eb">{category}</p> : null}
      <h3 id="product-title">{item.title}</h3>
      {item.shortDescription ? <p>{item.shortDescription}</p> : null}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        {orderable(item) ? <PriceLine item={item} /> : <StatusChip tone="mut">{soldOut(item) ? t('shop.soldOut') : item.unavailableReason}</StatusChip>}
        {can ? <QuantityStepper value={quantity} max={max} onChange={setQuantity} label={item.title} /> : null}
      </div>
      {can && item.stock && item.stock.leftLabel ? <div className="stock"><StatusChip tone="warn">{item.stock.leftLabel}</StatusChip></div> : null}
      {can && quantity >= max && max === item.maxQuantity ? <p className="hint">{t('shop.maxReached', { n: item.maxQuantity })}</p> : null}
      {item.needsStaff ? <p className="hint">{item.leadMinutes ? t('shop.staffLead', { n: item.leadMinutes }) : t('shop.staff')}</p> : null}
      {readOnly ? <Banner tone="mut">{t('cart.preArrival')}</Banner> : null}
      {can ? (
        <button type="button" className="btn block" disabled={max < 1} onClick={() => onAdd(quantity)} aria-busy={loading}>
          {quote ? t('shop.addTotal', { total: quote.totalLabel }) : t('shop.add')}
        </button>
      ) : null}
    </BottomSheet>
  );
}
