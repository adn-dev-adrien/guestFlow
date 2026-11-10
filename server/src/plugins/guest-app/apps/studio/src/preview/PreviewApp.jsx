/**
 * PreviewApp — what the studio's phone frame shows (rule 49). The studio posts the screen to draw
 * (`{ source: 'guestflow-studio', view, lang, night, … }`); this page renders it with the guest app's own
 * components, so the preview cannot drift from what guests see. Nothing here fetches: the studio sends the data.
 *
 * Views: `home` (hero, stay card, tiles — Modules and Infos du logement), `page` (a booklet page — Livret),
 * `shop` (the catalogue — Boutique, Service).
 */
import { useEffect, useMemo, useState } from 'react';
import { MemoryRouter } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import { cssVars, muiTheme } from '@guest/theme';
import { LangContext, translate } from '@guest/i18n';
import { SessionContext } from '@guest/hooks/useSession';
import { ToastProvider } from '@guest/components/Toast';
import HeroHeader from '@guest/components/HeroHeader';
import StayCard from '@guest/components/StayCard';
import QuickTile from '@guest/components/QuickTile';
import Photo from '@guest/components/Photo';
import Icon from '@guest/components/Icon';
import AppBar from '@guest/components/AppBar';
import ProductCard from '@guest/components/ProductCard';
import { BlockList } from '@guest/components/BlockRenderer';
import { tabsOf } from '@guest/components/AppShell';
import defaultHero from '@guest-public/img/hero-domaine.jpg';

export const MESSAGE_SOURCE = 'guestflow-studio';

const TILE_ICON = { gate: 'gate', wifi: 'wifi', shop: 'shop', bath: 'bath', soliomap: 'soliomap', booklet: 'booklet', contacts: 'contacts' };
const noop = () => {};

function Home({ view, t }) {
  return (
    <div className="scroll">
      <HeroHeader photo={view.heroUrl || defaultHero} brand={view.appName || 'Domaine Solio'} brandSub="Mon séjour" eyebrow={view.lodgingName} title={t('home.hello', { name: 'Marie' })} />
      <StayCard datesLabel={view.lang === 'en' ? '6 → 9 Nov.' : '6 → 9 nov.'} partyLabel={t('home.party', { n: 4 })} statusLine={view.lang === 'en' ? 'Day 2 of 3' : 'Jour 2 sur 3'} nights={{ done: 2, total: 3 }} progressLabel={t('home.nights', { done: 2, total: 3 })} />
      {view.tiles.length ? (
        <div className={`tiles n${view.tiles.length}`}>
          {view.tiles.map((tile) => (
            <QuickTile key={tile.key} icon={TILE_ICON[tile.key] || 'info'} label={tile.label} external={tile.key === 'gate' || (tile.key === 'soliomap' && !view.soliomapEmbed)} onClick={noop} />
          ))}
        </div>
      ) : <p className="pv-empty">{view.lang === 'en' ? 'No tile on this lodging’s home.' : 'Aucune tuile sur l’accueil de ce logement.'}</p>}
    </div>
  );
}

function Page({ view, t }) {
  const { page } = view;
  if (!page) return <div className="scroll"><p className="pv-empty">{view.lang === 'en' ? 'No page chosen.' : 'Aucune page choisie.'}</p></div>;
  return (
    <div className="scroll" lang={view.lang}>
      <Photo src={page.cover ? page.cover.url : null} sizes={page.cover ? page.cover.sizes : null} scrim className="cover">
        <button type="button" className="back bk" aria-label={t('common.back')} tabIndex={-1}><Icon name="back" /></button>
        <div className="in"><p className="eb">{view.lodgingName}</p><h1>{page.title}</h1></div>
      </Photo>
      <BlockList blocks={page.blocks} onNavigate={noop} onCopy={noop} />
      {view.nextTitle ? (
        <button type="button" className="next" tabIndex={-1}>
          <span><small>{t('booklet.next')}</small><b>{view.nextTitle}</b></span>
          <Icon name="chev" />
        </button>
      ) : null}
      <p className="cached"><Icon name="check" />{t('booklet.offline')}</p>
    </div>
  );
}

function Shop({ view, t }) {
  return (
    <div className="scroll">
      <AppBar title={t('shop.title')} />
      <div className="pad">
        {!view.categories.length ? <p className="pv-empty">{view.lang === 'en' ? 'Nothing sold here yet.' : 'Rien n’est encore vendu ici.'}</p> : null}
        {view.categories.map((c) => (
          <section className="cat" key={c.name} aria-label={c.name}>
            <h2>{c.name}</h2>
            <div className="grid">
              {c.items.map((item) => <ProductCard key={`${item.kind}:${item.id}`} item={item} onOpen={noop} onAdd={noop} />)}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

const SCREENS = { home: Home, page: Page, shop: Shop };
const TAB_OF = { home: 'home', page: 'booklet', shop: 'shop' };

export default function PreviewApp() {
  const [view, setView] = useState(null);
  useEffect(() => {
    const receive = (event) => {
      if (event.origin !== window.location.origin || !event.data || event.data.source !== MESSAGE_SOURCE) return;
      setView(event.data);
    };
    window.addEventListener('message', receive);
    if (window.parent !== window) window.parent.postMessage({ source: MESSAGE_SOURCE, ready: true }, window.location.origin);
    return () => window.removeEventListener('message', receive);
  }, []);

  const lang = (view && view.lang) || 'fr';
  const register = view && view.night ? 'night' : 'day';
  const theme = useMemo(() => muiTheme(register), [register]);
  const vars = useMemo(() => cssVars(register), [register]);
  const session = useMemo(() => ({
    lang, night: register === 'night', lodging: { name: view ? view.lodgingName : '' }, chooseLang: noop, toggleNight: noop,
  }), [lang, register, view]);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);

  const t = (key, vars2) => translate(lang, key, vars2);
  const Screen = view ? SCREENS[view.view] : null;
  const modules = new Set((view && view.modules) || []);
  const tabs = tabsOf((key) => modules.has(key));
  return (
    <LangContext.Provider value={lang}>
      <SessionContext.Provider value={session}>
        <ThemeProvider theme={theme}>
          <MemoryRouter>
            <ToastProvider>
              <div className={`app${register === 'night' ? ' night' : ''}`} style={vars} lang={lang}>
                <div className="shell"><main className="main">{Screen ? <Screen view={view} t={t} /> : null}</main></div>
                {view ? (
                  <nav className="tabbar" aria-label={t('nav.label')}>
                    {tabs.map((tab) => (
                      <span key={tab.key} className="tab" aria-current={TAB_OF[view.view] === tab.key ? 'page' : undefined}><Icon name={tab.icon} />{t(tab.label)}</span>
                    ))}
                  </nav>
                ) : null}
              </div>
            </ToastProvider>
          </MemoryRouter>
        </ThemeProvider>
      </SessionContext.Provider>
    </LangContext.Provider>
  );
}
