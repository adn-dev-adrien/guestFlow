/** The cart on a phone (rule 32, §6.6 Cart). From 900 px the cart lives beside the shop: this route shows the shop. */
import AppBar from '../components/AppBar';
import CartBody from '../components/CartBody';
import ErrorAlert from '../components/ErrorAlert';
import Skeleton from '../components/Skeleton';
import ShopPage, { NeedNetwork, useShop } from './ShopPage';
import { useCart } from '../hooks/useCart';
import { useLayout } from '../hooks/useLayout';
import { useOnline } from '../hooks/useOnline';
import { useT } from '../i18n';

export default function CartPage() {
  const t = useT();
  const layout = useLayout();
  const online = useOnline();
  const cart = useCart();
  const shop = useShop();
  if (layout.wide) return <ShopPage />;
  if (!online && !cart.lines.length) return <NeedNetwork title={t('cart.title')} back="/boutique" />;
  return (
    <div className="scroll enter">
      <AppBar title={t('cart.title')} back="/boutique" />
      <div className="pad">
        {shop.data ? <CartBody shop={shop.data} /> : shop.error ? <ErrorAlert error={shop.error} onRetry={shop.reload} /> : <Skeleton lines={4} label={t('common.loading')} />}
      </div>
    </div>
  );
}
