/**
 * Home (rules 10-15bis, §6.6): the hero with the greeting, the stay card (or the visitor's welcome), the
 * lodging's tiles in its order, the single highlight, one activity suggestion, the orders in progress, the
 * booklet strip and, from the second visit, « Installer l'app ». Everything shown is what `/me`, `/lodging`,
 * `/gate`, `/orders` and `/booklet` answer: the app picks no tile, no highlight and no wording itself.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router';
import HeroHeader from '../components/HeroHeader';
import StayCard from '../components/StayCard';
import QuickTile from '../components/QuickTile';
import MomentCard from '../components/MomentCard';
import PhotoCard from '../components/PhotoCard';
import Icon from '../components/Icon';
import InstallPrompt from '../components/InstallPrompt';
import BottomSheet from '../components/BottomSheet';
import WifiBlock from '../components/blocks/WifiBlock';
import ContactBlock from '../components/blocks/ContactBlock';
import { useToast } from '../components/Toast';
import { useModules, useSession } from '../hooks/useSession';
import { useActions } from '../hooks/useActions';
import { useLoad } from '../hooks/useLoad';
import { useLayout } from '../hooks/useLayout';
import { api } from '../services/api';
import { device } from '../services/device';
import { useT } from '../i18n';
import { copyText, stayDatesLabel } from '../utils/format';

const TILE_ICON = { gate: 'gate', wifi: 'wifi', shop: 'shop', bath: 'bath', soliomap: 'soliomap', booklet: 'booklet', contacts: 'contacts' };
const LIVE_ORDER = new Set(['confirmed', 'paid', 'awaiting_payment']);
export const DEFAULT_HERO = '/img/hero-domaine.jpg';

// A gate read without network is not « Accès en préparation »: the tile says the connection is needed.
function useGate(enabled, lang) {
  return useLoad(() => (enabled ? api.gate().catch((err) => ({ state: err.code === 'NETWORK' ? 'offline' : 'preparing', error: err })) : Promise.resolve(null)), [enabled, lang]);
}

export default function HomePage() {
  const t = useT();
  const navigate = useNavigate();
  const toast = useToast();
  const layout = useLayout();
  const { me, lodging, lang } = useSession();
  const { has } = useModules();
  const { openSoliomap, soliomapEmbedded } = useActions();
  const [sheet, setSheet] = useState(null);
  const stay = me.mode === 'stay' || me.mode === 'preArrival';
  // Rule 13 — the gate tile carries its state in `/me`; older servers answer it at `/gate`.
  const gateTile = (me.tiles || []).find((tile) => tile.key === 'gate');
  const gateInMe = Boolean(gateTile && gateTile.state);
  const gate = useGate(has('gate') && !gateInMe, lang);
  const orders = useLoad(() => (me.mode === 'stay' && has('orders') ? api.orders() : Promise.resolve(null)), [me.mode, lang]);
  const booklet = useLoad(() => (has('booklet') ? api.booklet() : Promise.resolve(null)), [lang]);

  const gateInfo = gateInMe ? gateTile : gate.data;
  const gateState = gateInfo ? gateInfo.state : null;
  const openGate = () => {
    if (gateInfo && gateInfo.state === 'active' && gateInfo.url) window.open(gateInfo.url, '_blank', 'noopener');
  };

  const tileAction = {
    gate: openGate,
    wifi: () => setSheet('wifi'),
    shop: () => navigate('/boutique'),
    bath: () => navigate('/boutique/bain'),
    soliomap: () => openSoliomap(),
    booklet: () => navigate('/livret'),
    contacts: () => setSheet('contacts'),
  };
  const tiles = (me.tiles || []).filter((tile) => !(tile.key === 'gate' && gateState === 'outside'));

  const hl = me.highlight;
  const hlAction = hl && (() => {
    if (hl.module === 'orders') navigate('/commandes');
    else if (hl.module === 'gate') openGate();
    else if (hl.page) navigate(`/livret/${encodeURIComponent(hl.page)}`);
    else if (hl.module === 'bath') navigate('/boutique/bain');
  });
  const hlText = hl && (hl.detail || (hl.key === 'gate' && gateState === 'preparing' ? t('hl.gatePreparing') : ''));

  const live = ((orders.data && orders.data.orders) || []).filter((o) => LIVE_ORDER.has(o.status));
  const latest = live[0];
  const pages = ((booklet.data && booklet.data.pages) || []).slice(0, 6);
  const ended = me.mode === 'visitor' && device.get('ended');

  const card = stay ? (
    <StayCard
      datesLabel={me.stay.datesLabel || stayDatesLabel(me.stay.arrival, me.stay.departure, lang)}
      partyLabel={me.stay.partySize ? t('home.party', { n: me.stay.partySize }) : null}
      statusLine={me.openingLine || me.stay.statusLine}
      nights={me.stay.nights || null}
      progressLabel={me.stay.nights ? t('home.nights', me.stay.nights) : undefined}
    />
  ) : (
    <div className="visit">
      <p>{ended ? t('home.ended') : t('home.visitorText')}</p>
      {!ended ? <button type="button" className="btn text" style={{ justifySelf: 'start', padding: 0 }} onClick={() => navigate('/retrouver')}>{t('home.findStay')}</button> : null}
    </div>
  );

  const tilesBlock = tiles.length ? (
    <div className={`tiles n${tiles.length}`}>
      {tiles.map((tile) => (
        <QuickTile
          key={tile.key}
          icon={TILE_ICON[tile.key] || 'info'}
          label={tile.label}
          external={tile.key === 'gate' || (tile.key === 'soliomap' && !soliomapEmbedded)}
          disabled={tile.key === 'gate' && (!gateState || gateState === 'offline')}
          disabledReason={tile.key !== 'gate' ? null
            : gateState === 'offline' ? t('net.needed')
              : gateState === 'preparing' ? ((gateInfo && gateInfo.stateLabel) || t('tile.preparing')) : null}
          onClick={tileAction[tile.key]}
        />
      ))}
    </div>
  ) : null;

  const highlight = hl ? (
    <MomentCard
      photo={hl.imageUrl || null}
      fallback={hl.key === 'bath' || hl.key === 'gate' ? 'night' : 'forest'}
      eyebrow={hl.eyebrow || t(`hl.${hl.key}`)}
      title={hl.text}
      text={hlText}
      external={hl.module === 'gate'}
      onClick={hlAction}
    />
  ) : null;

  const s = me.suggestion;
  const suggestion = s ? (
    <>
      <div className="rowh"><h2>{t('home.suggestion')}</h2></div>
      <MomentCard
        style={{ marginTop: 0 }}
        photo={s.imageUrl || null}
        eyebrow={[s.dateLabel, s.driveLabel].filter(Boolean).join(' · ')}
        title={s.name}
        text={[s.category, t('home.onSoliomap')].filter(Boolean).join(' · ')}
        external={!soliomapEmbedded}
        onClick={() => openSoliomap(s.url)}
      />
    </>
  ) : null;

  const ongoing = latest ? (
    <>
      <div className="rowh"><h2>{t('home.current')}</h2></div>
      <button type="button" className="ongoing" onClick={() => navigate(`/commandes/${latest.id}`)}>
        <div><b>{t('home.order', { id: latest.id })}</b><span>{latest.promise || latest.deliveryLabel || latest.statusLabel}</span></div>
        <Icon name="chev" />
      </button>
    </>
  ) : null;

  const strip = pages.length ? (
    <>
      <div className="rowh"><h2>{t('home.booklet')}</h2><button type="button" className="lnk" onClick={() => navigate('/livret')}>{t('home.seeAll')}</button></div>
      <div className="strip">
        {pages.map((p) => <PhotoCard key={p.slug} variant="strip" cover={p.cover} eyebrow={lodging.name} title={p.title} onClick={() => navigate(`/livret/${encodeURIComponent(p.slug)}`)} />)}
      </div>
    </>
  ) : null;

  const left = <>{tilesBlock}{highlight}<InstallPrompt /></>;
  const right = <>{ongoing}{suggestion}{strip}</>;

  return (
    <div className="scroll enter">
      <HeroHeader
        photo={lodging.heroUrl || DEFAULT_HERO}
        brand={me.appName || 'Domaine Solio'}
        brandSub="Mon séjour"
        eyebrow={lodging.name}
        title={stay ? (me.guest && me.guest.firstName ? t('home.hello', { name: me.guest.firstName }) : t('home.helloAnon')) : me.welcome}
      />
      {card}
      {layout.wide ? <div className="homegrid"><div>{left}</div><div>{right}</div></div> : <>{left}{right}</>}
      <BottomSheet open={sheet === 'wifi'} onClose={() => setSheet(null)} label={t('wifi.title')}>
        <h3>{t('wifi.title')}</h3>
        {lodging.wifi ? <WifiBlock block={{ available: true, ...lodging.wifi }} onCopy={async (text) => { if (await copyText(text)) toast(t('common.copied')); }} /> : null}
      </BottomSheet>
      <BottomSheet open={sheet === 'contacts'} onClose={() => setSheet(null)} label={t('contacts.title')}>
        <h3>{t('contacts.title')}</h3>
        <ContactBlock block={{ contacts: (lodging.contacts || []).map((c) => ({ ...c, telUrl: c.phone ? `tel:${String(c.phone).replace(/[^0-9+]/g, '')}` : undefined })) }} />
      </BottomSheet>
    </div>
  );
}
