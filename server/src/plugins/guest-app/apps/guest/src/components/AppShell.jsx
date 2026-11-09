/**
 * AppShell — the frame of every screen (rule 51, §6.4 `TabBar` / `NavRail`): a bottom tab bar on the phone,
 * a navigation rail from 900 px, the floating cart bar on the phone's home and shop, and the offline banner.
 * The entries follow the lodging's modules (rule 11bis): no « Boutique » tab where the shop is off. Four at most.
 *
 * Props: `children` (the screen), `register` ('day' | 'night'), `layout` ({ wide, desk }), `appName`.
 */
import { NavLink, useLocation, useNavigate } from 'react-router';
import Icon from './Icon';
import CartBar from './CartBar';
import OfflineBanner from './OfflineBanner';
import { useModules } from '../hooks/useSession';
import { useCart } from '../hooks/useCart';
import { useOnline } from '../hooks/useOnline';
import { useT } from '../i18n';

const SECTION_OF = [
  ['/livret', 'booklet'], ['/boutique', 'shop'], ['/panier', 'shop'], ['/commandes', 'orders'],
];

export function sectionOf(pathname) {
  const hit = SECTION_OF.find(([prefix]) => pathname.startsWith(prefix));
  return hit ? hit[1] : 'home';
}

export function tabsOf(has) {
  return [
    { key: 'home', to: '/', icon: 'home', label: 'nav.home' },
    has('booklet') && { key: 'booklet', to: '/livret', icon: 'booklet', label: 'nav.booklet' },
    has('shop') && { key: 'shop', to: '/boutique', icon: 'shop', label: 'nav.shop' },
    has('orders') && { key: 'orders', to: '/commandes', icon: 'orders', label: 'nav.orders' },
  ].filter(Boolean);
}

export default function AppShell({ children, layout, appName }) {
  const t = useT();
  const { has } = useModules();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const online = useOnline();
  const cart = useCart();
  const current = sectionOf(pathname);
  const tabs = tabsOf(has);
  const items = tabs.map((tab) => (
    <NavLink key={tab.key} to={tab.to} className="tab" aria-current={current === tab.key ? 'page' : undefined}>
      <Icon name={tab.icon} />
      {t(tab.label)}
    </NavLink>
  ));
  const showCartBar = !layout.wide && has('shop') && cart && cart.count > 0 && (pathname === '/' || pathname === '/boutique');
  const mono = ((appName || 'S').trim().split(/\s+/).pop() || 'S')[0];
  return (
    <>
      <div className="shell">
        {layout.wide ? <nav className="rail" aria-label={t('nav.label')}><span className="mono" aria-hidden="true">{mono}</span>{items}</nav> : null}
        <main className="main">{children}</main>
      </div>
      {!layout.wide ? <nav className="tabbar" aria-label={t('nav.label')}>{items}</nav> : null}
      {showCartBar ? <CartBar count={cart.count} totalLabel={cart.quote ? cart.quote.totalLabel : null} onOpen={() => navigate('/panier')} /> : null}
      {!online ? <OfflineBanner /> : null}
    </>
  );
}
